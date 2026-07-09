import { tool } from "ai";
import { z } from "zod";
import { getOrCreatePage, closeChatSession } from "./browser-session";

/** Текущий ID чата, устанавливается перед вызовом streamText */
export let currentChatId = "default";
export function setCurrentChatId(id: string) { currentChatId = id; }
import { getFactStore } from "./user-facts.ts";

// Хелперы для поиска
function parseDdgHtml(html: string) {
  const results: { title: string; url: string; snippet: string }[] = [];
  const linkRegex = /<a[^>]+class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  const snippetRegex = /<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;
  const links: string[] = [];
  const titles: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = linkRegex.exec(html)) !== null) {
    links.push(m[1].trim());
    titles.push(m[2].replace(/<[^>]*>/g, "").trim());
  }
  const snippets: string[] = [];
  while ((m = snippetRegex.exec(html)) !== null) {
    snippets.push(m[1].replace(/<[^>]*>/g, "").trim());
  }
  for (let i = 0; i < Math.min(links.length, 5); i++) {
    results.push({
      title: titles[i] ?? `Результат ${i + 1}`,
      url: links[i]?.startsWith("http") ? links[i] : `https:${links[i]}`,
      snippet: snippets[i] ?? "",
    });
  }
  return results;
}

async function searchViaBrowser(query: string): Promise<string> {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  try {
    const ctx = await browser.newContext({
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
      locale: "en-US",
    });
    const page = await ctx.newPage();
    // Используем Bing — он не блокирует
    await page.goto(`https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=ru`, {
      waitUntil: "networkidle",
      timeout: 20000,
    });
    // Ждём появления результатов
    await page.waitForSelector("li.b_algo", { timeout: 10000 }).catch(() => {});
    // Извлекаем HTML результатов (только блоки с результатами)
    const results = await page.evaluate(() => {
      const items = document.querySelectorAll("li.b_algo");
      return Array.from(items).slice(0, 5).map((item) => ({
        title: item.querySelector("h2 a")?.textContent?.trim() ?? "",
        url: (item.querySelector("h2 a") as HTMLAnchorElement)?.href ?? "",
        snippet: item.querySelector(".b_caption p")?.textContent?.trim() ?? "",
      }));
    });
    await ctx.close();
    return JSON.stringify({ results });
  } catch (err: any) {
    console.error("[searchViaBrowser] error:", err.message);
    throw err;
  } finally {
    await browser.close().catch(() => {});
  }
}

/**
 * Инструменты агента. Каждый инструмент имеет `execute` (серверный),
 * поэтому многошаговый цикл (`stopWhen: stepCountIs`) выполняется целиком
 * на бэкенде, а на фронтенд стримятся все шаги через UI Message Stream.
 */
