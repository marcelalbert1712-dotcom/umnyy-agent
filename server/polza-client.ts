import {
  stepCountIs,
  streamText,
  type ModelMessage,
  type UIMessage,
} from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { tools, setCurrentChatId } from "./tools.ts";
import { getFactStore } from "./user-facts.ts";
import { getSettingsStore } from "./user-settings.ts";
import { buildSystemPrompt } from "./presets.ts";

const POLZAAI_BASE_URL =
  process.env.POLZAAI_BASE_URL ?? "https://api.polza.ai/v1";

const POLZAAI_MODEL_RAW =
  process.env.POLZAAI_MODEL ?? "openai/gpt-4o-mini";
const POLZAAI_PROVIDER = process.env.POLZAAI_PROVIDER ?? "OpenAI";
const POLZAAI_MODEL = POLZAAI_MODEL_RAW.includes("@")
  ? POLZAAI_MODEL_RAW
  : `${POLZAAI_MODEL_RAW}@provider=${POLZAAI_PROVIDER}&allow_fallbacks=false`;

function getPolzaClient() {
  const apiKey = process.env.POLZAAI_API_KEY;
  if (!apiKey) {
    throw new Error("POLZAAI_API_KEY is required");
  }

  return createOpenAI({
    baseURL: POLZAAI_BASE_URL,
    apiKey,
    name: "polzaai",
  });
}

export const SYSTEM_PROMPT = `Ты — автономный ИИ-агент. Твоя цель — самостоятельно выполнять сложные многошаговые задачи, планируя и используя инструменты.

Доступные инструменты:
- getCurrentTime — текущие дата/время
- getWeather — погода в городе
- webSearch — поиск в интернете
- calculator — точные вычисления
- generateImage — генерация изображений
- runCode — выполнение JavaScript-кода (анализ данных, сортировка, генерация отчётов, таблиц)
- saveFile — сохранение файла в рабочее пространство (HTML, JS, CSV, JSON, отчёты)
- browserAgent — управление браузером: navigate, screenshot, click, type, scroll, getText, close. Всегда делай screenshot после navigate чтобы увидеть страницу.
- saveUserFact / updateUserFact / deleteUserFact — управление памятью о пользователе

Агентский подход:
1. ПЛАНИРУЙ: Прежде чем действовать, составь план. Напиши краткий план действий в теге reasoning.
2. ИСПОЛНЯЙ: Используй инструменты последовательно. Если задача сложная — разбей на шаги.
3. АНАЛИЗИРУЙ: Получив результаты, проанализируй их и прими решение о следующем шаге.
4. СООБЩИ: Дай пользователю полный ответ с результатами.

Пример многошаговой задачи:
Пользователь: "Найди топ-5 IT-компаний и сравни их акции"
Агент: (reasoning) План: 1. Поиск IT-компаний через webSearch 2. Поиск цен акций 3. Анализ через runCode 4. Сводка
→ webSearch("top tech companies 2025")
→ webSearch("stock prices AAPL MSFT GOOG AMZN NVDA")
→ runCode("анализ и сортировка данных")
→ Итоговый ответ с таблицей

Правила:
- Для фактических вопросов (время, погода, факты) и арифметики всегда используй подходящий инструмент.
- Если запрос содержит несколько независимых частей, вызывай несколько инструментов в одном шаге.
- Получив результаты инструментов, давай чёткий итоговый ответ пользователю.
- Отвечай на языке пользователя (по умолчанию — русском).
- Если пользователь допустил опечатку или грамматическую ошибку в запросе, мысленно исправь её и отвечай так, как будто запрос был написан правильно. Не указывай пользователю на ошибку явно — просто дай правильный ответ.
- Для схем, блок-схем, графов, таймлайнов и иерархий используй ASCII-диаграммы в блоках кода с языком "ascii". Рисуй рамки, стрелки, связи символами. Пример с псевдографикой: ┌─────┐ -> ┌─────┐.
- Если нужно нарисовать красивую блок-схему, ты можешь сгенерировать SVG-код внутри блока с языком "svg". Он будет отрендерен как изображение. Используй inline SVG с простыми формами (rect, circle, text, path, line).
- Для сложных диаграмм (графы, последовательности, классы, ER, Gantt, mindmap, timeline) используй Mermaid-синтаксис внутри блока кода с языком "mermaid". Он будет отрендерен как диаграмма.
- Для создания HTML-страниц, отчётов, CSV, JSON и других файлов: сгенерируй содержимое и сохрани через saveFile. После сохранения файла: (а) дай пользователю ссылку httpPath (кликабельная); (б) можешь открыть файл в браузере через browserAgent navigate с URL file:// + filePath. Всегда делай screenshot после navigate чтобы показать пользователю.

Память о пользователе:
- Список уже известных фактов о пользователе передаётся тебе в конце диалога (в виде «- [id] текст»). Используй его для персонализации ответов, но не упоминай явно, что у тебя есть список.
- Когда узнаёшь что-то новое о пользователе (имя, профессия, предпочтения, интересы, цели, город, языки) — вызывай saveUserFact. Сначала проверь по списку выше, нет ли уже такого факта, чтобы избежать дубликатов.
- Если факт изменился (сменил работу, переехал, изменились предпочтения) — возьми его ID из списка выше и вызови updateUserFact.
- Если факт устарел или ошибочен — возьми его ID из списка выше и вызови deleteUserFact.`;

