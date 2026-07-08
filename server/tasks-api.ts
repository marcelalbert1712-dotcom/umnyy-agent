import type { Plugin } from "vite";
import { createTask, getTask, listTasks, deleteTask, runTaskInBackground } from "./task-queue.ts";
import { runBackgroundAgent } from "./background-agent.ts";

export function tasksApiPlugin(): Plugin {
  return {
    name: "tasks-api",
    configureServer(server) {
      server.middlewares.use("/api/tasks", async (req, res) => {
        // POST /api/tasks — создать задачу
        if (req.method === "POST") {
          try {
            const chunks: Buffer[] = [];
            for await (const chunk of req) chunks.push(chunk as Buffer);
            const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
              chatId?: string;
              goal: string;
            };
            if (!body.goal || !body.goal.trim()) {
              res.statusCode = 400;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ error: "goal is required" }));
              return;
            }
            const chatId = body.chatId ?? "default";
            const task = await createTask(chatId, body.goal);
            runTaskInBackground(task.id, () =>
              runBackgroundAgent(task.id, chatId, body.goal),
            );
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ task }));
          } catch (err) {
            res.statusCode = 500;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: err instanceof Error ? err.message : "Internal error" }));
          }
          return;
        }

        // GET /api/tasks — список задач
        if (req.method === "GET") {
          try {
            const url = new URL(req.url ?? "", `http://${req.headers.host}`);
            const chatId = url.searchParams.get("chatId") ?? undefined;
            const tasks = await listTasks(chatId);
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ tasks }));
          } catch (err) {
            res.statusCode = 500;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: err instanceof Error ? err.message : "Internal error" }));
          }
          return;
        }

        // DELETE /api/tasks/:id — удалить задачу
        if (req.method === "DELETE") {
          const id = req.url?.replace("/api/tasks/", "").split("?")[0];
          if (!id) {
            res.statusCode = 400;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: "task id is required" }));
            return;
          }
          try {
            await deleteTask(id);
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ ok: true }));
          } catch (err) {
            res.statusCode = 500;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: err instanceof Error ? err.message : "Internal error" }));
          }
          return;
        }

        // GET /api/tasks/:id — конкретная задача
        if (req.method === "GET") {
          const match = req.url?.match(/^\/api\/tasks\/([^/]+)$/);
          if (match) {
            const id = match[1];
            const task = await getTask(id);
            if (!task) {
              res.statusCode = 404;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ error: "task not found" }));
              return;
            }
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ task }));
            return;
          }
        }

        res.statusCode = 405;
        res.setHeader("Allow", "POST, GET, DELETE");
        res.end();
      });
    },
  };
}
