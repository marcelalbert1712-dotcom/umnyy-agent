import { generateText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
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

function getPolzaClient() {
  const apiKey = process.env.POLZAAI_API_KEY;
  if (!apiKey) throw new Error("POLZAAI_API_KEY is required");
  return createOpenAI({
    baseURL: POLZAAI_BASE_URL,
    apiKey,
    name: "polzaai",
  });
}

const activeModel = POLZAAI_MODEL_RAW.includes("@")
  ? POLZAAI_MODEL_RAW
  : `${POLZAAI_MODEL_RAW}@provider=${POLZAAI_PROVIDER}&allow_fallbacks=false`;

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
      try {
        await connectMcpServer(cfg);
      } catch (e) {
        console.error(`[bg-agent] MCP ${cfg.name}:`, e);
      }
    }
  }
  const mcpAiTools = buildMcpAiTools();
  const allTools = { ...tools, ...mcpAiTools };

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

  const messages: import("ai").CoreMessage[] = [
    { role: "user", content: goal },
  ];

  const abortController = new AbortController();
  const timeout = setTimeout(() => {
    console.log(`[bg-agent] task=${taskId} timeout (120s), aborting`);
    abortController.abort();
  }, 120_000);

  try {
    const result = await generateText({
      model: getPolzaClient().chat(activeModel),
      system: fullSystem,
      messages,
      tools: allTools,
      maxSteps: 12,
      abortSignal: abortController.signal,
      onStepFinish: async (step) => {
        const text = (step.text || "").replace(/\n+/g, " ").slice(0, 150).trim();
        const toolNames = (step.toolCalls || []).map((t) => t.toolName).join(", ");
        const progress = text
          ? `${text}${toolNames ? ` [tools: ${toolNames}]` : ""}`
          : `Вызов: ${toolNames || "думаю..."}`;
        console.log(`[bg-agent] task=${taskId} step progress: ${progress.slice(0, 80)}`);
        await updateTask(taskId, { progress });
      },
    });

    console.log(`[bg-agent] task=${taskId} done, textLen=${result.text?.length ?? 0}`);
    return result.text || "(пусто)";
  } catch (err: any) {
    if (err.name === "AbortError") {
      throw new Error("Таймаут — агент не уложился в 120 секунд");
    }
    console.error(`[bg-agent] task=${taskId} error:`, err);
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}
