import { promises as fs } from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";

const DATA_DIR = path.join(process.cwd(), ".user-data", "workspace");

async function ensureDir(sub: string) {
  await fs.mkdir(path.join(DATA_DIR, sub), { recursive: true });
}

export function workspaceApiPlugin(): Plugin {
  return {
    name: "workspace-api",
    configureServer(server) {
      // GET /api/workspace-all — все файлы из всех чатов
      server.middlewares.use("/api/workspace-all", async (req, res) => {
        if (req.method !== "GET") {
          res.statusCode = 405;
          res.end();
          return;
        }
        try {
          await fs.mkdir(DATA_DIR, { recursive: true });
          const chatDirs = await fs.readdir(DATA_DIR);
          const allFiles: Array<{ name: string; size: number; modifiedAt: number; chatId: string }> = [];
          for (const dir of chatDirs) {
            if (dir.startsWith(".")) continue;
            const dirPath = path.join(DATA_DIR, dir);
            try {
              const stat = await fs.stat(dirPath);
              if (!stat.isDirectory()) continue;
              const files = await fs.readdir(dirPath);
              for (const f of files) {
                try {
                  const fstat = await fs.stat(path.join(dirPath, f));
                  allFiles.push({ name: f, size: fstat.size, modifiedAt: fstat.mtimeMs, chatId: dir });
                } catch { /* skip */ }
              }
            } catch { /* skip */ }
          }
          allFiles.sort((a, b) => b.modifiedAt - a.modifiedAt);
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ files: allFiles }));
        } catch (err) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : "Internal error" }));
        }
      });

      server.middlewares.use("/api/workspace", async (req, res) => {
        // req.url is relative to mount point in Connect; e.g. "/test1" or "/test1/file.js"
        const rawParts = (req.url ?? "").replace(/^\//, "").split("/");
        const parts = rawParts.map((p) => decodeURIComponent(p));
        const chatId = parts[0] || "default";
        const filename = parts.slice(1).join("/");

        // GET /api/workspace/:chatId — список файлов
        if (req.method === "GET" && !filename) {
          try {
            const dir = path.join(DATA_DIR, chatId);
            try { await fs.access(dir); } catch { await fs.mkdir(dir, { recursive: true }); }
            const files = await fs.readdir(dir);
            const entries = await Promise.all(files.map(async (f) => {
              try {
                const stat = await fs.stat(path.join(dir, f));
                return { name: f, size: stat.size, modifiedAt: stat.mtimeMs };
              } catch { return null; }
            }));
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ files: entries.filter(Boolean) }));
          } catch (err) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: err instanceof Error ? err.message : "Internal error" }));
          }
          return;
        }

        // GET /api/workspace/:chatId/:filename — скачать файл
        if (req.method === "GET" && filename) {
          try {
            const filePath = path.join(DATA_DIR, chatId, filename);
            const content = await fs.readFile(filePath);
            const ext = path.extname(filename).toLowerCase();
            const mime: Record<string, string> = {
              ".html": "text/html",
              ".htm": "text/html",
              ".js": "text/javascript",
              ".json": "application/json",
              ".csv": "text/csv",
              ".txt": "text/plain",
              ".md": "text/markdown",
              ".png": "image/png",
              ".jpg": "image/jpeg",
              ".jpeg": "image/jpeg",
              ".gif": "image/gif",
              ".svg": "image/svg+xml",
              ".css": "text/css",
              ".pdf": "application/pdf",
            };
            res.setHeader("Content-Type", mime[ext] ?? "application/octet-stream");
            res.end(content);
          } catch {
            res.statusCode = 404;
            res.end("File not found");
          }
          return;
        }

        // POST /api/workspace/:chatId/:filename — сохранить файл
        if (req.method === "POST" && filename) {
          try {
            const chunks: Buffer[] = [];
            for await (const chunk of req) chunks.push(chunk as Buffer);
            const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { content?: string };
            if (body.content === undefined) {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: "content is required" }));
              return;
            }
            await ensureDir(chatId);
            const filePath = path.join(DATA_DIR, chatId, filename);
            await fs.writeFile(filePath, body.content, "utf8");
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ ok: true, path: `/api/workspace/${chatId}/${filename}` }));
          } catch (err) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: err instanceof Error ? err.message : "Internal error" }));
          }
          return;
        }

        // DELETE /api/workspace/:chatId/:filename
        if (req.method === "DELETE" && filename) {
          try {
            await fs.unlink(path.join(DATA_DIR, chatId, filename));
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ ok: true }));
          } catch {
            res.statusCode = 404;
            res.end("File not found");
          }
          return;
        }

        res.statusCode = 405;
        res.setHeader("Allow", "GET, POST, DELETE");
        res.end();
      });
    },
  };
}
