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
        res.on("close", () => {
          if (!finished) controller.abort();
        });

        try {
          const chunks: Buffer[] = [];
          for await (const chunk of req) chunks.push(chunk as Buffer);
          const body = JSON.parse(
            Buffer.concat(chunks).toString("utf8"),
          ) as { messages: UIMessage[]; id?: string };

          // ── Перехват лендингов (до вызова AI) ────────────────
          const messages = body.messages;
          const chatId = body.id;
          const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
          const lastText = (
            lastUserMsg?.parts?.filter((p: any) => p.type === "text").map((p: any) => p.text).join(" ") ||
            lastUserMsg?.content ||
            ""
          ).trim();
          const landingKeywords = ["лендинг", "landing page", "landing", "сделай сайт", "сделай страницу", "create landing"];
          const isLanding = landingKeywords.some((k) => lastText.toLowerCase().includes(k)) && lastText.length < 200;
          console.log(`[polza-chat] lastText="${lastText.slice(0, 120)}", isLanding=${isLanding}, chatId=${chatId}`);

          if (isLanding && chatId) {
            const { setCurrentChatId } = await import("./tools.ts");
            setCurrentChatId(chatId);

            const topic = lastText
              .replace(/сделай|создай|напиши|лендинг|landing.page|landing|сайт|страницу|про|craiy|create|page/gi, "")
              .replace(/[""«»«»「」,.!?]+/g, " ")
              .replace(/\s+/g, " ")
              .trim() || "красивая тема";

            console.log(`[polza-chat] creating landing page for topic="${topic}"`);
            const { tools } = await import("./tools.ts");
            const landingResult = await (tools.createLandingPage as any).execute?.({ topic });

            if (landingResult?.ok) {
              const linkText = `✅ Лендинг "${topic}" готов!\n\n[Открыть лендинг](${landingResult.httpPath})\n\n${landingResult.message || ""}`;
              const msgId = `msg_${Date.now()}`;
              const encoder = new TextEncoder();
              const sse = (obj: unknown) => encoder.encode(`data: ${JSON.stringify(obj)}\n\n`);
              const stream = new ReadableStream({
                start(ctl) {
                  ctl.enqueue(sse({ type: "start" }));
                  ctl.enqueue(sse({ type: "start-step" }));
                  ctl.enqueue(sse({ type: "text-start", id: msgId }));
                  ctl.enqueue(sse({ type: "text-delta", id: msgId, delta: linkText }));
                  ctl.enqueue(sse({ type: "text-end", id: msgId }));
                  ctl.enqueue(sse({ type: "finish-step" }));
                  ctl.enqueue(sse({ type: "finish" }));
                  ctl.enqueue(encoder.encode("data: [DONE]\n\n"));
                  ctl.close();
                },
              });
              res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
              res.setHeader("Cache-Control", "no-cache");
              res.setHeader("Connection", "keep-alive");
              const reader = stream.getReader();
              const pump = async () => {
                while (true) {
                  const { done, value } = await reader.read();
                  if (done) break;
                  res.write(Buffer.from(value));
                }
                res.end();
                finished = true;
              };
              void pump();
              return;
            }
          }

          // ── Обычный AI-ответ ──────────────────────────────────
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
