import type { Plugin, ViteDevServer } from "vite";
import type { UIMessage } from "ai";
import { streamChatResponse } from "./polza-client.ts";

/**
 * Vite middleware-плагин: обслуживает POST /api/chat.
 * Запускает агентский цикл через streamText + stopWhen: stepCountIs(...)
 * и отдаёт результат как SSE в формате UI Message Stream (события разделены \\n\\n).
 */
export function polzaaiChatPlugin(): Plugin {
  return {
    name: "polzaai-chat-api",
    configureServer(server: ViteDevServer) {
      server.middlewares.use("/api/chat", async (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.setHeader("Allow", "POST");
          res.end();
          return;
        }

        const controller = new AbortController();
        let finished = false;
        // Прерывать генерацию, только если клиент отключился до завершения.
        res.on("close", () => {
          if (!finished) controller.abort();
        });

        try {
          const chunks: Buffer[] = [];
          for await (const chunk of req) chunks.push(chunk as Buffer);
          const body = JSON.parse(
            Buffer.concat(chunks).toString("utf8"),
          ) as { messages: UIMessage[]; id?: string };

          const response = await streamChatResponse(
            body.messages,
            controller.signal,
            undefined,
            undefined,
            body.id,
          );

          res.statusCode = response.status;
          response.headers.forEach((value, key) =>
            res.setHeader(key, value),
          );

          const reader = response.body!.getReader();
          const pump = async () => {
            try {
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                res.write(Buffer.from(value));
              }
              res.end();
            } catch (err) {
              if (!res.headersSent) {
                res.statusCode = 500;
                res.end(
                  err instanceof Error ? err.message : "Stream error",
                );
              } else {
                try {
                  res.end();
                } catch {
                  /* socket already closed */
                }
              }
            } finally {
              finished = true;
            }
          };
          void pump();
        } catch (err) {
          if (!res.headersSent) {
            res.statusCode = 500;
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(
              JSON.stringify({
                error: err instanceof Error ? err.message : "Internal error",
              }),
            );
          }
        }
      });
    },
  };
}