function stripDataUrlPrefix(url: string): string {
  const comma = url.indexOf(",");
  return comma >= 0 ? url.slice(comma + 1) : url;
}

const MEDIA_TYPE_FIXES: Record<string, string> = {
  "aplication/pdf": "application/pdf",
  "image/png": "image/png",
  "image/jpeg": "image/jpeg",
};

function normalizeMediaType(raw: string): string {
  return MEDIA_TYPE_FIXES[raw.toLowerCase()] ?? raw;
}

function getToolName(part: { type: string; toolName?: string }): string {
  return part.toolName ?? (part.type.startsWith("tool-") ? part.type.slice("tool-".length) : "");
}

function uiMessagesToCoreMessages(messages: UIMessage[]): ModelMessage[] {
  const result: ModelMessage[] = [];

  for (const msg of messages) {
    if (msg.role === "system") {
      const text = msg.parts
        .filter((p) => p.type === "text")
        .map((p) => (p as { text: string }).text)
        .join("");
      result.push({ role: "system", content: text });
      continue;
    }

    if (msg.role === "user") {
      const content: Array<
        | { type: "text"; text: string }
        | { type: "file"; data: string; mediaType: string; filename?: string }
      > = [];
      for (const part of msg.parts) {
        if (part.type === "text" && (part as { text: string }).text) {
          content.push({ type: "text", text: (part as { text: string }).text });
        } else if (part.type === "file") {
          const url = (part as { url: string }).url;
          const isDataUrl = typeof url === "string" && url.startsWith("data:");
          content.push({
            type: "file",
            mediaType: normalizeMediaType((part as { mediaType: string }).mediaType),
            filename: (part as { filename?: string }).filename,
            data: isDataUrl ? stripDataUrlPrefix(url) : url,
          });
        }
      }
      result.push({ role: "user", content });
      continue;
    }

    if (msg.role === "assistant") {
      const assistantContent: Array<
        | { type: "text"; text: string }
        | { type: "tool-call"; toolCallId: string; toolName: string; input: unknown }
        | { type: "reasoning"; text: string }
      > = [];
      const toolResults: Array<{
        type: "tool-result";
        toolCallId: string;
        toolName: string;
        output: { type: "text"; value: string };
      }> = [];

      for (const part of msg.parts) {
        if (part.type === "text" && (part as { text: string }).text) {
          assistantContent.push({ type: "text", text: (part as { text: string }).text });
        } else if (part.type === "reasoning") {
          assistantContent.push({ type: "reasoning" as const, text: (part as { text: string }).text });
        } else if (part.type === "dynamic-tool" || part.type.startsWith("tool-")) {
          const tp = part as {
            type: string;
            toolCallId: string;
            toolName?: string;
            state: string;
            input?: unknown;
            output?: unknown;
            errorText?: string;
          };
          const toolName = getToolName(tp);
          if (tp.state !== "input-streaming") {
            assistantContent.push({
              type: "tool-call",
              toolCallId: tp.toolCallId,
              toolName,
              input: tp.input ?? {},
            });
          }
          if (tp.state === "output-available" || tp.state === "output-error") {
            toolResults.push({
              type: "tool-result",
              toolCallId: tp.toolCallId,
              toolName,
              output: {
                type: "text",
                value:
                  tp.state === "output-error"
                    ? tp.errorText ?? "Error"
                    : typeof tp.output === "string"
                      ? tp.output
                      : JSON.stringify(tp.output ?? ""),
              },
            });
          }
        }
      }

      if (assistantContent.length > 0) {
        result.push({ role: "assistant", content: assistantContent });
      }
      if (toolResults.length > 0) {
        result.push({ role: "tool", content: toolResults });
      }
    }
  }

  return result;
}

