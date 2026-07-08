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

export async function runBackgroundAgent(
  taskId: string,
  chatId: string,
  goal: string,
): Promise<string> {
  setCurrentChatId(chatId);

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

  // Добавляем факты и памяти в system prompt (не в messages — PolzaAI не любит system в messages + system параметр)
  let fullSystem = system;
  if (facts.length > 0) {
    fullSystem += `\n\n[Известные факты о пользователе — используй для персонализации]\n${facts.map((f) => `- [${f.id}] ${f.text}`).join("\n")}`;
  }
  if (memories.length > 0) {
    fullSystem += `\n\n[Краткие саммари недавних диалогов]\n${memories.map((m) => `- [${m.title}] ${m.summary}`).join("\n")}`;
  }

  const messages: import("ai").CoreMessage[] = [
    { role: "user", content: goal },
  ];

  const result = await generateText({
    model: getPolzaClient().chat(
      `${POLZAAI_MODEL_RAW}@provider=${POLZAAI_PROVIDER}&allow_fallbacks=false`,
    ),
    system: fullSystem,
    messages,
    tools: allTools,
    maxSteps: 15,
    onStepFinish: async (step) => {
      const text = (step.text || "").replace(/\n+/g, " ").slice(0, 150).trim();
      await updateTask(taskId, { progress: text || "Выполняется..." });
    },
  });

  return result.text || "(пусто)";
}