export const tools = {
  getCurrentTime: tool({
    description:
      "Получить текущие дату и время, опционально для конкретного часового пояса IANA (например, 'Europe/Moscow', 'Asia/Tokyo'). По умолчанию — локальное время сервера.",
    inputSchema: z.object({
      timezone: z
        .string()
        .optional()
        .describe("IANA timezone, e.g. Europe/Moscow"),
    }),
    execute: async ({ timezone }) => {
      const now = new Date();
      try {
        const formatter = new Intl.DateTimeFormat("ru-RU", {
          dateStyle: "full",
          timeStyle: "long",
          timeZone: timezone,
        });
        return {
          iso: now.toISOString(),
          formatted: formatter.format(now),
          timezone: timezone ?? "server-local",
        };
      } catch {
        return {
          iso: now.toISOString(),
          formatted: now.toString(),
          timezone: timezone ?? "server-local",
          error: "Неверный часовой пояс",
        };
      }
    },
  }),

  getWeather: tool({
    description:
      "Узнать текущую погоду в городе. Возвращает температуру (ощущаемую и фактическую), состояние, влажность и скорость ветра.",
    inputSchema: z.object({
      city: z.string().describe("Название города, например 'Москва' или 'Tokyo'"),
      units: z
        .enum(["celsius", "fahrenheit"])
        .optional()
        .describe("Единицы измерения температуры"),
    }),
    execute: async ({ city, units }) => {
      const unitParam = units === "fahrenheit" ? "fahrenheit" : "celsius";
      const tempVar =
        units === "fahrenheit" ? "temperature_2m_f" : "temperature_2m";
      const appTempVar =
        units === "fahrenheit"
          ? "apparent_temperature_f"
          : "apparent_temperature";

      // 1. Геокодирование названия города → координаты (Open-Meteo, без ключа).
      const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(
        city,
      )}&count=1&language=ru&format=json`;
      const geoRes = await fetch(geoUrl);
      if (!geoRes.ok) {
        return { city, error: `Сервис геокодирования недоступен (HTTP ${geoRes.status})` };
      }
      const geo = (await geoRes.json()) as {
        results?: { latitude: number; longitude: number; name: string; country?: string; timezone?: string }[];
      };
      const place = geo.results?.[0];
      if (!place) {
        return { city, error: `Город «${city}» не найден` };
      }

      // 2. Запрос текущей погоды по координатам (Open-Meteo, без ключа).
      const wxUrl =
        `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}` +
        `&longitude=${place.longitude}` +
        `&current=${tempVar},${appTempVar},relative_humidity_2m,weather_code,wind_speed_10m,is_day` +
        `&timezone=auto`;
      const wxRes = await fetch(wxUrl);
      if (!wxRes.ok) {
        return { city, error: `Сервис погоды недоступен (HTTP ${wxRes.status})` };
      }
      const wx = (await wxRes.json()) as {
        current?: {
          [k: string]: number | undefined;
          weather_code: number;
          is_day: number;
        };
      };
      const cur = wx.current;
      if (!cur) {
        return { city, error: "Не удалось получить текущую погоду" };
      }

      // WMO weather code → описание на русском.
      const wmo: Record<number, string> = {
        0: "Ясно",
        1: "Преимущественно ясно",
        2: "Переменная облачность",
        3: "Пасмурно",
        45: "Туман",
        48: "Изморозь",
        51: "Слабая морось",
        53: "Морось",
        55: "Сильная морось",
        56: "Ледяная морось",
        57: "Сильная ледяная морось",
        61: "Небольшой дождь",
        63: "Дождь",
        65: "Сильный дождь",
        66: "Ледяной дождь",
        67: "Сильный ледяной дождь",
        71: "Небольшой снег",
        73: "Снег",
        75: "Сильный снег",
        77: "Снежные зёрна",
        80: "Ливень",
        81: "Сильный ливень",
        82: "Очень сильный ливень",
        85: "Снегопад",
        86: "Сильный снегопад",
        95: "Гроза",
        96: "Гроза с градом",
        99: "Сильная гроза с градом",
      };
      const condition = wmo[cur.weather_code] ?? `Код ${cur.weather_code}`;

      return {
        city: place.name,
        country: place.country,
        condition,
        isDay: cur.is_day === 1,
        temperature: cur[tempVar],
        apparentTemperature: cur[appTempVar],
        humidity: cur.relative_humidity_2m,
        windSpeed: cur.wind_speed_10m,
        units: unitParam,
        timezone: place.timezone,
        coordinates: { lat: place.latitude, lon: place.longitude },
      };
    },
  }),

  webSearch: tool({
    description:
      "Искать в интернете по запросу и возвращать верхние результаты (заголовок, ссылка, сниппет, содержимое страницы). Использовать для фактических вопросов.",
    inputSchema: z.object({
      query: z.string().describe("Поисковый запрос"),
    }),
    execute: async ({ query }) => {
      // Попытка 1: прямой fetch с redirect: manual
      const res = await fetch("https://html.duckduckgo.com/html/", {
        method: "POST",
        redirect: "manual",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
        body: `q=${encodeURIComponent(query)}`,
      });

      let html: string | null = null;
      let results: { title: string; url: string; snippet: string }[] = [];
      if (res.ok) {
        html = await res.text();
        results = parseDdgHtml(html);
        if (results.length > 0) {
          // Достаём содержимое топ-ссылки
          const pageContent = await tryReadUrl(results[0].url);
          return { query, results, topPageContent: pageContent };
        }
        if (html.includes("anomaly") || html.includes("botnet") || html.includes("captcha")) {
          html = null;
        }
      }

      // Попытка 2: через Playwright (Bing)
      if (!html) {
        try {
          console.log(`[webSearch] browser fallback for: "${query.slice(0, 50)}"`);
          const jsonStr = await searchViaBrowser(query);
          const parsed = JSON.parse(jsonStr);
          results = parsed.results ?? [];
          const pageContent = results.length > 0 ? await tryReadUrl(results[0].url) : null;
          return { query, results, source: "bing", topPageContent: pageContent };
        } catch (err: any) {
          console.error(`[webSearch] browser fallback failed:`, err.message);
          return { query, results: [], error: "Поиск временно недоступен" };
        }
      }

      return { query, results: [] };
    },
  }),

  calculator: tool({
    description:
      "Вычислить математическое выражение (поддерживаются + - * / и скобки). Использовать для точных вычислений.",
    inputSchema: z.object({
      expression: z
        .string()
        .describe('Математическое выражение, например "(12+3)*4/5"'),
    }),
    execute: async ({ expression }) => {
      if (!/^[0-9+\-*/().\s]+$/.test(expression)) {
        return { expression, error: "Недопустимые символы в выражении" };
      }
      try {
        // eslint-disable-next-line no-new-func
        const result = Number(
          Function(`"use strict"; return (${expression})`)(),
        );
        return { expression, result };
      } catch (e) {
        return {
          expression,
          error: e instanceof Error ? e.message : "Ошибка вычисления",
        };
      }
    },
  }),

  generateImage: tool({
    description:
      "Сгенерировать изображение по текстовому описанию (промпту). Возвращает URL готовой картинки.",
    inputSchema: z.object({
      prompt: z
        .string()
        .describe("Детальное описание того, что нужно нарисовать"),
    }),
    execute: async ({ prompt }) => {
      const baseUrl =
        process.env.POLZAAI_BASE_URL ?? "https://api.polza.ai/v1";
      const apiKey = process.env.POLZAAI_API_KEY;

      const res = await fetch(`${baseUrl}/images/generations`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "qwen/image",
          prompt,
          n: 1,
        }),
      });

      if (!res.ok) {
        const err = await res.text();
        return { error: `Ошибка генерации: ${err}` };
      }

      const created = (await res.json()) as { requestId?: string };
      if (!created.requestId) {
        return { error: "Не удалось начать генерацию" };
      }

      for (let i = 0; i < 15; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const poll = await fetch(`${baseUrl}/media/${created.requestId}`, {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        if (!poll.ok) continue;
        const status = (await poll.json()) as {
          status?: string;
          data?: { url?: string }[];
        };
        if (status.status === "completed" && status.data?.[0]?.url) {
          return { url: status.data[0].url };
        }
        if (status.status === "failed") {
          return { error: "Ошибка генерации изображения" };
        }
      }

      return { error: "Таймаут генерации изображения" };
    },
  }),

  saveUserFact: tool({
    description:
      "Сохранить факт о пользователе в долгосрочную память. Вызывай, когда узнаёшь что-то новое о пользователе: имя, профессия, предпочтения, интересы, цели, языки, город и т.д. Перед сохранением проверь по списку известных фактов в конце диалога, нет ли уже такого факта. Не сохраняй тривиальные факты.",
    inputSchema: z.object({
      text: z
        .string()
        .describe(
          'Краткая формулировка факта, например: "Пользователя зовут Юрий" или "Предпочитает тёмную тему"',
        ),
      category: z
        .enum(["personal", "work", "preference", "hobby", "goal", "other"])
        .optional()
        .describe("Категория факта"),
    }),
    execute: async ({ text, category }) => {
      const store = await getFactStore();
      const fact = await store.add({
        text,
        category: category ?? "other",
      });
      return {
        success: true,
        id: fact.id,
        message: `Факт сохранён: ${text}`,
      };
    },
  }),

  deleteUserFact: tool({
    description:
      "Удалить факт из памяти пользователя по его ID. Используй, если факт устарел или был сохранён ошибочно.",
    inputSchema: z.object({
      id: z.string().describe("ID факта для удаления"),
    }),
    execute: async ({ id }) => {
      const store = await getFactStore();
      const deleted = await store.delete(id);
      return {
        success: deleted,
        message: deleted ? "Факт удалён" : "Факт не найден",
      };
    },
  }),

  updateUserFact: tool({
    description:
      "Изменить существующий факт о пользователе по его ID. Используй, когда информация изменилась (например, пользователь сменил работу или переехал). ID факта берёшь из списка известных фактов в конце диалога.",
    inputSchema: z.object({
      id: z.string().describe("ID факта для изменения"),
      text: z
        .string()
        .optional()
        .describe("Новая формулировка факта"),
      category: z
        .enum(["personal", "work", "preference", "hobby", "goal", "other"])
        .optional()
        .describe("Новая категория факта"),
    }),
    execute: async ({ id, text, category }) => {
      if (!text && !category) {
        return {
          success: false,
          message: "Нужно указать хотя бы одно поле для обновления (text или category)",
        };
      }
      const store = await getFactStore();
      const updated = await store.update(id, { text, category });
      return {
        success: !!updated,
        message: updated
          ? `Факт обновлён: ${updated.text}`
          : "Факт не найден",
      };
    },
  }),
  runCode: tool({
    description:
      "Выполнить JavaScript-код на сервере. Полезно для: вычислений, анализа данных, сортировки, фильтрации, работы с JSON, генерации отчётов, создания таблиц и графиков (через console.table/log). Код выполняется в Node.js с таймаутом 15 сек. Используй console.log/table для вывода. ВАЖНО: перед выполнением кода, который может изменить данные (удаление, перезапись, отправка запросов), сначала покажи пользователю что собираешься запустить и спроси подтверждения.",
    inputSchema: z.object({
      code: z.string().describe("JavaScript-код для выполнения"),
    }),
    execute: async ({ code }) => {
      const { execSync } = await import("node:child_process");
      try {
        const result = execSync(`node -e ${JSON.stringify(code)}`, {
          timeout: 15_000,
          maxBuffer: 1024 * 100,
          windowsHide: true,
          encoding: "utf8",
          env: { ...process.env, NODE_PATH: "" },
        });
        return { stdout: result.trim(), stderr: "" };
      } catch (err: any) {
        return { stdout: "", stderr: err.stderr ?? err.message ?? String(err) };
      }
    },
  }),
  browserAgent: tool({
    description:
      "Управление браузером. Доступные действия: navigate (перейти на URL — http://, https://), screenshot (сделать скриншот — возвращает data:image), click (клик по координатам x, y), type (ввод текста), scroll (прокрутка dx, dy), getText (получить текст страницы), close (закрыть сессию). Всегда делай screenshot после navigate. В ответе пользователю вставь скриншот как markdown-изображение: ![screenshot](data:image/jpeg;base64,...). Для открытия сохранённых файлов используй httpPath (например, http://localhost:5173/api/workspace/...)",
    inputSchema: z.object({
      action: z.enum(["navigate", "screenshot", "click", "type", "scroll", "getText", "close"]),
      url: z.string().optional().describe("URL для navigate"),
      x: z.number().optional().describe("координата X для click"),
      y: z.number().optional().describe("координата Y для click"),
      text: z.string().optional().describe("текст для type"),
      dx: z.number().optional().describe("прокрутка по X"),
      dy: z.number().optional().describe("прокрутка по Y (по умолчанию 300)"),
    }),
    execute: async ({ action, url, x, y, text, dx, dy }) => {
      try {
        const page = await getOrCreatePage(currentChatId);
        let result: any;
        switch (action) {
          case "navigate":
            if (!url) throw new Error("url required");
            await page.goto(url, {
              waitUntil: url.startsWith("file://") ? "load" : "networkidle",
              timeout: 30000,
            });
            result = { title: await page.title(), url: page.url() };
            break;
          case "screenshot": {
            const screenshot = await page.screenshot({ type: "jpeg", quality: 60 });
            result = { screenshot: `data:image/jpeg;base64,${screenshot.toString("base64")}` };
            break;
          }
          case "click":
            if (x == null || y == null) throw new Error("x and y required");
            await page.mouse.click(x, y);
            result = { ok: true };
            break;
          case "type":
            if (text == null) throw new Error("text required");
            await page.keyboard.type(text, { delay: 20 });
            result = { ok: true };
            break;
          case "scroll":
            await page.evaluate(({ dx, dy }: { dx: number; dy: number }) => window.scrollBy(dx, dy), { dx: dx ?? 0, dy: dy ?? 300 });
            result = { ok: true };
            break;
          case "getText": {
            const t = await page.evaluate(() => document.body?.innerText ?? "");
            result = { text: t.slice(0, 10000) };
            break;
          }
          case "close":
            await closeChatSession(currentChatId);
            result = { ok: true };
            break;
          default:
            throw new Error(`Unknown action: ${action}`);
        }
        return result;
      } catch (err: any) {
        return { error: err.message || String(err) };
      }
    },
  }),
  saveFile: tool({
    description: "Сохранить файл в рабочее пространство чата. Используй для сохранения сгенерированных HTML-страниц, скриптов, отчётов, CSV, JSON, Markdown и других файлов. После сохранения используй httpPath как ссылку для пользователя И для открытия в браузере через browserAgent navigate с http://localhost:5173/api/workspace/...",
    inputSchema: z.object({
      filename: z.string().describe("Имя файла (например, report.html, script.js, data.csv)"),
      content: z.string().describe("Содержимое файла"),
    }),
    execute: async ({ filename, content }) => {
      const { promises: fs } = await import("node:fs");
      const path = await import("node:path");
      const dir = path.join(process.cwd(), ".user-data", "workspace", currentChatId);
      await fs.mkdir(dir, { recursive: true });
      const filePath = path.join(dir, filename);
      await fs.writeFile(filePath, content, "utf8");
      return { ok: true, filePath, httpPath: `/api/workspace/${currentChatId}/${filename}` };
    },
  }),
  downloadFile: tool({
    description: "Скачать файл из интернета и сохранить в рабочее пространство чата. Поддерживает HTML, CSS, JS, JSON, CSV, изображения и другие типы. Используй для загрузки внешних ресурсов.",
    inputSchema: z.object({
      url: z.string().describe("Полный URL файла (http:// или https://)"),
      filename: z.string().optional().describe("Имя для сохранения (по умолчанию из URL)"),
    }),
    execute: async ({ url, filename }) => {
      const { promises: fs } = await import("node:fs");
      const path = await import("node:path");
      const dir = path.join(process.cwd(), ".user-data", "workspace", currentChatId);
      await fs.mkdir(dir, { recursive: true });
      const name = filename ?? (path.basename(new URL(url).pathname) || "downloaded-file");
      const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      const buf = Buffer.from(await res.arrayBuffer());
      const filePath = path.join(dir, name);
      await fs.writeFile(filePath, buf);
      return { ok: true, filePath, httpPath: `/api/workspace/${currentChatId}/${name}`, size: buf.length, contentType: res.headers.get("content-type") ?? "" };
    },
  }),
};

/** Извлечь текст из HTML (убрать теги, script, style) */
function htmlToText(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#\d{2,4};/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Извлечь число-цену из текста */
function extractPrice(text: string): string | null {
  // Приоритет: ищем цену рядом со словом Price/price/Цена/цена
  const nearPriceRegex = /(?:Price|price|Цена|цена)\s*[:•]?\s*\$(\d{1,3}(?:,\d{3})*(?:\.\d{1,6})?)/g;
  const nearMatches = [...text.matchAll(nearPriceRegex)];
  if (nearMatches.length > 0) {
    return `$${nearMatches[0][1]}`;
  }
  // Fallback: любое $число, где значение правдоподобно для цены (0.0001–999,999)
  const anyPriceRegex = /\$(\d{1,3}(?:,\d{3})*(?:\.\d{1,6})?)\s*(?!B|M|T|K|b|m|t|k)/g;
  const anyMatches = [...text.matchAll(anyPriceRegex)];
  for (const m of anyMatches) {
    const val = parseFloat(m[1].replace(/,/g, ""));
    if (val > 0 && val < 1_000_000) return `$${m[1]}`;
  }
  return null;
}

/** Прочитать содержимое URL — возвращает структуру { title, pageText, price } */
async function readUrlContent(url: string): Promise<{
  title: string;
  pageText: string;
  price: string | null;
} | null> {
  if (!url.startsWith("http://") && !url.startsWith("https://")) return null;
  try {
    const resp = await fetch(url, {
      signal: AbortSignal.timeout(10000),
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,*/*",
      },
    });
    if (!resp.ok) return null;
    const ct = resp.headers.get("content-type") ?? "";
    if (!ct.includes("text/html") && !ct.includes("text/plain")) return null;
    const raw = await resp.text();

    // Title из <title>
    const titleMatch = raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : "";

    // OG title
    const ogMatch = raw.match(/<meta[^>]+property="og:title"[^>]+content="([^"]*)"[^>]*\/?>/i);
    const ogTitle = ogMatch ? ogMatch[1].trim() : "";

    // JSON-LD — ищем schema.org/Product с ценой
    let jsonLdPrice: string | null = null;
    const jsonLdBlocks = raw.match(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi);
    if (jsonLdBlocks) {
      for (const block of jsonLdBlocks) {
        const json = block.replace(/<\/?script[^>]*>/gi, "");
        try {
          const data = JSON.parse(json.trim());
          const offerPrice = data?.offers?.price ?? data?.mainEntity?.offers?.price;
          if (offerPrice) {
            const priceStr = String(offerPrice);
            // Игнорируем если это явно не цена (миллиарды)
            if (!priceStr.includes("e") && parseFloat(priceStr) < 1_000_000) {
              jsonLdPrice = `$${priceStr}`;
            }
          }
        } catch { /* ignore */ }
      }
    }

    // Текстовое содержимое
    const pageText = htmlToText(raw).slice(0, 2000);

    // Извлекаем цену: приоритет JSON-LD > raw text
    const price = jsonLdPrice ?? extractPrice(pageText);

    const summary = [title, ogTitle ? `(${ogTitle})` : "", pageText].filter(Boolean).join(" — ").slice(0, 2000);
    return { title, pageText: summary, price };
  } catch {
    return null;
  }
}

/** Упрощённая обёртка: читает URL и возвращает текст + цену */
async function tryReadUrl(url: string): Promise<string | null> {
  const content = await readUrlContent(url);
  if (!content) return null;
  const priceLine = content.price ? `💰 Цена: ${content.price}` : "";
  return [priceLine, content.pageText].filter(Boolean).join("\n").slice(0, 2000);
}
