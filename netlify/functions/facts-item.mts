import type { Config, Context } from "@netlify/functions";
import { handleFactsRequest } from "../../server/facts-handler.ts";
import { getFactStore } from "../../server/user-facts.ts";

/**
 * Netlify Function: /api/facts/:id
 *   PUT    — изменить факт
 *   DELETE — удалить факт
 */
export default async (req: Request, context: Context): Promise<Response> => {
  const id = context.params.id;
  const pathname = `/api/facts/${id}`;
  try {
    return await handleFactsRequest(req, pathname, await getFactStore());
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 },
    );
  }
};

export const config: Config = {
  path: "/api/facts/:id",
  method: ["PUT", "DELETE"],
};
