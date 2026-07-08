import type { FactInput, FactStore, FactUpdate, UserFact } from "./user-facts.ts";

function json(status: number, data: unknown): Response {
  return Response.json(data, { status });
}

async function readJson<T = unknown>(req: Request): Promise<T | null> {
  try {
    return (await req.json()) as T;
  } catch {
    return null;
  }
}

/**
 * Обрабатывает REST-запросы к /api/facts и /api/facts/:id.
 * Работает с web-standard Request/Response — используется
 * Netlify-функциями и Vite middleware.
 */
export async function handleFactsRequest(
  req: Request,
  pathname: string,
  store: FactStore,
): Promise<Response> {
  // /api/facts — список + создание
  if (pathname === "/api/facts") {
    if (req.method === "GET") {
      const facts = await store.list();
      return json(200, { facts });
    }
    if (req.method === "POST") {
      const body = await readJson<FactInput>(req);
      if (!body || typeof body.text !== "string" || !body.text.trim()) {
        return json(400, { error: "Поле 'text' обязательно" });
      }
      const fact = await store.add({
        text: body.text.trim(),
        category: body.category ?? "other",
      });
      return json(201, { fact });
    }
    return json(405, { error: "Method not allowed" });
  }

  // /api/facts/:id — изменить / удалить
  const match = pathname.match(/^\/api\/facts\/([^/]+)$/);
  if (match) {
    const id = match[1];

    if (req.method === "PUT") {
      const body = await readJson<FactUpdate>(req);
      if (!body) return json(400, { error: "Invalid JSON body" });
      if (body.text !== undefined && !body.text.trim()) {
        return json(400, { error: "Поле 'text' не может быть пустым" });
      }
      const fact = await store.update(id, {
        text: body.text?.trim(),
        category: body.category,
      });
      if (!fact) return json(404, { error: "Факт не найден" });
      return json(200, { fact });
    }

    if (req.method === "DELETE") {
      const deleted = await store.delete(id);
      if (!deleted) return json(404, { error: "Факт не найден" });
      return json(200, { ok: true });
    }

    return json(405, { error: "Method not allowed" });
  }

  return json(404, { error: "Not found" });
}

export type { UserFact };