export async function streamChatResponse(
  messages: UIMessage[],
  abortSignal?: AbortSignal,
  customModel?: string,
  customTemperature?: number,
  chatId?: string,
): Promise<Response> {
  if (chatId) setCurrentChatId(chatId);
  const settingsStore = await getSettingsStore();
  const settings = await settingsStore.get();
  const system = buildSystemPrompt(
    SYSTEM_PROMPT,
    settings.preset,
    settings.customPrompt,
  );

  // Модель: приоритет у переданной в запросе → настройки пользователя → env
  const effectiveModel = customModel ?? (settings.model || POLZAAI_MODEL_RAW);
  const effectiveTemperature = customTemperature ?? settings.temperature ?? undefined;

  const coreMessages = uiMessagesToCoreMessages(messages);
  const fileMsgs = coreMessages.filter(
    (m) => m.role === "user" && Array.isArray(m.content) && (m.content as unknown as Array<{ type: string }>).some((p) => p.type === "file"),
  );
  console.log(`[polza-client] messages: ${coreMessages.length}, with files: ${fileMsgs.length}`);
  for (const fm of fileMsgs) {
    if (typeof fm.content === "string") continue;
    const fileParts = (fm.content as Array<{ type: string; data: string }>).filter((p) => p.type === "file");
    for (const fp of fileParts) {
      console.log(`[polza-client] file part: mediaType=${(fp as any).mediaType}, data length=${(fp.data as string).length}, starts with data: ${fp.data.startsWith("data:")}`);
    }
  }

  const store = await getFactStore();
  const facts = await store.list();
  if (facts.length > 0) {
    const factsText = facts
      .map((f) => `- [${f.id}] ${f.text}`)
      .join("\n");
    coreMessages.push({
      role: "system",
      content: `[Известные факты о пользователе — используй для персонализации, не упоминай наличие списка. ID в квадратных скобках нужны для updateUserFact/deleteUserFact.]\n${factsText}`,
    });
  }

  const activeModel = effectiveModel
    ? `${effectiveModel}@provider=${POLZAAI_PROVIDER}&allow_fallbacks=false`
    : POLZAAI_MODEL;
  console.log(`[polza-client] calling streamText with model=${activeModel}${effectiveTemperature != null ? `, temperature=${effectiveTemperature}` : ""}`);

  try {
    const result = streamText({
      model: getPolzaClient().chat(activeModel),
      system,
      messages: coreMessages,
      tools,
      allowSystemInMessages: true,
      temperature: effectiveTemperature,
      stopWhen: stepCountIs(8),
      abortSignal,
    });

    const response = result.toUIMessageStreamResponse({
      onError: (error) => {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`[polza-client] stream error: ${msg}`);
        return msg;
      },
      onFinish: (event) => {
        const textParts = event.responseMessage.parts.filter((p) => p.type === "text").map((p) => (p as { text?: string }).text ?? "").join("");
        console.log(`[polza-client] stream finished, reason=${event.finishReason}, responseParts=${event.responseMessage.parts.length}, textLen=${textParts.length}`);
      },
    });

    console.log(`[polza-client] response created, status=${response.status}`);
    return response;
  } catch (err) {
    console.error(`[polza-client] streamText threw:`, err);
    throw err;
  }
}
