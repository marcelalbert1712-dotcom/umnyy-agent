import { tool } from "ai";
import { z } from "zod";
import { getOrCreatePage, closeChatSession } from "./browser-session";

/** Текущий ID чата, устанавливается перед вызовом streamText */
export let currentChatId = "default";
export function setCurrentChatId(id: string) { currentChatId = id; }
import { getFactStore } from "./user-facts.ts";

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
      "Искать в интернете по запросу и возвращать верхние результаты (заголовок, ссылка, сниппет). Использовать для фактических вопросов.",
    inputSchema: z.object({
      query: z.string().describe("Поисковый запрос"),
    }),
    execute: async ({ query }) => {
      const res = await fetch("https://html.duckduckgo.com/html/", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "Mozilla/5.0",
        },
        body: `q=${encodeURIComponent(query)}`,
      });
      if (!res.ok) {
        return { query, error: `Ошибка поиска (HTTP ${res.status})` };
      }

      const html = await res.text();
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
          url: links[i]?.startsWith("http")
            ? links[i]
            : `https:${links[i]}`,
          snippet: snippets[i] ?? "",
        });
      }

      return { query, results };
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
      "Выполнить JavaScript-код на сервере. Полезно для: вычислений, анализа данных, сортировки, фильтрации, работы с JSON, генерации отчётов, создания таблиц и графиков (через console.table/log). Код выполняется в Node.js с таймаутом 15 сек. Используй console.log/table для вывода.",
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
      "Управление браузером. Доступные действия: navigate (перейти на URL — http://, https://), screenshot (сделать скриншот — возвращает data:image), click (клик по координатам x, y), type (ввод текста), scroll (прокрутка dx, dy), getText (получить текст страницы), close (закрыть сессию). Всегда делай screenshot после navigate. Для открытия сохранённых файлов используй httpPath (например, http://localhost:5173/api/workspace/...)",
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
};
