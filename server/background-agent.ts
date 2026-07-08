import { tools, setCurrentChatId } from "./tools.ts";
import { getFactStore } from "./user-facts.ts";
import { getSettingsStore } from "./user-settings.ts";
import { buildSystemPrompt } from "./presets.ts";
import { connectMcpServer, buildMcpAiTools } from "./mcp-manager";
import { updateTask } from "./task-queue.ts";
import { getRecentMemories } from "./session-memory.ts";
import { SYSTEM_PROMPT } from "./polza-client.ts";

const POLZAAI_BASE_URL =
  process.env.POLZAAI_BASE_URL ?? "https://api.polza.ai/v1";
const POLZAAI_MODEL_RAW =
  process.env.POLZAAI_MODEL ?? "openai/gpt-4o-mini";
const POLZAAI_PROVIDER = process.env.POLZAAI_PROVIDER ?? "OpenAI";
const POLZAAI_API_KEY = process.env.POLZAAI_API_KEY;

const activeModel = POLZAAI_MODEL_RAW.includes("@")
  ? POLZAAI_MODEL_RAW
  : `${POLZAAI_MODEL_RAW}@provider=${POLZAAI_PROVIDER}&allow_fallbacks=false`;

type ToolDef = {
  name: string;
  description: string;
  inputSchema: unknown;
  execute: (args: Record<string, unknown>) => Promise<unknown>;
};

// Собираем все инструменты в плоский список для raw API
function getAllTools(): ToolDef[] {
  return Object.entries(tools).map(([name, t]: [string, any]) => ({
    name,
    description: t.description ?? "",
    inputSchema: t.parameters ?? {},
    execute: async (args: Record<string, unknown>) => {
      const res = await t.execute(args);
      return res;
    },
  }));
}

function convertToolsForApi(toolDefs: ToolDef[]) {
  return toolDefs.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.inputSchema,
    },
  }));
}

export async function runBackgroundAgent(
  taskId: string,
  chatId: string,
  goal: string,
): Promise<string> {
  setCurrentChatId(chatId);
  console.log(`[bg-agent] starting task=${taskId} goal="${goal.slice(0, 80)}"`);

  const settingsStore = await getSettingsStore();
  const settings = await settingsStore.get();
  const system = buildSystemPrompt(
    SYSTEM_PROMPT,
    settings.preset,
    settings.customPrompt,
  );

  for (const cfg of settings.mcpServers) {
    if (cfg.enabled) {
      try { await connectMcpServer(cfg); } catch (e) { console.error(`[bg-agent] MCP ${cfg.name}:`, e); }
    }
  }
  const mcpTools = buildMcpAiTools();
  const allToolDefs = [...getAllTools(), ...Object.entries(mcpTools).map(([name, t]: [string, any]) => ({
    name,
    description: t.description ?? "",
    inputSchema: t.parameters ?? {},
    execute: async (args: Record<string, unknown>) => {
      const res = await t.execute(args);
      return res;
    },
  }))];

  const store = await getFactStore();
  const facts = await store.list();
  const memories = await getRecentMemories(5);

  let fullSystem = system;
  if (facts.length > 0) {
    fullSystem += `\n\n[Известные факты о пользователе]\n${facts.map((f) => `- [${f.id}] ${f.text}`).join("\n")}`;
  }
  if (memories.length > 0) {
    fullSystem += `\n\n[Краткие саммари недавних диалогов]\n${memories.map((m) => `- [${m.title}] ${m.summary}`).join("\n")}`;
  }

  const apiTools = convertToolsForApi(allToolDefs);
  const toolMap = new Map(allToolDefs.map((t) => [t.name, t]));

  const messages: Record<string, unknown>[] = [
    { role: "user", content: goal },
  ];

  let fullResponse = "";
  const maxRounds = 10;

  for (let round = 0; round < maxRounds; round++) {
    // Уведомляем о прогрессе
    await updateTask(taskId, { progress: `Раунд ${round + 1}/${maxRounds}...` });

    const body = {
      model: activeModel,
      messages: [{ role: "system", content: fullSystem } as Record<string, unknown>, ...messages],
      tools: apiTools.length > 0 ? apiTools : undefined,
      max_tokens: 4096,
      temperature: 0.3,
    };

    console.log(`[bg-agent] round ${round + 1}, calling API with ${messages.length} messages`);

    const res = await fetch(`${POLZAAI_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${POLZAAI_API_KEY}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`API error HTTP ${res.status}: ${errText.slice(0, 200)}`);
    }

    const data = (await res.json()) as {
      choices: Array<{
        message: {
          content?: string | null;
          tool_calls?: Array<{
            id: string;
            type: string;
            function: { name: string; arguments: string };
          }>;
        };
        finish_reason: string;
      }>;
    };

    const choice = data.choices?.[0];
    if (!choice) throw new Error("No response from API");

    const msg = choice.message;
    const text = msg.content ?? "";
    if (text) fullResponse += text + "\n";

    console.log(`[bg-agent] round ${round + 1}, finish=${choice.finish_reason}, textLen=${text.length}, toolCalls=${msg.tool_calls?.length ?? 0}`);

    // Добавляем ответ ассистента в историю
    const assistantMsg: Record<string, unknown> = { role: "assistant", content: text || null };
    if (msg.tool_calls) {
      assistantMsg.tool_calls = msg.tool_calls;
    }
    messages.push(assistantMsg as any);

    // Если нет tool_calls — задача выполнена
    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      console.log(`[bg-agent] round ${round + 1} done, no more tool calls`);
      break;
    }

    // Выполняем каждый tool
    for (const tc of msg.tool_calls) {
      const toolFn = toolMap.get(tc.function.name);
      if (!toolFn) {
        console.log(`[bg-agent] unknown tool: ${tc.function.name}`);
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: JSON.stringify({ error: `Unknown tool: ${tc.function.name}` }),
        } as any);
        continue;
      }

      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(tc.function.arguments);
      } catch {
        args = {};
      }

      console.log(`[bg-agent] executing tool: ${tc.function.name}`, args);
      await updateTask(taskId, { progress: `Выполняю: ${tc.function.name}...` });

      try {
        const result = await toolFn.execute(args);
        const resultStr = typeof result === "string" ? result : JSON.stringify(result);
        console.log(`[bg-agent] tool ${tc.function.name} result: ${resultStr.slice(0, 100)}`);
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: resultStr,
        } as any);
      } catch (err: any) {
        console.error(`[bg-agent] tool ${tc.function.name} error:`, err);
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: JSON.stringify({ error: err.message ?? String(err) }),
        } as any);
      }
    }
  }

  const result = fullResponse.trim() || "(пусто)";
  console.log(`[bg-agent] task=${taskId} final result length=${result.length}`);
  return result;
}
