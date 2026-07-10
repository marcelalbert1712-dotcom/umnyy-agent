import type { Plugin, ViteDevServer } from "vite";
import type { IncomingMessage, ServerResponse } from "node:http";
import { listFeeds, addFeed, removeFeed, checkFeed, checkAllFeeds, type RSSFeed } from "./rss-store.ts";
import { listTasks, addTask, removeTask, scheduleNewJob, cancelJob } from "./cron-store.ts";

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
 * Vite middleware plugin:
 *   GET    /api/rss-feeds            — list RSS feeds
 *   POST   /api/rss-feeds             — add feed {url, title?}
 *   DELETE /api/rss-feeds?id=xxx      — remove feed
 *   GET    /api/rss-check?id=xxx      — check single feed
 *   GET    /api/rss-check             — check all feeds
 *   GET    /api/cron-tasks            — list cron tasks
 *   POST   /api/cron-tasks            — add task {name, cron, prompt}
 *   DELETE /api/cron-tasks?id=xxx     — remove task
 */
export function integrationsApiPlugin(): Plugin {
  return {
    name: "integrations-api",
    configureServer(server: ViteDevServer) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? "", "http://localhost");
        const pathname = url.pathname;

        // RSS feeds
        if (pathname === "/api/rss-feeds") {
          try {
            if (req.method === "GET") {
              const feeds: RSSFeed[] = await listFeeds();
              return sendJson(res, 200, { feeds });
            }
            if (req.method === "POST") {
              const body = JSON.parse(await readBody(req));
              if (typeof body.url !== "string") return sendJson(res, 400, { error: "url required" });
              const feed = await addFeed(body.url, body.title);
              return sendJson(res, 200, { feed });
            }
            if (req.method === "DELETE") {
              const id = url.searchParams.get("id") ?? "";
              const ok = await removeFeed(id);
              return sendJson(res, ok ? 200 : 404, { ok });
            }
            return sendJson(res, 405, { error: "Method not allowed" });
          } catch (err: any) {
            return sendJson(res, 500, { error: err.message });
          }
        }

        // RSS check
        if (pathname === "/api/rss-check") {
          try {
            const id = url.searchParams.get("id");
            if (id) {
              const result = await checkFeed(id);
              return sendJson(res, 200, result ?? { error: "Feed not found" });
            }
            const results = await checkAllFeeds();
            return sendJson(res, 200, { results });
          } catch (err: any) {
            return sendJson(res, 500, { error: err.message });
          }
        }

        // Cron tasks
        if (pathname === "/api/cron-tasks") {
          try {
            if (req.method === "GET") {
              const tasks = await listTasks();
              return sendJson(res, 200, { tasks });
            }
            if (req.method === "POST") {
              const body = JSON.parse(await readBody(req));
              if (typeof body.name !== "string" || typeof body.cron !== "string" || typeof body.prompt !== "string") {
                return sendJson(res, 400, { error: "name, cron, prompt required" });
              }
              const task = await addTask({ name: body.name, cron: body.cron, prompt: body.prompt, chatId: "default" });
              await scheduleNewJob(task);
              return sendJson(res, 200, { task });
            }
            if (req.method === "DELETE") {
              const id = url.searchParams.get("id") ?? "";
              await cancelJob(id);
              const ok = await removeTask(id);
              return sendJson(res, ok ? 200 : 404, { ok });
            }
            return sendJson(res, 405, { error: "Method not allowed" });
          } catch (err: any) {
            return sendJson(res, 500, { error: err.message });
          }
        }

        next();
      });
    },
  };
}