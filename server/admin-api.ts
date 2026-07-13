import type { Plugin, ViteDevServer } from "vite";
import type { IncomingMessage, ServerResponse } from "node:http";
import { handleFactsRequest } from "./facts-handler.ts";
import { handleSettingsRequest } from "./settings-handler.ts";
import { handleSkillsRequest } from "./skills-handler.ts";
import { getFactStore } from "./user-facts.ts";
import { getSettingsStore } from "./user-settings.ts";
import { fileSkillStore } from "./user-skills.ts";

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(data));
}

/**
 * Vite middleware-плагин: REST API для управления фактами о пользователе
 * и настройками характера.
 *   GET    /api/facts        — список фактов
 *   POST   /api/facts        — добавить факт
 *   PUT    /api/facts/:id    — изменить факт
 *   DELETE /api/facts/:id    — удалить факт
 *   GET    /api/settings     — получить настройки
 *   PUT    /api/settings     — сохранить настройки
 */
export function adminApiPlugin(): Plugin {
  return {
    name: "admin-api",
    configureServer(server: ViteDevServer) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? "", "http://localhost");
        const pathname = url.pathname;

        if (
          !pathname.startsWith("/api/facts") &&
          !pathname.startsWith("/api/skills") &&
          pathname !== "/api/settings"
        ) {
          next();
          return;
        }

        try {
          // Преобразуем Node IncomingMessage в web-standard Request,
          // чтобы переиспользовать те же handlers, что и в Netlify Functions.
          const body =
            req.method === "POST" || req.method === "PUT" || req.method === "PATCH"
              ? await readBody(req)
              : undefined;
          const request = new Request(
            `http://localhost${pathname}`,
            {
              method: req.method ?? "GET",
              headers: new Headers(req.headers as Record<string, string>),
              body: body,
            },
          );

          let response: Response;
          if (pathname.startsWith("/api/facts")) {
            response = await handleFactsRequest(
              request,
              pathname,
              await getFactStore(),
            );
          } else if (pathname.startsWith("/api/skills")) {
            response = await handleSkillsRequest(
              request,
              pathname,
              fileSkillStore,
            );
          } else {
            response = await handleSettingsRequest(
              request,
              pathname,
              await getSettingsStore(),
            );
          }

          res.statusCode = response.status;
          response.headers.forEach((value, key) => res.setHeader(key, value));
          const text = await response.text();
          res.end(text);
        } catch (err) {
          if (!res.headersSent) {
            sendJson(
              res,
              500,
              { error: err instanceof Error ? err.message : "Internal error" },
            );
          }
        }
      });
    },
  };
}
