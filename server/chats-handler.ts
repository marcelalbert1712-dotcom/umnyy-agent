import type { UIMessage } from "ai";
import type { ChatStore } from "./chat-store.ts";

function json(status: number, data: unknown): Response {
  return Response.json(data, { status });
}

/**
 * Обрабатывает REST-запросы к /api/chats и /api/chats/:id.
 * Работает с web-standard Request/Response — используется Netlify-функциями.
 */
export async function handleChatsRequest(
  req: Request,
  pathname: string,
  store: ChatStore,
): Promise<Response> {
  // /api/chats — список + создание
  if (pathname === "/api/chats") {
    if (req.method === "GET") {
      const chats = await store.list();
      return json(200, { chats });
    }
    if (req.method === "POST") {
      let title: string | undefined;
      try {
        const body = (await req.json()) as { title?: string } | null;
        if (typeof body?.title === "string") title = body.title;
      } catch {
        /* пустое тело — ок */
      }
      const chat = await store.create(title);
      return json(201, { chat });
    }
    return json(405, { error: "Method not allowed" });
  }

  // /api/chats/:id — получить / сохранить / удалить
  const match = pathname.match(/^\/api\/chats\/([^/]+)$/);
  if (match) {
    const id = match[1];

    if (req.method === "GET") {
      const chat = await store.get(id);
      if (!chat) return json(404, { error: "Chat not found" });
      return json(200, chat);
    }

    if (req.method === "PUT") {
      let body: { messages?: UIMessage[]; title?: string; folder?: string | null };
      try {
        body = (await req.json()) as { messages?: UIMessage[]; title?: string; folder?: string | null };
      } catch {
        return json(400, { error: "Invalid JSON body" });
      }
      const chat = await store.save(id, {
        title: body.title,
        messages: body.messages ?? [],
        folder: body.folder,
      });
      if (!chat) return json(404, { error: "Chat not found" });
      return json(200, { chat });
    }

    if (req.method === "DELETE") {
      await store.delete(id);
      return json(200, { ok: true });
    }

    return json(405, { error: "Method not allowed" });
  }

  return json(404, { error: "Not found" });
}
