import type { Config } from "@netlify/functions";
import type { UIMessage } from "ai";
import { streamChatResponse } from "../../server/polza-client.ts";

/**
 * Netlify Function: POST /api/chat
 * Агентский цикл (streamText + tools) с SSE-стримингом в формате
 * UI Message Stream. API-ключ PolzaAI живёт только на сервере.
 * Принимает опциональные model/temperature из тела запроса.
 */
export default async (req: Request): Promise<Response> => {
  if (req.method !== "POST") {
    return Response.json(
      { error: "Method not allowed" },
      { status: 405, headers: { Allow: "POST" } },
    );
  }

  let body: { messages: UIMessage[]; model?: string; temperature?: number };
  try {
    body = (await req.json()) as { messages: UIMessage[]; model?: string; temperature?: number };
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!Array.isArray(body.messages)) {
    return Response.json(
      { error: "Missing 'messages' array" },
      { status: 400 },
    );
  }

  try {
    return await streamChatResponse(body.messages, req.signal, body.model, body.temperature);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 },
    );
  }
};

export const config: Config = {
  path: "/api/chat",
  method: "POST",
};
