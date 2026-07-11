import type { Plugin, ViteDevServer } from "vite";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

const UPLOADS_DIR = path.join(process.cwd(), ".user-data", "uploads");

export function uploadApiPlugin(): Plugin {
  return {
    name: "upload-api",
    configureServer(server: ViteDevServer) {
      // Раздача загруженных файлов
      server.middlewares.use("/api/uploads", async (req, res, next) => {
        // Только GET для статики
        if (req.method !== "GET" && req.method !== "HEAD") {
          next();
          return;
        }
        // Путь: /api/uploads/chatId/filename
        const parts = req.url?.split("/").filter(Boolean) ?? [];
        if (parts.length < 3 || parts[0] !== "uploads") {
          next();
          return;
        }
        const chatId = parts[1];
        const filename = parts.slice(2).join("/");
        const filePath = path.join(UPLOADS_DIR, chatId, filename);
        try {
          const stat = await fs.stat(filePath);
          if (!stat.isFile()) { next(); return; }
          const ext = path.extname(filename).toLowerCase();
          const mime: Record<string, string> = {
            ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
            ".png": "image/png", ".gif": "image/gif",
            ".webp": "image/webp", ".svg": "image/svg+xml",
          };
          res.setHeader("Content-Type", mime[ext] ?? "application/octet-stream");
          res.setHeader("Cache-Control", "public, max-age=86400");
          const data = await fs.readFile(filePath);
          res.end(data);
        } catch {
          res.statusCode = 404;
          res.end("Not found");
        }
      });

      // POST /api/upload — загрузка файла
      server.middlewares.use("/api/upload", async (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.setHeader("Allow", "POST");
          res.end();
          return;
        }

        try {
          const chunks: Buffer[] = [];
          for await (const chunk of req) chunks.push(chunk as Buffer);
          const raw = Buffer.concat(chunks).toString("utf8");
          const body = JSON.parse(raw) as { chatId?: string; filename: string; data: string };

          const chatId = body.chatId ?? "default";
          const base64Data = body.data.replace(/^data:[^;]+;base64,/, "");
          const ext = path.extname(body.filename) || "";
          const isVideo = ext.match(/\.(mp4|avi|mov|mkv|webm|flv|wmv|m4v|mp3|wav|m4a|aac|ogg|flac)$/i);

          if (isVideo) {
            // Save video/audio to workspace (for getVideoInfo/extractVideoFrames tools)
            const wsDir = path.join(process.cwd(), ".user-data", "workspace", chatId);
            await fs.mkdir(wsDir, { recursive: true });
            const savePath = path.join(wsDir, body.filename);
            await fs.writeFile(savePath, Buffer.from(base64Data, "base64"));
            const url = `/api/workspace/${chatId}/${body.filename}`;
            console.log(`[upload] video saved → ${url}`);
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ url, filename: body.filename, workspace: true }));
          } else {
            // Save images/other to uploads
            const dir = path.join(UPLOADS_DIR, chatId);
            await fs.mkdir(dir, { recursive: true });
            const savedName = `${randomUUID()}${ext}`;
            const filePath = path.join(dir, savedName);
            await fs.writeFile(filePath, Buffer.from(base64Data, "base64"));
            const url = `/api/uploads/${chatId}/${savedName}`;
            console.log(`[upload] saved ${body.filename} → ${url}`);
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ url, filename: savedName }));
          }
        } catch (err: any) {
          console.error("[upload] error:", err.message);
          res.statusCode = 500;
          res.end(JSON.stringify({ error: err.message }));
        }
      });
    },
  };
}
