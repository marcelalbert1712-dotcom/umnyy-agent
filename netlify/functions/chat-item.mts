import type { Config, Context } from "@netlify/functions";
import { handleChatsRequest } from "../../server/chats-handler.ts";
import { blobsChatStore } from "../../server/blobs-storage.ts";

/**
 * Netlify Function: /api/chats/:id
 *   GET    — получить чат с сообщениями
 *   PUT    — сохранить сообщения (и авто-заголовок)
 *   DELETE — удалить чат
 */
export default async (req: Request, context: Context): Promise<Response> => {
  const id = context.params.id;
  const pathname = `/api/chats/${id}`;
  try {
    return await handleChatsRequest(req, pathname, blobsChatStore);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 },
    );
  }
};

export const config: Config = {
  path: "/api/chats/:id",
  method: ["GET", "PUT", "DELETE"],
};
