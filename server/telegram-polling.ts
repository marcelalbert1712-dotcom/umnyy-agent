import { getSettingsStore } from "./user-settings.ts";
import { getTextResponse } from "./polza-client.ts";
import { promises as fs } from "node:fs";
import path from "node:path";

let pollingTimer: ReturnType<typeof setInterval> | null = null;
let lastUpdateId = 0;
const HISTORY_DIR = path.join(process.cwd(), ".user-data", "telegram-chats");

type HistoryEntry = { role: "user" | "assistant"; text: string; ts: number };

async function ensureDir() {
  await fs.mkdir(HISTORY_DIR, { recursive: true });
}

async function loadHistory(tgChatId: string): Promise<HistoryEntry[]> {
  try {
    const raw = await fs.readFile(path.join(HISTORY_DIR, `${tgChatId}.json`), "utf8");
    return JSON.parse(raw) as HistoryEntry[];
  } catch {
    return [];
  }
}

async function saveHistory(tgChatId: string, history: HistoryEntry[]) {
  await ensureDir();
  const recent = history.slice(-20); // храним последние 20 сообщений
  await fs.writeFile(path.join(HISTORY_DIR, `${tgChatId}.json`), JSON.stringify(recent, null, 2));
}

async function sendTelegramMessage(token: string, chatId: string, text: string) {
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (e) {
    console.error("[tg-polling] sendMessage error:", e);
  }
}

async function poll() {
  try {
    const store = await getSettingsStore();
    const settings = await store.get();
    const token = settings.telegramBotToken;
    const allowedChatId = settings.telegramChatId;
    if (!token || !allowedChatId) return;

    const res = await fetch(
      `https://api.telegram.org/bot${token}/getUpdates?offset=${lastUpdateId + 1}&timeout=10`,
      { signal: AbortSignal.timeout(15_000) },
    );
    if (!res.ok) return;
    const data: any = await res.json();
    if (!data.ok || !data.result?.length) return;

    for (const update of data.result) {
      if (update.update_id >= lastUpdateId) lastUpdateId = update.update_id;
      const msg = update.message || update.edited_message;
      if (!msg) continue;
      const tgChatId = String(msg.chat.id);
      if (tgChatId !== allowedChatId) continue;

      const text = (msg.text || msg.caption || "").trim();
      if (!text) continue;

      console.log(`[tg-polling] message from ${tgChatId}: "${text.slice(0, 80)}"`);

      // Отвечаем сразу, что приняли
      await sendTelegramMessage(token, tgChatId, "⏳ Обрабатываю запрос...");

      // Загружаем историю, добавляем сообщение пользователя
      const history = await loadHistory(tgChatId);
      history.push({ role: "user", text, ts: Date.now() });

      // Формируем контекст для AI
      const contextMsg = history
        .slice(-6)
        .map((e) => `${e.role === "user" ? "Пользователь" : "Ассистент"}: ${e.text}`)
        .join("\n\n");
      const fullPrompt = `${contextMsg}\n\nАссистент:`;

      // Создаём уникальный chatId для этого Telegram чата
      const internalChatId = `telegram_${tgChatId}`;

      const response = await getTextResponse(fullPrompt, internalChatId);

      // Сохраняем в историю
      history.push({ role: "assistant", text: response, ts: Date.now() });
      await saveHistory(tgChatId, history);

      // Отправляем ответ
      await sendTelegramMessage(token, tgChatId, response);
    }
  } catch (e) {
    // Тишина — polling не должен ломаться
  }
}

export function startTelegramPolling() {
  if (pollingTimer) return;
  console.log("[tg-polling] started (interval: 5s)");
  // Сразу делаем первый poll
  poll();
  pollingTimer = setInterval(poll, 5000);
}

export function stopTelegramPolling() {
  if (pollingTimer) {
    clearInterval(pollingTimer);
    pollingTimer = null;
    console.log("[tg-polling] stopped");
  }
}
