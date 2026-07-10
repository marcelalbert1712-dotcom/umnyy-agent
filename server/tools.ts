import { tool } from "ai";
import { z } from "zod";
import { getOrCreatePage, closeChatSession } from "./browser-session";
import http from "node:http";

/** Текущий ID чата, устанавливается перед вызовом streamText */
export let currentChatId = "default";
export function setCurrentChatId(id: string) { currentChatId = id; }
import { getFactStore } from "./user-facts.ts";

/** Активные публикации deploySite: chatId → { server, tunnel, port } */
const activeDeployments = new Map<string, { server: http.Server; tunnel: any; port: number }>();

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
  // Используем полный Chrome (GUI-приложение — не показывает консоль),
  // а не headless_shell (консольное приложение — всегда открывает окно).
  const chromePath = "C:\\Users\\!!!~1\\AppData\\Local\\ms-Playwright\\chromium-1228\\chrome-win64\\chrome.exe";
  const browser = await chromium.launch({
    headless: true,
    executablePath: chromePath,
    args: ["--no-sandbox"],
  });
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
      const res = await fetch(url, {
        signal: AbortSignal.timeout(30_000),
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length === 0) throw new Error("Файл пустой (0 байт). Проверь URL.");
      const filePath = path.join(dir, name);
      await fs.writeFile(filePath, buf);
      return { ok: true, filePath, httpPath: `/api/workspace/${currentChatId}/${name}`, size: buf.length, contentType: res.headers.get("content-type") ?? "" };
    },
  }),
  readFile: tool({
    description: "Прочитать содержимое файла из workspace. Поддерживает: PDF (текст), Excel (.xlsx/.xls — таблицы), Word (.docx — текст/HTML), JSON, CSV, TXT, JS, HTML, CSS. Автоматически определяет тип по расширению.",
    inputSchema: z.object({
      filename: z.string().describe("Имя файла (относительно workspace чата), например 'report.pdf' или 'data.xlsx'"),
      page: z.number().int().positive().optional().describe("Номер страницы для PDF (по умолчанию — все)"),
    }),
    execute: async ({ filename, page }) => {
      const path = await import("node:path");
      const { promises: fs } = await import("node:fs");
      const filePath = path.join(process.cwd(), ".user-data", "workspace", currentChatId, filename);
      try {
        await fs.access(filePath);
      } catch {
        return { error: `Файл не найден: ${filename}. Используй saveFile или downloadFile сначала.` };
      }
      const ext = path.extname(filename).toLowerCase();
      const buffer = await fs.readFile(filePath);

      if (ext === ".pdf") {
        const pdfParse = (await import("pdf-parse")).default;
        const data = await pdfParse(buffer);
        const text = page ? data.text.split("\n\n").slice(0, page).join("\n\n") : data.text;
        return { type: "pdf", pages: data.numpages, text: text.trim().slice(0, 10000) };
      }

      if (ext === ".xlsx" || ext === ".xls") {
        const XLSX = await import("xlsx");
        const workbook = XLSX.read(buffer, { type: "buffer" });
        const sheets: Record<string, string[][]> = {};
        for (const name of workbook.SheetNames) {
          const sheet = workbook.Sheets[name];
          sheets[name] = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 });
        }
        return { type: "excel", sheets: Object.keys(sheets), data: sheets };
      }

      if (ext === ".docx") {
        const mammoth = await import("mammoth");
        const result = await mammoth.convertToHtml({ buffer });
        const text = result.value;
        const html = text.length < 50000 ? text : text.slice(0, 50000) + "\n[обрезано]";
        return { type: "docx", html };
      }

      // Текстовые форматы
      const text = buffer.toString("utf8").slice(0, 50000);
      if (ext === ".json") {
        try {
          const parsed = JSON.parse(text);
          return { type: "json", content: parsed };
        } catch {
          return { type: "json", raw: text, error: "Невалидный JSON, возвращён сырой текст" };
        }
      }
      return { type: "text", content: text };
    },
  }),
  deploySite: tool({
    description: "Опубликовать папку из workspace как публичный сайт через туннель. Возвращает URL, доступный из интернета. Предварительно сохрани файлы через saveFile/downloadFile. Для отмены публикации используй undeploy.",
    inputSchema: z.object({
      folder: z.string().describe("Имя папки в workspace чата, например 'dashboard'. В папке должен быть index.html."),
    }),
    execute: async ({ folder }) => {
      const path = await import("node:path");
      const { promises: fs } = await import("node:fs");
      const baseDir = path.join(process.cwd(), ".user-data", "workspace", currentChatId);
      const serveDir = path.join(baseDir, folder);

      try {
        await fs.access(serveDir);
      } catch {
        return { error: `Папка не найдена: ${folder}. Предварительно сохрани туда файлы через saveFile.` };
      }

      // Отключаем предыдущий деплой для этого чата
      const prev = activeDeployments.get(currentChatId);
      if (prev) {
        prev.tunnel?.close().catch(() => {});
        prev.server?.close();
        activeDeployments.delete(currentChatId);
      }

      // Простой статический сервер
      const mime: Record<string, string> = {
        ".html": "text/html; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".js": "application/javascript; charset=utf-8",
        ".svg": "image/svg+xml",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".gif": "image/gif",
        ".ico": "image/x-icon",
        ".json": "application/json; charset=utf-8",
        ".csv": "text/csv; charset=utf-8",
        ".txt": "text/plain; charset=utf-8",
        ".woff2": "font/woff2",
        ".woff": "font/woff",
        ".ttf": "font/ttf",
        ".pdf": "application/pdf",
      };

      const server = http.createServer(async (req, res) => {
        let urlPath = req.url ?? "/";
        if (urlPath.includes("..") || urlPath.includes("~")) {
          res.writeHead(403);
          res.end("Forbidden");
          return;
        }
        if (urlPath.endsWith("/")) urlPath += "index.html";
        const filePath = path.join(serveDir, urlPath);
        try {
          const stat = await fs.stat(filePath);
          if (!stat.isFile()) throw new Error("not a file");
          const ext = path.extname(filePath).toLowerCase();
          const contentType = mime[ext] ?? "application/octet-stream";
          res.writeHead(200, { "Content-Type": contentType });
          const stream = (await import("node:fs")).createReadStream(filePath);
          stream.pipe(res);
          stream.on("error", () => { res.writeHead(500); res.end("Server error"); });
        } catch {
          // Try index.html in root for SPA-like routing
          if (!urlPath.endsWith("index.html")) {
            const indexPath = path.join(serveDir, "index.html");
            try {
              await fs.access(indexPath);
              res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
              (await import("node:fs")).createReadStream(indexPath).pipe(res);
              return;
            } catch { /* fall through to 404 */ }
          }
          res.writeHead(404);
          res.end("File not found");
        }
      });

      const port = await new Promise<number>((resolve) => {
        server.listen(0, () => {
          const addr = server.address();
          resolve(typeof addr === "object" && addr ? addr.port : 3000);
        });
      });

      try {
        const { default: localtunnel } = await import("localtunnel");
        const tunnel = await localtunnel({ port });
        const url = tunnel.url;

        activeDeployments.set(currentChatId, { server, tunnel, port });

        tunnel.on("close", () => {
          if (activeDeployments.get(currentChatId)?.tunnel === tunnel) {
            activeDeployments.delete(currentChatId);
          }
        });

        return { url, port, folder, message: `Сайт ${folder} опубликован: ${url}` };
      } catch (err: any) {
        server.close();
        return { error: `Не удалось создать туннель: ${err.message}` };
      }
    },
  }),
  undeploy: tool({
    description: "Отключить опубликованный сайт (deploySite) для текущего чата.",
    inputSchema: z.object({}),
    execute: async () => {
      const dep = activeDeployments.get(currentChatId);
      if (!dep) return { message: "Нет активных публикаций для этого чата." };
      dep.tunnel?.close().catch(() => {});
      dep.server?.close();
      activeDeployments.delete(currentChatId);
      return { message: "Публикация отключена." };
    },
  }),
  auditResult: tool({
    description: "Проверить файлы в workspace на ошибки: битые ссылки, валидность JSON, орфографию. Возвращает список проблем.",
    inputSchema: z.object({
      filePaths: z.array(z.string()).describe("Имена файлов в workspace, например ['report.html', 'data.json']"),
      checkList: z.array(z.enum(["links", "spelling", "json_schema"])).optional().describe("Что проверять (по умолчанию всё)"),
    }),
    execute: async ({ filePaths, checkList }) => {
      const path = await import("node:path");
      const { promises: fs } = await import("node:fs");
      const baseDir = path.join(process.cwd(), ".user-data", "workspace", currentChatId);
      const checks = checkList ?? ["links", "spelling", "json_schema"];
      const issues: Array<{ file: string; type: string; message: string }> = [];

      // Простой словарь для проверки орфографии (распространённые английские слова)
      const dict = new Set(`
        the a an is are was were be been have has had do does did will would shall should
        can could may might must need dare ought used get got goes going go gone
        make made makes making take took takes taking taken give gave gives giving given
        find found finds finding keep kept keeps keeping know knew knows knowing known
        think thought thinks thinking see saw sees seeing seen come came comes coming
        put puts putting let lets letting set sets setting run ran runs running
        say said says saying tell told tells telling ask asked asks asking
        work works worked working help helps helped helping call called calls calling
        try tried tries trying start started starts starting move moved moves moving
        turn turned turns turning show showed shows showing bring brought brings bringing
        hold held holds holding write wrote writes writing written speak spoke speaks speaking
        spend spent spends spending build built builds building built
        this that these those it its my your his her our their some any
        each every all both few many much more most less least own same
        such which what who whom whose why how where when whether
        and but or nor for yet so because if although though while since until
        after before about between among throughout during without within
        along across through into onto upon above below behind beyond
        up down in out on off over under again further then once here there
        not no nor too very just almost always never often sometimes usually
        well really quite rather pretty almost enough thus also
        please thank thanks hello hi yes no ok okay good bad new old
        first last next previous following above below left right
        big small large little high low long short wide narrow deep
        hot cold warm cool fast slow hard soft bright dark light
        red blue green yellow black white grey gray brown pink purple orange
        happy sad angry calm nice kind sweet bitter rich poor clean dirty
        easy hard simple complex full empty open closed together apart
        far near early late early quick slow sudden gradual constant
        able unable possible impossible likely unlikely certain sure
        true false real fake correct wrong right left north south east west
        top bottom front back side end beginning middle center edge
        name type size color colour shape form part piece sort kind
        way means method manner style mode fashion system process
        time day week month year hour minute second moment period
        place point spot area location site space position situation
        person people man woman child boy girl friend family group
        thing object item article element component factor aspect feature
        number amount quantity total sum value level measure rate
        line row column cell table chart graph diagram map image
        text word letter character symbol sign code data file info
        page section chapter part volume issue number version edition
        home page site website portal platform tool utility app application
        program script function method class object variable constant
        value type string number boolean array list set map key
        source target source destination input output result response
        request query answer solution problem issue bug error fix
        update upgrade install remove delete create add edit change
        modify adjust convert transform translate format parse generate
        load save store cache backup restore copy move link connect
        send receive transfer upload download sync merge split join
        search find filter sort order group count sum avg min max
        date time year month day hour minute second now today yesterday
        tomorrow monday tuesday wednesday thursday friday saturday sunday
        january february march april may june july august september october november december
        price cost value fee rate tax total subtotal discount shipping
      `.split(/\s+/).filter(Boolean).reduce((s, w) => { s.add(w.toLowerCase()); return s; }, new Set<string>()));

      for (const filename of filePaths) {
        const filePath = path.join(baseDir, filename);
        let content: string;
        try {
          content = await fs.readFile(filePath, "utf8");
        } catch {
          issues.push({ file: filename, type: "file", message: "Файл не найден" });
          continue;
        }

        // Проверка битых ссылок
        if (checks.includes("links")) {
          const urls = content.match(/https?:\/\/[^\s"'>)\]}]+/g);
          if (urls) {
            const unique = [...new Set(urls.map(u => u.replace(/[.,;:!?]+$/, "")))];
            const results = await Promise.allSettled(
              unique.map(url =>
                fetch(url, { method: "HEAD", signal: AbortSignal.timeout(5000) })
                  .then(r => {
                    if (!r.ok && r.status >= 400) throw new Error(`HTTP ${r.status}`);
                  })
              )
            );
            results.forEach((r, i) => {
              if (r.status === "rejected") {
                issues.push({ file: filename, type: "broken_link", message: `Битая ссылка: ${unique[i]} (${r.reason?.message ?? "ошибка"})` });
              }
            });
          }
        }

        // Проверка JSON
        if (checks.includes("json_schema")) {
          if (filename.endsWith(".json")) {
            try {
              JSON.parse(content);
            } catch (e: any) {
              issues.push({ file: filename, type: "invalid_json", message: `Невалидный JSON: ${e.message}` });
            }
          }
        }

        // Проверка орфографии (базовая — только английские слова)
        if (checks.includes("spelling")) {
          const words = content.toLowerCase().match(/[a-z]{4,}/g);
          if (words) {
            const seen = new Set<string>();
            for (const word of words) {
              if (seen.has(word)) continue;
              seen.add(word);
              if (!dict.has(word) && !/^\d/.test(word) && !word.endsWith("ing") && !word.endsWith("ed") && !word.endsWith("ly") && !word.endsWith("s") && !word.endsWith("er") && !word.endsWith("est")) {
                issues.push({ file: filename, type: "spelling", message: `Возможная опечатка: "${word}"` });
              }
            }
          }
        }
      }

      return { issues, allClear: issues.length === 0, totalIssues: issues.length };
    },
  }),
  synthesizeKnowledge: tool({
    description: "Собрать информацию из нескольких источников (URL/файлы) в единый структурированный документ (Markdown/HTML). Возвращает путь к сохранённому файлу.",
    inputSchema: z.object({
      sources: z.array(z.union([
        z.string(),
        z.object({ url: z.string(), title: z.string().optional() }),
      ])).describe("Список источников: URL-строки или объекты {url, title}"),
      format: z.enum(["markdown", "obsidian", "html"]).optional().describe("Формат итогового документа (по умолчанию markdown)"),
    }),
    execute: async ({ sources, format }) => {
      const path = await import("node:path");
      const { promises: fs } = await import("node:fs");
      const fmt = format ?? "markdown";
      const dir = path.join(process.cwd(), ".user-data", "workspace", currentChatId);
      await fs.mkdir(dir, { recursive: true });

      const entries: { title: string; content: string; url: string }[] = [];

      for (const src of sources) {
        const url = typeof src === "string" ? src : src.url;
        const userTitle = typeof src === "object" ? src.title : undefined;

        // Пробуем прочитать как URL
        if (url.startsWith("http")) {
          const content = await tryReadUrl(url);
          if (content) {
            entries.push({ title: userTitle ?? url, content, url });
            continue;
          }
        }

        // Пробуем прочитать как файл из workspace
        try {
          const filePath = path.join(dir, url);
          const text = await fs.readFile(filePath, "utf8");
          entries.push({ title: userTitle ?? url, content: text.slice(0, 5000), url });
        } catch {
          entries.push({ title: userTitle ?? url, content: "(не удалось загрузить)", url });
        }
      }

      let output: string;
      const now = new Date().toISOString().split("T")[0];

      if (fmt === "html") {
        output = `<!DOCTYPE html><html lang="ru"><head><meta charset="UTF-8"><title>Knowledge Base</title></head><body>
<h1>База знаний</h1><p>Собрано ${now}</p><hr>`;
        for (const e of entries) {
          output += `<section><h2>${e.title}</h2><p><a href="${e.url}">${e.url}</a></p><div>${e.content.replace(/\n/g, "<br>")}</div></section><hr>`;
        }
        output += "</body></html>";
      } else {
        output = `# База знаний\n\nСобрано ${now}\n\n---\n\n`;
        for (const e of entries) {
          output += `## ${e.title}\n\n`;
          if (e.url.startsWith("http")) output += `Источник: ${e.url}\n\n`;
          output += `${e.content}\n\n---\n\n`;
        }
      }

      const filename = `knowledge-${Date.now()}.${fmt === "html" ? "html" : "md"}`;
      const filePath = path.join(dir, filename);
      await fs.writeFile(filePath, output, "utf8");
      return { ok: true, filePath, httpPath: `/api/workspace/${currentChatId}/${filename}`, entries: entries.length };
    },
  }),
  deployGithubPages: tool({
    description: "Опубликовать папку из workspace как сайт на GitHub Pages. Требует GitHub Token в настройках admin-панели.",
    inputSchema: z.object({
      folder: z.string().describe("Имя папки в workspace (должна содержать index.html)"),
      repoName: z.string().optional().describe("Название репозитория (по умолчанию = имя папки)"),
    }),
    execute: async ({ folder, repoName }) => {
      const { getSettingsStore } = await import("./user-settings.ts");
      const store = await getSettingsStore();
      const settings = await store.get();
      const token = settings.githubToken;
      if (!token) {
        return { error: "GitHub Token не настроен. Открой admin-панель и укажи токен." };
      }

      const path = await import("node:path");
      const { promises: fs } = await import("node:fs");
      const baseDir = path.join(process.cwd(), ".user-data", "workspace", currentChatId);
      const serveDir = path.join(baseDir, folder);

      try { await fs.access(serveDir); } catch {
        return { error: `Папка не найдена: ${folder}` };
      }

      const owner = "marcelalbert1712-dotcom";
      const name = repoName ?? folder;
      const api = "https://api.github.com";

      const headers = {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "User-Agent": "umnyy-agent",
      };

      // 1. Создать репозиторий (если не существует)
      const createRes = await fetch(`${api}/user/repos`, {
        method: "POST", headers,
        body: JSON.stringify({ name, auto_init: true, private: false }),
      });
      if (!createRes.ok && createRes.status !== 422) {
        const err = await createRes.text();
        return { error: `Не удалось создать репозиторий: ${err.slice(0, 200)}` };
      }

      // 2. Получить список файлов в папке
      const files = await fs.readdir(serveDir);
      const results: { file: string; status: string }[] = [];

      for (const file of files) {
        try {
          const content = await fs.readFile(path.join(serveDir, file));
          const base64 = content.toString("base64");

          // Проверяем существует ли файл в репозитории
          const checkRes = await fetch(`${api}/repos/${owner}/${name}/contents/${encodeURIComponent(file)}`, { headers });
          const existing = checkRes.ok ? await checkRes.json() : null;

          const putRes = await fetch(`${api}/repos/${owner}/${name}/contents/${encodeURIComponent(file)}`, {
            method: "PUT", headers,
            body: JSON.stringify({
              message: `Add ${file} via umnyy-agent`,
              content: base64,
              sha: existing?.sha ?? undefined,
            }),
          });

          results.push({ file, status: putRes.ok ? "uploaded" : `error ${putRes.status}` });
        } catch (err: any) {
          results.push({ file, status: `error: ${err.message}` });
        }
      }

      // 3. Включить GitHub Pages
      await fetch(`${api}/repos/${owner}/${name}/pages`, {
        method: "POST", headers,
        body: JSON.stringify({ source: { branch: "main", path: "/" } }),
      }).catch(() => {});

      const url = `https://${owner}.github.io/${name}/`;
      return { url, repo: `${owner}/${name}`, files: results };
    },
  }),
  exportChat: tool({
    description: "Экспортировать текущий диалог в файл (Markdown или HTML). Сохраняет в workspace.",
    inputSchema: z.object({
      format: z.enum(["markdown", "html"]).optional().describe("Формат (по умолчанию markdown)"),
    }),
    execute: async ({ format }) => {
      const path = await import("node:path");
      const { promises: fs } = await import("node:fs");
      const fmt = format ?? "markdown";
      const chatPath = path.join(process.cwd(), ".chats-data", `${currentChatId}.json`);

      let messages: { role: string; parts?: { type: string; text?: string }[] }[];
      try {
        const raw = await fs.readFile(chatPath, "utf8");
        const chat = JSON.parse(raw);
        messages = chat.messages ?? [];
      } catch {
        return { error: "Не удалось прочитать историю чата" };
      }

      const extractText = (msg: { role: string; parts?: { type: string; text?: string }[] }): string => {
        if (!Array.isArray(msg.parts)) return "";
        return msg.parts
          .filter((p) => p.type === "text" && typeof p.text === "string")
          .map((p) => p.text ?? "")
          .join("\n");
      };

      const lines: string[] = [];
      for (const msg of messages) {
        const text = extractText(msg);
        if (!text) continue;
        if (msg.role === "user") {
          lines.push(fmt === "html" ? `<p><b>User:</b> ${text.replace(/\n/g, "<br>")}</p>` : `**User:** ${text}`);
        } else if (msg.role === "assistant") {
          lines.push(fmt === "html" ? `<p><b>Assistant:</b><br>${text.replace(/\n/g, "<br>")}</p>` : `**Assistant:**\n${text}`);
        }
      }

      const content = fmt === "html"
        ? `<!DOCTYPE html><html lang="ru"><head><meta charset="UTF-8"><title>Чат ${currentChatId}</title></head><body>${lines.join("\n<hr>\n")}</body></html>`
        : lines.join("\n\n---\n\n");

      const dir = path.join(process.cwd(), ".user-data", "workspace", currentChatId);
      await fs.mkdir(dir, { recursive: true });
      const filename = `chat-export-${Date.now()}.${fmt === "html" ? "html" : "md"}`;
      const filePath = path.join(dir, filename);
      await fs.writeFile(filePath, content, "utf8");
      return { ok: true, filePath, httpPath: `/api/workspace/${currentChatId}/${filename}`, messages: lines.length };
    },
  }),
  sendTelegram: tool({
    description: "Отправить сообщение в Telegram. Требует настройки Telegram Bot Token и Chat ID в настройках (admin-панель).",
    inputSchema: z.object({
      message: z.string().describe("Текст сообщения"),
    }),
    execute: async ({ message }) => {
      const { getSettingsStore } = await import("./user-settings.ts");
      const store = await getSettingsStore();
      const settings = await store.get();
      const token = settings.telegramBotToken;
      const chatId = settings.telegramChatId;
      if (!token || !chatId) {
        return { error: "Telegram не настроен. Открой admin-панель и укажи Bot Token и Chat ID." };
      }
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: "HTML" }),
      });
      if (!res.ok) {
        const err = await res.text().catch(() => "");
        return { error: `Telegram API error (${res.status}): ${err.slice(0, 200)}` };
      }
      const data = await res.json();
      return { ok: true, messageId: data?.result?.message_id ?? null };
    },
  }),
  invokeAgent: tool({
    description: "Делегировать подзадачу суб-агенту. Вызывай несколько раз в одном шаге для параллельного выполнения независимых задач.",
    inputSchema: z.object({
      goal: z.string().describe("Чёткая цель для суб-агента. Например: 'найди цену Bitcoin'"),
    }),
    execute: async ({ goal }) => {
      return await runSubAgent(goal);
    },
  }),
  generateQrCode: tool({
    description: "Сгенерировать QR-код из текста или URL и сохранить как PNG в workspace.",
    inputSchema: z.object({
      data: z.string().describe("Текст или URL для кодирования в QR-код"),
      width: z.number().optional().describe("Ширина в пикселях (по умолчанию 300)"),
    }),
    execute: async ({ data, width }) => {
      const QRCode = (await import("qrcode")).default;
      const path = await import("node:path");
      const { promises: fs } = await import("node:fs");
      const dir = path.join(process.cwd(), ".user-data", "workspace", currentChatId);
      await fs.mkdir(dir, { recursive: true });
      const filename = `qr-${Date.now()}.png`;
      const filePath = path.join(dir, filename);
      await QRCode.toFile(filePath, data, { width: width ?? 300 });
      return { ok: true, filePath, httpPath: `/api/workspace/${currentChatId}/${filename}` };
    },
  }),
  zipWorkspace: tool({
    description: "Упаковать файлы из папки workspace в ZIP-архив и вернуть ссылку.",
    inputSchema: z.object({
      folder: z.string().optional().describe("Имя подпапки в workspace (без неё — все файлы чата)"),
    }),
    execute: async ({ folder }) => {
      const path = await import("node:path");
      const fs = await import("node:fs");
      const archiver = (await import("archiver")).default;
      const baseDir = path.join(process.cwd(), ".user-data", "workspace", currentChatId);
      const targetDir = folder ? path.join(baseDir, folder) : baseDir;
      try { await fs.promises.access(targetDir); } catch { return { error: `Папка не найдена: ${folder ?? ""}` }; }
      const zipName = `archive-${Date.now()}.zip`;
      const zipPath = path.join(baseDir, zipName);
      const output = fs.createWriteStream(zipPath);
      const archive = archiver("zip", { zlib: { level: 9 } });
      return new Promise((resolve) => {
        output.on("close", () => {
          resolve({ ok: true, filePath: zipPath, httpPath: `/api/workspace/${currentChatId}/${zipName}`, size: archive.pointer() });
        });
        archive.on("error", (err: any) => resolve({ error: err.message }));
        archive.pipe(output);
        archive.directory(targetDir, false);
        archive.finalize();
      });
    },
  }),
  sendEmail: tool({
    description: "Отправить email через настроенный SMTP. Требует настройки SMTP в admin-панели.",
    inputSchema: z.object({
      to: z.string().describe("Email получателя"),
      subject: z.string().describe("Тема письма"),
      body: z.string().describe("Текст письма (plain text)"),
      html: z.string().optional().describe("HTML-версия письма (опционально)"),
    }),
    execute: async ({ to, subject, body, html }) => {
      const { getSettingsStore } = await import("./user-settings.ts");
      const store = await getSettingsStore();
      const settings = await store.get();
      if (!settings.smtpHost || !settings.smtpUser) {
        return { error: "SMTP не настроен. Открой admin-панель → Email и заполни параметры." };
      }
      const nodemailer = await import("nodemailer");
      const transporter = nodemailer.createTransport({
        host: settings.smtpHost,
        port: settings.smtpPort,
        secure: settings.smtpPort === 465,
        auth: { user: settings.smtpUser, pass: settings.smtpPass },
      });
      try {
        const info = await transporter.sendMail({
          from: settings.smtpFrom || settings.smtpUser,
          to,
          subject,
          text: body,
          html: html ?? undefined,
        });
        return { ok: true, messageId: info.messageId };
      } catch (err: any) {
        return { error: `SMTP error: ${err.message}` };
      }
    },
  }),
  getExchangeRates: tool({
    description: "Получить актуальные курсы валют (базовая валюта — USD или EUR).",
    inputSchema: z.object({
      base: z.string().optional().describe("Базовая валюта (по умолчанию USD)"),
    }),
    execute: async ({ base }) => {
      const b = base ?? "USD";
      const res = await fetch(`https://open.er-api.com/v6/latest/${b}`, {
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) return { error: `API error: ${res.status}` };
      const data = await res.json();
      return {
        base: data.base_code ?? b,
        date: data.time_last_update_utc ?? "",
        rates: data.rates ?? {},
        source: "open.er-api.com",
      };
    },
  }),
  getCryptoPrice: tool({
    description: "Получить актуальные цены криптовалют (Bitcoin, Ethereum, Solana и др.).",
    inputSchema: z.object({
      ids: z.array(z.string()).optional().describe("Список ID монет (по умолчанию: bitcoin, ethereum, solana)"),
      vsCurrency: z.string().optional().describe("Валюта (по умолчанию usd)"),
    }),
    execute: async ({ ids, vsCurrency }) => {
      const coinIds = (ids?.length ? ids : ["bitcoin", "ethereum", "solana"]).join(",");
      const currency = vsCurrency ?? "usd";
      const res = await fetch(
        `https://api.coingecko.com/api/v3/simple/price?ids=${coinIds}&vs_currencies=${currency}&include_24hr_change=true&include_market_cap=true`,
        { signal: AbortSignal.timeout(10000) },
      );
      if (!res.ok) return { error: `CoinGecko API error: ${res.status}` };
      const data = await res.json();
      return { currency, prices: data };
    },
  }),
  getYoutubeTranscript: tool({
    description: "Извлечь текст расшифровки (transcript) из YouTube-видео по URL или ID.",
    inputSchema: z.object({
      videoUrlOrId: z.string().describe("YouTube URL или ID видео"),
    }),
    execute: async ({ videoUrlOrId }) => {
      let videoId = videoUrlOrId;
      if (videoUrlOrId.includes("youtu.be/")) {
        videoId = videoUrlOrId.split("youtu.be/")[1]?.split("?")[0] ?? "";
      } else if (videoUrlOrId.includes("v=")) {
        videoId = videoUrlOrId.split("v=")[1]?.split("&")[0] ?? "";
      }
      if (!videoId) return { error: "Не удалось извлечь ID видео" };
      try {
        const { YoutubeTranscript } = await import("youtube-transcript");
        const transcript = await YoutubeTranscript.fetchTranscript(videoId);
        const fullText = transcript.map((t: any) => t.text).join(" ");
        return {
          videoId,
          language: transcript.length > 0 ? "available" : "none",
          transcript: fullText.slice(0, 10000),
          fullLength: fullText.length,
          segments: transcript.length,
        };
      } catch (err: any) {
        return { error: `Transcript error: ${err.message}` };
      }
    },
  }),
  ocrImage: tool({
    description: "Распознать текст на изображении (OCR). Принимает имя файла из workspace или URL.",
    inputSchema: z.object({
      source: z.string().describe("Имя файла из workspace или URL изображения"),
    }),
    execute: async ({ source }) => {
      const Tesseract = (await import("tesseract.js")).default;
      const path = await import("node:path");
      const { promises: fs } = await import("node:fs");
      let imageData: Buffer;
      let displaySource = source;

      if (source.startsWith("http")) {
        const res = await fetch(source, {
          signal: AbortSignal.timeout(15000),
          headers: { "User-Agent": "Mozilla/5.0" },
        });
        if (!res.ok) return { error: `Не удалось скачать изображение: ${res.status}` };
        imageData = Buffer.from(await res.arrayBuffer());
      } else {
        const filePath = path.join(process.cwd(), ".user-data", "workspace", currentChatId, source);
        try { imageData = await fs.readFile(filePath); }
        catch { return { error: `Файл не найден: ${source}` }; }
      }

      try {
        const result = await Tesseract.recognize(imageData, "rus+eng");
        return {
          ok: true,
          text: (result.data.text ?? "").slice(0, 5000),
          source: displaySource,
          language: result.data.language ?? "rus+eng",
        };
      } catch (err: any) {
        return { error: `OCR error: ${err.message}` };
      }
    },
  }),
  markdownToPdf: tool({
    description: "Конвертировать Markdown-файл из workspace в PDF и сохранить в workspace.",
    inputSchema: z.object({
      filename: z.string().describe("Имя Markdown-файла в workspace"),
    }),
    execute: async ({ filename }) => {
      const path = await import("node:path");
      const { promises: fs } = await import("node:fs");
      const dir = path.join(process.cwd(), ".user-data", "workspace", currentChatId);
      const mdPath = path.join(dir, filename);
      try { await fs.access(mdPath); } catch { return { error: `Файл не найден: ${filename}` }; }

      const mdText = await fs.readFile(mdPath, "utf8");
      // Minimal Markdown → HTML
      let html = mdText
        .replace(/^### (.+)$/gm, "<h3>$1</h3>")
        .replace(/^## (.+)$/gm, "<h2>$1</h2>")
        .replace(/^# (.+)$/gm, "<h1>$1</h1>")
        .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
        .replace(/\*(.+?)\*/g, "<em>$1</em>")
        .replace(/`([^`]+)`/g, "<code>$1</code>")
        .replace(/\n/g, "<br>");

      const fullHtml = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
        body { font-family: 'Segoe UI', Arial, sans-serif; padding: 40px; line-height: 1.6; }
        h1,h2,h3 { color: #333; }
        code { background: #f4f4f4; padding: 2px 6px; border-radius: 3px; }
      </style></head><body>${html}</body></html>`;

      const tmpHtml = path.join(dir, `_tmp_${Date.now()}.html`);
      const pdfName = filename.replace(/\.md$/i, "") + `-${Date.now()}.pdf`;
      const pdfPath = path.join(dir, pdfName);

      await fs.writeFile(tmpHtml, fullHtml, "utf8");

      const { chromium } = await import("playwright");
      const chromePath = "C:\\Users\\!!!~1\\AppData\\Local\\ms-Playwright\\chromium-1228\\chrome-win64\\chrome.exe";
      const browser = await chromium.launch({ headless: true, executablePath: chromePath, args: ["--no-sandbox"] });
      try {
        const page = await browser.newPage();
        await page.goto(`file:///${tmpHtml.replace(/\\/g, "/")}`, { waitUntil: "networkidle" });
        await page.pdf({ path: pdfPath, format: "A4", printBackground: true, margin: { top: "20mm", bottom: "20mm", left: "15mm", right: "15mm" } });
      } finally {
        await browser.close();
        await fs.unlink(tmpHtml).catch(() => {});
      }

      return { ok: true, filePath: pdfPath, httpPath: `/api/workspace/${currentChatId}/${pdfName}` };
    },
  }),
  compareTexts: tool({
    description: "Сравнить два текста и показать различия построчно.",
    inputSchema: z.object({
      text1: z.string().describe("Первый текст"),
      text2: z.string().describe("Второй текст"),
    }),
    execute: async ({ text1, text2 }) => {
      const { diffLines } = await import("diff");
      const lines1 = text1.split("\n");
      const lines2 = text2.split("\n");
      const changes = diffLines(text1, text2);
      const result = changes.map((c: any) => {
        const prefix = c.added ? "+ " : c.removed ? "- " : "  ";
        return c.value.split("\n").filter((_: any, i: number, arr: any[]) => i < arr.length - 1 || c.value.endsWith("\n")).map((l: string) => prefix + l).join("\n");
      }).join("\n");
      const added = changes.filter((c: any) => c.added).reduce((s: number, c: any) => s + c.value.split("\n").length - 1, 0);
      const removed = changes.filter((c: any) => c.removed).reduce((s: number, c: any) => s + c.value.split("\n").length - 1, 0);
      return { diff: result.slice(0, 5000), added, removed, lines1: lines1.length, lines2: lines2.length };
    },
  }),
  batchTranslate: tool({
    description: "Массовый перевод массива текстов через AI. Укажи исходный и целевой языки.",
    inputSchema: z.object({
      texts: z.array(z.string()).describe("Массив текстов для перевода"),
      from: z.string().describe("Исходный язык (например: ru, en, de)"),
      to: z.string().describe("Целевой язык (например: en, ru, es)"),
    }),
    execute: async ({ texts, from, to }) => {
      const apiKey = process.env.POLZAAI_API_KEY;
      if (!apiKey) return { error: "POLZAAI_API_KEY не задан" };
      const baseUrl = process.env.POLZAAI_BASE_URL ?? "https://api.polza.ai/v1";
      const modelRaw = process.env.POLZAAI_MODEL ?? "openai/gpt-4o-mini";
      const provider = process.env.POLZAAI_PROVIDER ?? "OpenAI";
      const model = modelRaw.includes("@") ? modelRaw : `${modelRaw}@provider=${provider}&allow_fallbacks=false`;
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: `You are a translator. Translate each item from ${from} to ${to}. Respond ONLY as a JSON array of strings, same order. No explanation.` },
            { role: "user", content: JSON.stringify(texts) },
          ],
          temperature: 0.2,
          max_tokens: 4096,
        }),
      });
      if (!res.ok) return { error: `Translation API error: ${res.status}` };
      const data = await res.json();
      const content = data.choices?.[0]?.message?.content ?? "[]";
      try {
        const translations = JSON.parse(content);
        return { ok: true, from, to, count: translations.length, translations };
      } catch {
        return { ok: true, from, to, count: texts.length, translations: texts.map(() => content) };
      }
    },
  }),
  factCheck: tool({
    description: "Проверить утверждение через веб-поиск и оценить его достоверность.",
    inputSchema: z.object({
      claim: z.string().describe("Утверждение для проверки"),
    }),
    execute: async ({ claim }) => {
      const searchRes = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(claim + " факты проверка")}`, {
        signal: AbortSignal.timeout(10000),
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
      });
      if (!searchRes.ok) return { error: `Search error: ${searchRes.status}` };
      const html = await searchRes.text();
      const snippets = html.match(/<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi)?.slice(0, 5).map(s => s.replace(/<[^>]*>/g, "").trim()) ?? [];
      const content = snippets.join("\n\n");
      return { verified: snippets.length > 0, claim, sources: snippets.length, evidence: content.slice(0, 3000) };
    },
  }),
  subscribeRSS: tool({
    description: "Подписаться на RSS-ленту. Сохраняет URL ленты для дальнейшей проверки.",
    inputSchema: z.object({
      url: z.string().describe("URL RSS-ленты (например https://example.com/feed.xml)"),
      title: z.string().optional().describe("Название подписки"),
    }),
    execute: async ({ url, title }) => {
      const { addFeed } = await import("./rss-store.ts");
      const feed = await addFeed(url, title);
      return { ok: true, feedId: feed.id, url: feed.url, title: feed.title };
    },
  }),
  listRSSFeeds: tool({
    description: "Список всех RSS-подписок с датой последней проверки.",
    inputSchema: z.object({}),
    execute: async () => {
      const { listFeeds } = await import("./rss-store.ts");
      const feeds = await listFeeds();
      return { feeds, total: feeds.length };
    },
  }),
  checkRSS: tool({
    description: "Проверить RSS-ленту на новые статьи. Если feedId не указан — проверяет все подписки.",
    inputSchema: z.object({
      feedId: z.string().optional().describe("ID конкретной подписки (без неё — проверить все)"),
    }),
    execute: async ({ feedId }) => {
      if (feedId) {
        const { checkFeed } = await import("./rss-store.ts");
        const result = await checkFeed(feedId);
        return result ?? { error: "Подписка не найдена" };
      }
      const { checkAllFeeds } = await import("./rss-store.ts");
      const results = await checkAllFeeds();
      return { checked: results.length, results };
    },
  }),
  unsubscribeRSS: tool({
    description: "Удалить RSS-подписку.",
    inputSchema: z.object({
      feedId: z.string().describe("ID подписки для удаления"),
    }),
    execute: async ({ feedId }) => {
      const { removeFeed } = await import("./rss-store.ts");
      const ok = await removeFeed(feedId);
      return { ok };
    },
  }),
  scheduleTask: tool({
    description: "Создать cron-задачу, которая будет выполняться по расписанию. Результат отправляется в Telegram (если настроен).",
    inputSchema: z.object({
      name: z.string().describe("Краткое название задачи"),
      cron: z.string().describe("Cron-выражение, например: '0 9 * * *' — каждый день в 9:00, '*/30 * * * *' — каждые 30 минут"),
      prompt: z.string().describe("Промпт который передаётся AI для выполнения"),
    }),
    execute: async ({ name, cron, prompt }) => {
      const cronLib = await import("node-cron");
      if (!cronLib.default.validate(cron)) {
        return { error: "Некорректное cron-выражение" };
      }
      const { addTask, scheduleNewJob } = await import("./cron-store.ts");
      const task = await addTask({ name, cron, prompt, chatId: currentChatId });
      await scheduleNewJob(task);
      return { ok: true, taskId: task.id, name: task.name, cron: task.cron };
    },
  }),
  listScheduledTasks: tool({
    description: "Список всех cron-задач с временем последнего запуска.",
    inputSchema: z.object({}),
    execute: async () => {
      const { listTasks } = await import("./cron-store.ts");
      const tasks = await listTasks();
      return {
        tasks: tasks.map((t) => ({
          id: t.id,
          name: t.name,
          cron: t.cron,
          enabled: t.enabled,
          lastRun: t.lastRun,
          lastResult: t.lastResult?.slice(0, 200),
          createdAt: t.createdAt,
        })),
        total: tasks.length,
      };
    },
  }),
  deleteScheduledTask: tool({
    description: "Удалить cron-задачу по ID.",
    inputSchema: z.object({
      taskId: z.string().describe("ID задачи"),
    }),
    execute: async ({ taskId }) => {
      const { removeTask, cancelJob } = await import("./cron-store.ts");
      await cancelJob(taskId);
      const ok = await removeTask(taskId);
      return { ok };
    },
  }),
  showNotification: tool({
    description: "Показать системное уведомление на рабочем столе пользователя (toast/balloon). Используй после завершения длительных задач.",
    inputSchema: z.object({
      title: z.string().describe("Заголовок уведомления (краткий)"),
      message: z.string().describe("Текст уведомления"),
    }),
    execute: async ({ title, message }) => {
      try {
        const notifier = (await import("node-notifier")).default;
        notifier.notify({
          title: title ?? "Umnyy Agent",
          message: message ?? "",
          sound: false,
          wait: false,
        });
        return { ok: true, title, message };
      } catch (err: any) {
        return { error: err.message };
      }
    },
  }),
  generateMindMap: tool({
    description: "Сгенерировать интерактивный Mind Map (граф) из фактов о пользователе, сохранённых в памяти. Показывает связи между фактами по категориям. Возвращает ссылку на HTML-файл.",
    inputSchema: z.object({
      title: z.string().optional().describe("Заголовок Mind Map (по умолчанию 'Что я знаю о пользователе')"),
    }),
    execute: async ({ title }) => {
      const path = await import("node:path");
      const { promises: fs } = await import("node:fs");

      const { getFactStore } = await import("./user-facts.ts");
      const store = await getFactStore();
      const facts = await store.list();

      if (facts.length === 0) {
        return { error: "Нет фактов в памяти. Сначала собери информацию о пользователе через saveUserFact." };
      }

      const dir = path.join(process.cwd(), ".user-data", "workspace", currentChatId);
      await fs.mkdir(dir, { recursive: true });

      // Group facts by category
      const categories = new Map<string, typeof facts>();
      for (const f of facts) {
        const cat = f.category ?? "other";
        if (!categories.has(cat)) categories.set(cat, []);
        categories.get(cat)!.push(f);
      }

      // Colors per category
      const colorMap: Record<string, string> = {
        personal: "#4f46e5",
        work: "#0891b2",
        preference: "#db2777",
        hobby: "#16a34a",
        goal: "#ea580c",
        other: "#6b7280",
      };

      const catNames: Record<string, string> = {
        personal: "Личное",
        work: "Работа",
        preference: "Предпочтения",
        hobby: "Хобби",
        goal: "Цели",
        other: "Прочее",
      };

      // Build nodes and edges for vis-network
      const nodes: any[] = [];
      const edges: any[] = [];

      // Central node — user
      nodes.push({ id: "user", label: "Пользователь", shape: "circle", color: { background: "#1f2937", border: "#111827" }, font: { color: "#fff", size: 18 }, size: 40 });

      // Category nodes
      for (const [cat, factList] of categories) {
        const catId = `cat_${cat}`;
        nodes.push({
          id: catId,
          label: `${catNames[cat] ?? cat}\n(${factList.length})`,
          shape: "box",
          color: { background: colorMap[cat] ?? "#6b7280", border: colorMap[cat] ?? "#6b7280" },
          font: { color: "#fff", size: 14 },
          margin: 10,
        });
        edges.push({ from: "user", to: catId, width: 3, color: { color: colorMap[cat] ?? "#6b7280" } });

        for (const f of factList) {
          const fid = `fact_${f.id}`;
          const label = (f.text ?? "").slice(0, 60);
          nodes.push({
            id: fid,
            label,
            shape: "box",
            color: { background: "#fff", border: colorMap[cat] ?? "#6b7280" },
            font: { color: "#1f2937", size: 12 },
            margin: 8,
          });
          edges.push({ from: catId, to: fid, width: 1, color: { color: colorMap[cat] ?? "#d1d5db", opacity: 0.7 } });
        }
      }

      const html = `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title ?? "Mind Map — Umnyy Agent"}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: #f9fafb; font-family: 'Segoe UI', Arial, sans-serif; }
    #header { padding: 12px 20px; background: #fff; border-bottom: 1px solid #e5e7eb; display: flex; align-items: center; gap: 12px; }
    #header h1 { font-size: 18px; color: #1f2937; }
    #header span { color: #6b7280; font-size: 13px; }
    #network { width: 100%; height: calc(100vh - 50px); border: none; }
    #legend { display: flex; gap: 12px; flex-wrap: wrap; }
    .legend-item { display: flex; align-items: center; gap: 4px; font-size: 12px; color: #4b5563; }
    .legend-dot { width: 12px; height: 12px; border-radius: 3px; }
  </style>
  <script src="https://unpkg.com/vis-network/standalone/umd/vis-network.min.js"></script>
</head>
<body>
  <div id="header">
    <h1>${title ?? "Что я знаю о пользователе"}</h1>
    <span>${facts.length} фактов · ${categories.size} категорий</span>
    <div id="legend" style="margin-left: auto;">
      ${[...categories].map(([cat]) => `<div class="legend-item"><div class="legend-dot" style="background:${colorMap[cat] ?? "#6b7280"}"></div>${catNames[cat] ?? cat}</div>`).join("")}
    </div>
  </div>
  <div id="network"></div>
  <script>
    const nodes = new vis.DataSet(${JSON.stringify(nodes)});
    const edges = new vis.DataSet(${JSON.stringify(edges)});
    const container = document.getElementById("network");
    const data = { nodes, edges };
    const options = {
      layout: { improvedLayout: true },
      physics: {
        enabled: true,
        barnesHut: {
          gravitationalConstant: -3000,
          centralGravity: 0.3,
          springLength: 120,
          springConstant: 0.04,
          damping: 0.09,
          avoidOverlap: 0.5,
        },
        stabilization: { iterations: 150, updateInterval: 25 },
      },
      interaction: { hover: true, tooltipDelay: 100 },
    };
    const network = new vis.Network(container, data, options);
  </script>
</body>
</html>`;

      const filename = `mindmap-${Date.now()}.html`;
      const filePath = path.join(dir, filename);
      await fs.writeFile(filePath, html, "utf8");

      return {
        ok: true,
        filePath,
        httpPath: `/api/workspace/${currentChatId}/${filename}`,
        facts: facts.length,
        categories: categories.size,
      };
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

/** Запустить суб-агента с сырым API-вызовом (не streamText). До 3 раундов, все инструменты кроме invokeAgent */
async function runSubAgent(goal: string): Promise<string> {
  const apiKey = process.env.POLZAAI_API_KEY;
  if (!apiKey) return "Ошибка: POLZAAI_API_KEY не задан";
  const baseUrl = process.env.POLZAAI_BASE_URL ?? "https://api.polza.ai/v1";
  const modelRaw = process.env.POLZAAI_MODEL ?? "openai/gpt-4o-mini";
  const provider = process.env.POLZAAI_PROVIDER ?? "OpenAI";
  const model = modelRaw.includes("@") ? modelRaw : `${modelRaw}@provider=${provider}&allow_fallbacks=false`;

  const { invokeAgent: _, ...subTools } = tools; // убираем invokeAgent — без рекурсии

  const toolsForApi = Object.entries(subTools).map(([name, t]) => ({
    type: "function" as const,
    function: {
      name,
      description: (t as any).description ?? "",
      parameters: (t as any).inputSchema ?? {},
    },
  }));

  const messages: Array<{ role: string; content: string }> = [
    { role: "system", content: `Ты — суб-агент. Выполни задачу используя инструменты. Не вызывай invokeAgent. Отвечай кратко, только существенный результат. Задача: ${goal}` },
  ];

  let finalText = "";

  for (let round = 0; round < 3; round++) {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages, tools: toolsForApi, max_tokens: 2048, temperature: 0.3 }),
    });
    if (!res.ok) {
      const err = await res.text().catch(() => "");
      return `Ошибка API суб-агента: ${res.status} ${err}`;
    }
    const data = await res.json();
    const choice = data.choices?.[0];
    if (!choice) return "Нет ответа от API";

    const msg = choice.message;
    const content = msg.content ?? "";
    if (content) finalText = content;

    const toolCalls = msg.tool_calls;
    if (!toolCalls || toolCalls.length === 0) {
      // Больше нет вызовов — ответ готов
      return finalText || content || goal;
    }

    // Assistant message с tool_calls
    messages.push({ role: "assistant", content: content || null, tool_calls: toolCalls });
    // Выполняем tool calls и добавляем результаты
    for (const tc of toolCalls) {
      const toolName = tc.function.name;
      const toolFn = (subTools as any)[toolName];
      if (!toolFn?.execute) {
        messages.push({ role: "tool", content: `Ошибка: инструмент ${toolName} не найден`, tool_call_id: tc.id });
        continue;
      }
      try {
        const args = JSON.parse(tc.function.arguments);
        const result = await toolFn.execute(args);
        messages.push({
          role: "tool",
          content: typeof result === "string" ? result : JSON.stringify(result),
          tool_call_id: tc.id,
        });
      } catch (err: any) {
        messages.push({
          role: "tool",
          content: `Ошибка: ${err.message}`,
          tool_call_id: tc.id,
        });
      }
    }
  }

  return finalText || "Не удалось выполнить подзадачу";
}
