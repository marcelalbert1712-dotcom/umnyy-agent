import type { Config } from "@netlify/functions";
import { handleFactsRequest } from "../../server/facts-handler.ts";
import { getFactStore } from "../../server/user-facts.ts";

/**
 * Netlify Function: /api/facts
 *   GET  — список фактов о пользователе
 *   POST — добавить факт
 */
export default async (req: Request): Promise<Response> => {
  try {
    return await handleFactsRequest(req, "/api/facts", await getFactStore());
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 },
    );
  }
};

export const config: Config = {
  path: "/api/facts",
  method: ["GET", "POST"],
};
