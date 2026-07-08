import type { Plugin, ViteDevServer } from "vite";
import type { IncomingMessage, ServerResponse } from "node:http";
import { handleTranscribeRequest } from "./transcribe-handler.ts";

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

export function transcribeApiPlugin(): Plugin {
  return {
    name: "transcribe-api",
    configureServer(server: ViteDevServer) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? "", "http://localhost");
        if (url.pathname !== "/api/transcribe" || req.method !== "POST") {
          next();
          return;
        }
        try {
          const body = await readBody(req);
          const request = new Request("http://localhost/api/transcribe", {
            method: "POST",
            headers: { "Content-Type": req.headers["content-type"] ?? "application/json" },
            body,
          });
          const response = await handleTranscribeRequest(request);
          res.statusCode = response.status;
          response.headers.forEach((value, key) => res.setHeader(key, value));
          res.end(await response.text());
        } catch (err) {
          if (!res.headersSent) {
            sendJson(res, 500, { error: err instanceof Error ? err.message : "Internal error" });
          }
        }
      });
    },
  };
}
