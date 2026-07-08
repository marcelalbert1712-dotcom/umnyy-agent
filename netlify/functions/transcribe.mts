import type { Config } from "@netlify/functions";
import { handleTranscribeRequest } from "../../server/transcribe-handler.ts";

export default async (req: Request): Promise<Response> => {
  try {
    return await handleTranscribeRequest(req);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 },
    );
  }
};

export const config: Config = {
  path: "/api/transcribe",
  method: ["POST"],
};
