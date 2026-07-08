import type { Config } from "@netlify/functions";
import { createTask, getTask, listTasks, deleteTask, runTaskInBackground } from "../../server/task-queue.ts";

export default async (req: Request): Promise<Response> => {
  const url = new URL(req.url);

  // POST /api/tasks
  if (req.method === "POST") {
    let body: { chatId?: string; goal: string };
    try {
      body = (await req.json()) as { chatId?: string; goal: string };
    } catch {
      return Response.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    if (!body.goal?.trim()) {
      return Response.json({ error: "goal is required" }, { status: 400 });
    }
    const task = await createTask(body.chatId ?? "default", body.goal);
    runTaskInBackground(task.id, async () => {
      await new Promise((r) => setTimeout(r, 3000));
      return `Задача "${body.goal}" выполнена. Результат будет доступен в чате.`;
    });
    return Response.json({ task });
  }

  // DELETE /api/tasks/:id
  if (req.method === "DELETE") {
    const id = url.pathname.replace("/api/tasks/", "").split("?")[0];
    if (!id) return Response.json({ error: "task id is required" }, { status: 400 });
    await deleteTask(id);
    return Response.json({ ok: true });
  }

  // GET /api/tasks/:id
  const match = url.pathname.match(/^\/api\/tasks\/([^/]+)$/);
  if (match) {
    const task = await getTask(match[1]);
    if (!task) return Response.json({ error: "task not found" }, { status: 404 });
    return Response.json({ task });
  }

  // GET /api/tasks
  const chatId = url.searchParams.get("chatId") ?? undefined;
  const tasks = await listTasks(chatId);
  return Response.json({ tasks });
};

export const config: Config = {
  path: "/api/tasks",
  method: "GET, POST, DELETE",
};
