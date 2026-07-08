import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

let browser: Browser | null = null;
const contexts = new Map<string, BrowserContext>();
const pages = new Map<string, Page>();

async function getBrowser(): Promise<Browser> {
  if (!browser || !browser.isConnected()) {
    browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
  }
  return browser;
}

export async function getOrCreatePage(chatId: string): Promise<Page> {
  let page = pages.get(chatId);
  try {
    // check if page is still usable
    if (page) { await page.evaluate("1"); }
  } catch {
    page = undefined;
  }
  if (!page) {
    const b = await getBrowser();
    let ctx = contexts.get(chatId);
    if (!ctx) {
      ctx = await b.newContext({
        viewport: { width: 1280, height: 720 },
        locale: "ru-RU",
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
      });
      contexts.set(chatId, ctx);
    }
    page = await ctx.newPage();
    pages.set(chatId, page);
  }
  return page;
}

export async function closeChatSession(chatId: string) {
  const page = pages.get(chatId);
  if (page) {
    try { await page.close(); } catch { /* ignore */ }
    pages.delete(chatId);
  }
  const ctx = contexts.get(chatId);
  if (ctx) {
    try { await ctx.close(); } catch { /* ignore */ }
    contexts.delete(chatId);
  }
}

export async function closeAll() {
  for (const chatId of pages.keys()) await closeChatSession(chatId);
  if (browser) {
    try { await browser.close(); } catch { /* ignore */ }
    browser = null;
  }
}
