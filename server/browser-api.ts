import type { Plugin } from "vite";
import { getOrCreatePage, closeChatSession } from "./browser-session";

export function browserApiPlugin(): Plugin {
  return {
    name: "browser-api",
    configureServer(server) {
      server.middlewares.use("/api/browser", async (req, res) => {
        const url = new URL(req.url ?? "", `http://${req.headers.host}`);
        const chatId = url.searchParams.get("chatId") ?? "default";

        if (req.method !== "POST") {
          res.statusCode = 405;
          res.setHeader("Allow", "POST");
          res.end();
          return;
        }

        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk as Buffer);
        let body: any;
        try {
          body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        } catch {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: "Invalid JSON" }));
          return;
        }

        const { action } = body;

        try {
          const page = await getOrCreatePage(chatId);
          let result: any;

          switch (action) {
            case "navigate": {
              const { url: targetUrl } = body;
              if (!targetUrl) throw new Error("url required");
              await page.goto(targetUrl, { waitUntil: "networkidle", timeout: 30000 });
              const title = await page.title();
              result = { title, url: page.url() };
              break;
            }

            case "screenshot": {
              const screenshot = await page.screenshot({ type: "jpeg", quality: 60 });
              result = { screenshot: `data:image/jpeg;base64,${screenshot.toString("base64")}` };
              break;
            }

            case "click": {
              const { x, y } = body;
              if (x == null || y == null) throw new Error("x and y required");
              await page.mouse.click(x, y);
              result = { ok: true };
              break;
            }

            case "type": {
              const { text } = body;
              if (text == null) throw new Error("text required");
              await page.keyboard.type(text, { delay: 20 });
              result = { ok: true };
              break;
            }

            case "scroll": {
              const { dx = 0, dy = 300 } = body;
              await page.evaluate(({ dx, dy }: { dx: number; dy: number }) => window.scrollBy(dx, dy), { dx, dy });
              result = { ok: true };
              break;
            }

            case "getHtml": {
              const html = await page.content();
              result = { html: html.slice(0, 5000) }; // truncated for storage
              break;
            }

            case "getText": {
              const text = await page.evaluate(() => document.body?.innerText ?? "");
              result = { text: text.slice(0, 10000) };
              break;
            }

            case "close": {
              await closeChatSession(chatId);
              result = { ok: true };
              break;
            }

            default:
              res.statusCode = 400;
              res.end(JSON.stringify({ error: `Unknown action: ${action}` }));
              return;
          }

          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(result));
        } catch (err) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
        }
      });
    },
  };
}
