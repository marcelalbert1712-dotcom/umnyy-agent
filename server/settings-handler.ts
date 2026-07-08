import type { SettingsStore, UserSettings } from "./user-settings.ts";

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
 * Обрабатывает REST-запросы к /api/settings.
 *   GET /api/settings         — получить настройки
 *   PUT /api/settings         — сохранить (preset и/или customPrompt)
 */
export async function handleSettingsRequest(
  req: Request,
  pathname: string,
  store: SettingsStore,
): Promise<Response> {
  if (pathname !== "/api/settings") {
    return json(404, { error: "Not found" });
  }

  if (req.method === "GET") {
    const settings = await store.get();
    return json(200, { settings });
  }

  if (req.method === "PUT") {
    const body = await readJson<{
      preset?: string;
      customPrompt?: string;
      folders?: Array<{ id: string; name: string }>;
      mcpServers?: Array<{ id: string; name: string; command: string; args: string[]; env?: Record<string, string>; enabled: boolean }>;
    }>(req);
    if (!body) return json(400, { error: "Invalid JSON body" });
    const patch: Partial<Omit<UserSettings, "updatedAt">> = {};
    if (typeof body.preset === "string") patch.preset = body.preset;
    if (typeof body.customPrompt === "string")
      patch.customPrompt = body.customPrompt;
    if (Array.isArray(body.folders)) patch.folders = body.folders;
    if (Array.isArray(body.mcpServers)) patch.mcpServers = body.mcpServers;
    const settings = await store.save(patch);
    return json(200, { settings });
  }

  return json(405, { error: "Method not allowed" });
}
