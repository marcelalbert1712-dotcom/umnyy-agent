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
import path from "node:path";
import { promises as fs } from "node:fs";
import { buildSystemPrompt } from "./presets.ts";
import { connectMcpServer, buildMcpAiTools } from "./mcp-manager";
import { saveSessionMemory, getRecentMemories } from "./session-memory";

const EXTRACT_MODEL = process.env.POLZAAI_MODEL ?? "openai/gpt-4o-mini";

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
- downloadFile — скачать файл из интернета и сохранить в рабочее пространство
- readFile — прочитать файл из workspace (PDF, Excel, Word, JSON, CSV, TXT, код) и получить содержимое
- deploySite — опубликовать папку с HTML/CSS/JS как публичный сайт (localtunnel). Сначала сохрани файлы через saveFile, затем deploySite("имя-папки")
- undeploy — отключить опубликованный сайт
- sendTelegram — отправить сообщение в Telegram (нужна настройка бота в admin-панели)
- auditResult — проверить файлы в workspace на битые ссылки, валидность JSON, орфографию
- synthesizeKnowledge — собрать информацию из нескольких URL/файлов в единый документ (Markdown/HTML/Obsidian)
- deployGithubPages — опубликовать папку из workspace на GitHub Pages (нужен GitHub Token в admin-панели)
- exportChat — экспортировать текущий диалог в Markdown/HTML и сохранить в workspace
- generateQrCode — создать QR-код из URL/текста, сохранить PNG в workspace
- zipWorkspace — упаковать файлы из workspace в ZIP-архив
- sendEmail — отправить email через SMTP (нужна настройка в admin-панели)
- getExchangeRates — актуальные курсы валют (базовая USD/EUR)
- getCryptoPrice — цены криптовалют (Bitcoin, Ethereum, Solana и др.)
- getYoutubeTranscript — извлечь текст расшифровки из YouTube-видео
- ocrImage — распознать текст на изображении (OCR, rus+eng)
- markdownToPdf — конвертировать Markdown-файл в PDF
- compareTexts — сравнить два текста построчно (diff)
- batchTranslate — массовый перевод массива текстов через AI
- factCheck — проверить утверждение через веб-поиск, оценить достоверность
- subscribeRSS / listRSSFeeds / checkRSS / unsubscribeRSS — подписка на RSS-ленты, проверка новых статей (уведомления в Telegram)
- scheduleTask / listScheduledTasks / deleteScheduledTask — cron-задачи: выполнять промпт по расписанию (результат в Telegram)
- showNotification — показать системное уведомление на рабочем столе (toast/balloon)
- generateMindMap — построить интерактивный Mind Map графф из фактов о пользователе, визуализация связей по категориям
- pythonInfo — проверить Python-окружение, версию, установленные пакеты (создаёт sandbox если не существует)
- installPackage — установить Python-пакеты в sandbox (numpy, pandas, matplotlib и др.)
- runPython — выполнить Python-скрипт в sandbox с ранее установленными пакетами
- getVideoInfo — информация о видеофайле (длительность, кодек, разрешение)
- extractVideoFrames — извлечь кадры из видео (PNG), затем проанализируй их vision API
- extractVideoAudio — извлечь аудиодорожку из видео (WAV)
- transcribeAudioFile — расшифровать аудиофайл из workspace через Whisper
- browserAgent — управление браузером: navigate, screenshot, click, type, scroll, getText, close. Всегда делай screenshot после navigate чтобы увидеть страницу.
- saveUserFact / updateUserFact / deleteUserFact — управление памятью о пользователе
- invokeAgent — делегировать подзадачу суб-агенту. Используй для параллельного выполнения независимых задач (например, собрать цены с разных сайтов, найти информацию по разным темам). Вызывай несколько invokeAgent в одном шаге для параллельной работы.

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
- НИКОГДА не отвечай на вопросы о текущих ценах, курсах, рейтингах, списках (топ-N) из своей памяти. Всегда вызывай webSearch. Если нужно несколько цен — вызови один общий поиск, затем runCode чтобы распарсить и сравнить. Пример: "цены биткоин ethereum solana" → webSearch → runCode для таблицы.
- Для скачивания картинок используй прямые URL Unsplash/Pexels/Pixabay (https://images.unsplash.com/..., https://images.pexels.com/...). НЕ используй ссылки из поисковой выдачи Bing (https://www.bing.com/ck/a/...) — они не работают. Если не знаешь прямую ссылку на картинку, сначала webSearch чтобы найти её, затем downloadFile.
- Если запрос содержит несколько независимых подзадач, вызывай все соответствующие инструменты в одном шаге (параллельно), а не последовательно. Например, чтобы узнать погоду в трёх городах — вызови getWeather трижды сразу. Для сложных независимых задач (собрать цены с 3 сайтов, найти инфу из 2 источников) — вызывай invokeAgent параллельно для каждой подзадачи.
- Если запрос содержит несколько независимых частей, вызывай несколько инструментов в одном шаге.
- Для сложных исследовательских задач делегируй суб-агентам. Пример: "Сравни iPhone 16 Pro и Samsung S25 Ultra" → invokeAgent("собери характеристики iPhone 16 Pro") + invokeAgent("собери характеристики Samsung S25 Ultra") в одном шаге, затем проанализируй результаты.
- Получив результаты инструментов, давай чёткий итоговый ответ пользователю.
- Отвечай на языке пользователя (по умолчанию — русском).
- Если пользователь допустил опечатку или грамматическую ошибку в запросе, мысленно исправь её и отвечай так, как будто запрос был написан правильно. Не указывай пользователю на ошибку явно — просто дай правильный ответ.
- Для схем, блок-схем, графов, таймлайнов и иерархий используй ASCII-диаграммы в блоках кода с языком "ascii". Рисуй рамки, стрелки, связи символами. Пример с псевдографикой: ┌─────┐ -> ┌─────┐.
- Если нужно нарисовать красивую блок-схему, ты можешь сгенерировать SVG-код внутри блока с языком "svg". Он будет отрендерен как изображение. Используй inline SVG с простыми формами (rect, circle, text, path, line).
- Для сложных диаграмм (графы, последовательности, классы, ER, Gantt, mindmap, timeline) используй Mermaid-синтаксис внутри блока кода с языком "mermaid". Он будет отрендерен как диаграмма.
- Для создания HTML-страниц, отчётов, CSV, JSON и других файлов: сгенерируй содержимое и сохрани через saveFile. После сохранения используй httpPath (http://localhost:5173/api/workspace/...) — для ссылки пользователю И для browserAgent navigate. Всегда делай screenshot после navigate.

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

async function uiMessagesToCoreMessages(messages: UIMessage[], chatId?: string): Promise<ModelMessage[]> {
  const result: ModelMessage[] = [];

  // Keep only last 30 messages to avoid context overflow
  // (each message can contain tool results, screenshots, etc.)
  const recentMessages = messages.length > 30 ? messages.slice(-30) : messages;

  for (const msg of recentMessages) {
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
        | { type: "image"; image: string }
      > = [];
      for (const part of msg.parts) {
        if (part.type === "text" && (part as { text: string }).text) {
          content.push({ type: "text", text: (part as { text: string }).text });
        } else if (part.type === "file") {
          const url = (part as { url: string }).url;
          const isDataUrl = typeof url === "string" && url.startsWith("data:");
          const mediaType = normalizeMediaType((part as { mediaType: string }).mediaType);
          const data = isDataUrl ? stripDataUrlPrefix(url) : url;
          // Image → vision format для AI
          if (mediaType.startsWith("image/")) {
            const imageUrl = isDataUrl ? url : `data:${mediaType};base64,${data}`;
            content.push({ type: "image", image: imageUrl });
          } else if (mediaType.startsWith("video/") || mediaType.startsWith("audio/")) {
            // Video/audio files: save to workspace, add text note (AI doesn't support raw files)
            const filename = (part as { filename?: string }).filename ?? `uploaded-${Date.now()}`;
            if (isDataUrl && chatId) {
              try {
                const wsDir = path.join(process.cwd(), ".user-data", "workspace", chatId);
                await fs.mkdir(wsDir, { recursive: true });
                const savePath = path.join(wsDir, filename);
                await fs.writeFile(savePath, Buffer.from(data, "base64"));
              } catch { /* ignore save errors */ }
            }
            content.push({
              type: "text",
              text: `[Загружен файл: ${filename}]\n(используй getVideoInfo/extractVideoFrames/extractVideoAudio для анализа)`,
            });
          } else {
            content.push({ type: "file", mediaType, filename: (part as { filename?: string }).filename, data });
          }
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
            let rawValue: string;
            if (tp.state === "output-error") {
              rawValue = tp.errorText ?? "Error";
            } else if (typeof tp.output === "string") {
              rawValue = tp.output;
            } else {
              // Truncate long outputs (screenshots, big HTML, etc.)
              const str = JSON.stringify(tp.output ?? "");
              rawValue = str;
            }
            // Aggressive truncation: keep tool results short for context window
            // Screenshots (base64 images) can be 100KB+ — strip them entirely
            if (rawValue.length > 2000) {
              // Check if it contains base64 image data
              const cleaned = rawValue.replace(/data:image\/[^;]+;base64,[A-Za-z0-9+/=]{100,}/g, "[base64-image-stripped]");
              rawValue = cleaned.length > 2000 ? cleaned.slice(0, 1500) + "\n...[truncated]" : cleaned;
            }
            toolResults.push({
              type: "tool-result",
              toolCallId: tp.toolCallId,
              toolName,
              output: { type: "text", value: rawValue },
            });
          }
        }
      }

      // Filter out orphaned tool-calls (have call but no result in history)
      const resultIds = new Set(toolResults.map((r) => r.toolCallId));
      const filteredContent = assistantContent.filter((c) =>
        c.type !== "tool-call" || resultIds.has(c.toolCallId)
      );

      if (filteredContent.length > 0) {
        result.push({ role: "assistant", content: filteredContent });
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

  // ── MCP: синхронизируем подключения с настройками ──────────────
  const configuredIds = new Set(settings.mcpServers.filter((s) => s.enabled).map((s) => s.id));
  for (const cfg of settings.mcpServers) {
    if (cfg.enabled) {
      try { await connectMcpServer(cfg); } catch (e) { console.error(`[mcp] failed to connect ${cfg.name}:`, e); }
    }
  }
  const mcpAiTools = buildMcpAiTools();
  const allTools = { ...tools, ...mcpAiTools };

  // ── Модель: приоритет у переданной в запросе → настройки пользователя → env
  const effectiveModel = customModel ?? (settings.model || POLZAAI_MODEL_RAW);
  const effectiveTemperature = customTemperature ?? settings.temperature ?? undefined;

  const coreMessages = await uiMessagesToCoreMessages(messages, chatId);
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

  // Session memories — краткие саммари прошлых диалогов
  const memories = await getRecentMemories(5);
  if (memories.length > 0) {
    const memoriesText = memories
      .map((m) => `- [${m.title}] ${m.summary}`)
      .join("\n");
    coreMessages.push({
      role: "system",
      content: `[Краткие саммари недавних диалогов — используй для контекста, если пользователь ссылается на прошлые обсуждения]\n${memoriesText}`,
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
      tools: allTools,
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
        // Авто-извлечение фактов (fire-and-forget)
        setTimeout(async () => {
          try {
            const lastUser = coreMessages.filter((m) => m.role === "user").pop();
            if (!lastUser) return;
            const userContent = typeof lastUser.content === "string"
              ? lastUser.content
              : (lastUser.content as Array<{ type: string; text?: string }>)
                  .filter((c) => c.type === "text")
                  .map((c) => c.text ?? "")
                  .join(" ");
            if (!userContent || !textParts) return;
            const extractRes = await fetch(`${POLZAAI_BASE_URL}/chat/completions`, {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${POLZAAI_API_KEY}` },
              body: JSON.stringify({
                model: EXTRACT_MODEL,
                messages: [
                  {
                    role: "user",
                    content: `Извлеки новые факты о пользователе из этого диалога. Верни ТОЛЬКО JSON-массив, без пояснений: [{"text": "факт", "category": "personal|work|preference|hobby|goal|other"}]. Если фактов нет — [].\n\nПользователь: ${userContent}\n\nАссистент: ${textParts}`,
                  },
                ],
                max_tokens: 500,
                temperature: 0.1,
              }),
              signal: AbortSignal.timeout(10_000),
            });
            if (!extractRes.ok) return;
            const extractData = await extractRes.json();
            const raw = extractData.choices?.[0]?.message?.content ?? "";
            const jsonStr = raw.replace(/^```(?:json)?\s*([\s\S]*?)```$/m, "$1").trim();
            const extracted = JSON.parse(jsonStr);
            if (Array.isArray(extracted) && extracted.length > 0) {
              const factStore = await getFactStore();
              const existing = await factStore.list();
              for (const f of extracted) {
                if (f.text && !existing.some((e) => e.text.toLowerCase() === f.text.toLowerCase())) {
                  await factStore.add({ text: f.text, category: f.category || "other" });
                  console.log(`[polza-client] auto-fact saved: ${f.text}`);
                }
              }
            }
          } catch { /* silent — фоновая задача не должна ломать ответ */ }
        }, 0);
        // Сохранение саммари диалога (fire-and-forget)
        setTimeout(async () => {
          try {
            const chatTitle = messages.find((m) => m.role === "user")?.parts
              .filter((p) => p.type === "text")
              .map((p: any) => p.text)
              .join(" ")
              ?.trim()
              ?.slice(0, 80) ?? "Диалог";
            const summary = textParts ? textParts.replace(/\n+/g, " ").slice(0, 200).trim() + "…" : "(пусто)";
            if (chatId) await saveSessionMemory(chatId, chatTitle, summary);
          } catch { /* silent */ }
        }, 0);
      },
    });

    console.log(`[polza-client] response created, status=${response.status}`);
    return response;
  } catch (err) {
    console.error(`[polza-client] streamText threw:`, err);
    throw err;
  }
}
