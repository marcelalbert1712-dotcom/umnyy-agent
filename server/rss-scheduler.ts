import { listFeeds, checkFeed } from "./rss-store.ts";
import { getSettingsStore } from "./user-settings.ts";

const RSS_CHECK_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
let rssTimer: ReturnType<typeof setInterval> | null = null;
let running = false;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Periodically checks all RSS feeds for new items.
 * If new items found and Telegram is configured — sends a notification.
 */
async function checkAllFeedsAndNotify(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const feeds = await listFeeds();
    if (feeds.length === 0) return;

    let store: Awaited<ReturnType<typeof getSettingsStore>> | null = null;
    let settings: Awaited<ReturnType<ReturnType<typeof getSettingsStore>["get"]>> | null = null;

    for (const feed of feeds) {
      try {
        const result = await checkFeed(feed.id);
        if (!result || result.newItems.length === 0) continue;

        // Lazy-load settings
        if (!store) {
          store = await getSettingsStore();
          settings = await store.get();
        }

        if (settings?.telegramBotToken && settings?.telegramChatId) {
          const lines = result.newItems.map(
            (it) => `• ${it.title}${it.link ? "\n  ${it.link}" : ""}`
          );
          await fetch(
            `https://api.telegram.org/bot${settings.telegramBotToken}/sendMessage`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                chat_id: settings.telegramChatId,
                text: `📡 RSS: ${result.feedTitle}\n\n${lines.join("\n\n")}`.slice(0, 4000),
              }),
            }
          ).catch(() => {});
        }
      } catch {
        /* skip individual feed errors */
      }
      await sleep(500);
    }
  } finally {
    running = false;
  }
}

export function startRSSChecker(): void {
  if (rssTimer) return;
  // Initial check after 30 seconds
  setTimeout(() => void checkAllFeedsAndNotify(), 30_000);
  rssTimer = setInterval(() => void checkAllFeedsAndNotify(), RSS_CHECK_INTERVAL_MS);
}

export function stopRSSChecker(): void {
  if (rssTimer) {
    clearInterval(rssTimer);
    rssTimer = null;
  }
}