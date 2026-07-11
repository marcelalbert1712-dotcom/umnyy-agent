import type { Plugin, ViteDevServer } from "vite";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  createChat,
  deleteChat,
  getChat,
  listChats,
  saveChat,
  startBackupScheduler,
} from "./chat-storage.ts";
import { startCronScheduler } from "./cron-store.ts";
import { startRSSChecker } from "./rss-scheduler.ts";
import { closeChatSession } from "./browser-session.ts";
import type { UIMessage } from "ai";

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
 * Vite middleware-плагин: REST API для управления чатами.
 *   GET    /api/chats        — список чатов (метаданные)
 *   POST   /api/chats        — создать чат
 *   GET    /api/chats/:id    — получить чат с сообщениями
 *   PUT    /api/chats/:id    — сохранить сообщения (и авто-заголовок)
 *   DELETE /api/chats/:id    — удалить чат
 */
export function chatsApiPlugin(): Plugin {
  return {
    name: "chats-api",
    configureServer(server: ViteDevServer) {
      startBackupScheduler();
      void startCronScheduler();
      void startRSSChecker();
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? "", "http://localhost");
        const pathname = url.pathname;

        if (!pathname.startsWith("/api/chats")) {
          next();
          return;
        }

          try {
            // /api/chats/search?q= — глобальный поиск по всем сообщениям
            if (pathname === "/api/chats/search" && req.method === "GET") {
              const q = url.searchParams.get("q")?.trim().toLowerCase();
              if (!q) return sendJson(res, 400, { error: "query required" });
              const all = await listChats();
              const results: Array<{ chatId: string; chatTitle: string; messages: Array<{ id: string; role: string; text: string }> }> = [];
              for (const chat of all) {
                const record = await getChat(chat.id);
                if (!record) continue;
                const hits: Array<{ id: string; role: string; text: string }> = [];
                for (const msg of record.messages) {
                  for (const part of msg.parts) {
                    if (part.type === "text" && "text" in part && (part as any).text.toLowerCase().includes(q)) {
                      hits.push({ id: msg.id, role: msg.role, text: (part as any).text.slice(0, 200) });
                    }
                  }
                }
                if (hits.length > 0) {
                  results.push({ chatId: chat.id, chatTitle: chat.title, messages: hits });
                }
              }
              return sendJson(res, 200, { results });
            }

            // /api/chats — список + создание
            if (pathname === "/api/chats") {
              if (req.method === "GET") {
                const chats = await listChats();
                return sendJson(res, 200, { chats });
              }
              if (req.method === "POST") {
              let title: string | undefined;
              try {
                const body = JSON.parse(await readBody(req));
                if (typeof body.title === "string") title = body.title;
              } catch {
                /* пустое тело — ок */
              }
              const chat = await createChat(title);
              return sendJson(res, 201, { chat });
            }
            return sendJson(res, 405, { error: "Method not allowed" });
          }

          // /api/chats/:id — получить / сохранить / удалить
          const match = pathname.match(/^\/api\/chats\/([^/]+)$/);
          if (match) {
            const id = match[1];

            if (req.method === "GET") {
              const chat = await getChat(id);
              if (!chat) return sendJson(res, 404, { error: "Chat not found" });
              return sendJson(res, 200, chat);
            }

            if (req.method === "PUT") {
              let body: { messages?: UIMessage[]; title?: string; folder?: string | null; archived?: boolean; pinned?: boolean };
              try {
                body = JSON.parse(await readBody(req));
              } catch {
                return sendJson(res, 400, { error: "Invalid JSON body" });
              }
              // If only updating metadata (archived/pinned) without messages, keep existing messages
              if (body.archived !== undefined || body.pinned !== undefined) {
                const existing = await getChat(id);
                const chat = await saveChat(id, {
                  title: body.title,
                  messages: body.messages ?? existing?.messages ?? [],
                  folder: body.folder,
                  archived: body.archived,
                  pinned: body.pinned,
                });
                if (!chat) return sendJson(res, 404, { error: "Chat not found" });
                return sendJson(res, 200, { chat });
              }
              const chat = await saveChat(id, {
                title: body.title,
                messages: body.messages ?? [],
                folder: body.folder,
              });
              if (!chat) return sendJson(res, 404, { error: "Chat not found" });
              return sendJson(res, 200, { chat });
            }

            if (req.method === "DELETE") {
              await closeChatSession(id);
              await deleteChat(id);
              return sendJson(res, 200, { ok: true });
            }

            return sendJson(res, 405, { error: "Method not allowed" });
          }

          return sendJson(res, 404, { error: "Not found" });
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
