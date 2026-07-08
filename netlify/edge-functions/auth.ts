import type { Config, Context } from "@netlify/edge-functions";

/**
 * Edge Function: HTTP Basic Auth на все маршруты (/*).
 * Защищает статику, SPA и API (включая SSE-стриминг /api/chat).
 * Браузер кеширует логин и шлёт заголовок Authorization со всеми
 * последующими запросами, включая fetch() к /api/*.
 *
 * Логин/пароль можно переопределить через env vars:
 *   APP_USERNAME, APP_PASSWORD (на Netlify: Site settings → Env vars).
 */
const USERNAME = Netlify.env.get("APP_USERNAME") ?? "admin";
const PASSWORD = Netlify.env.get("APP_PASSWORD") ?? "admin123";
const REALM = "Umnyy-agent";

function unauthorized(): Response {
  return new Response("Требуется авторизация\nЛогин: admin / Пароль: admin123", {
    status: 401,
    headers: {
      "WWW-Authenticate": `Basic realm="${REALM}"`,
      "content-type": "text/plain; charset=utf-8",
    },
  });
}

export default async (
  req: Request,
  _context: Context,
): Promise<Response | void> => {
  const auth = req.headers.get("authorization");

  if (auth) {
    const [scheme, encoded] = auth.split(" ");
    if (scheme === "Basic" && encoded) {
      try {
        const decoded = atob(encoded);
        const idx = decoded.indexOf(":");
        const user = decoded.slice(0, idx);
        const pass = decoded.slice(idx + 1);
        if (user === USERNAME && pass === PASSWORD) {
          // Передаём запрос дальше (статика / SPA / serverless-функции).
          return;
        }
      } catch {
        // некорректный base64 — проваливаемся в 401
      }
    }
  }

  return unauthorized();
};

export const config: Config = {
  path: "/*",
};
