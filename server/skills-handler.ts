import type { SkillInput, SkillStore, SkillUpdate } from "./user-skills.ts";

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

export async function handleSkillsRequest(
  req: Request,
  pathname: string,
  store: SkillStore,
): Promise<Response> {
  if (pathname === "/api/skills") {
    if (req.method === "GET") {
      const skills = await store.list();
      return json(200, { skills });
    }
    if (req.method === "POST") {
      const body = await readJson<SkillInput>(req);
      if (!body || typeof body.name !== "string" || !body.name.trim()) {
        return json(400, { error: "Поле 'name' обязательно" });
      }
      if (!body.prompt || !body.prompt.trim()) {
        return json(400, { error: "Поле 'prompt' обязательно" });
      }
      const skill = await store.add({
        name: body.name.trim(),
        description: (body.description || "").trim(),
        prompt: body.prompt.trim(),
      });
      return json(201, { skill });
    }
    return json(405, { error: "Method not allowed" });
  }

  const match = pathname.match(/^\/api\/skills\/([^/]+)$/);
  if (match) {
    const id = match[1];
    if (req.method === "GET") {
      const skills = await store.list();
      const skill = skills.find((s) => s.id === id);
      if (!skill) return json(404, { error: "Навык не найден" });
      return json(200, { skill });
    }
    if (req.method === "PATCH") {
      const body = await readJson<SkillUpdate>(req);
      if (!body) return json(400, { error: "Invalid JSON body" });
      const skill = await store.update(id, body);
      if (!skill) return json(404, { error: "Навык не найден" });
      return json(200, { skill });
    }
    if (req.method === "DELETE") {
      const deleted = await store.delete(id);
      if (!deleted) return json(404, { error: "Навык не найден" });
      return json(200, { ok: true });
    }
    return json(405, { error: "Method not allowed" });
  }

  return json(404, { error: "Not found" });
}
