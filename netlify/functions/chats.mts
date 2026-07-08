import type { Config } from "@netlify/functions";
import { handleChatsRequest } from "../../server/chats-handler.ts";
import { blobsChatStore } from "../../server/blobs-storage.ts";

/**
 * Netlify Function: /api/chats
 *   GET  — список чатов (метаданные)
 *   POST — создать чат
 */
export default async (req: Request): Promise<Response> => {
  try {
    return await handleChatsRequest(req, "/api/chats", blobsChatStore);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 },
    );
  }
};

export const config: Config = {
  path: "/api/chats",
  method: ["GET", "POST"],
};
