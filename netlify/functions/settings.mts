import type { Config } from "@netlify/functions";
import { handleSettingsRequest } from "../../server/settings-handler.ts";
import { getSettingsStore } from "../../server/user-settings.ts";

/**
 * Netlify Function: /api/settings
 *   GET — получить настройки (пресет + пользовательский промпт)
 *   PUT — сохранить настройки
 */
export default async (req: Request): Promise<Response> => {
  try {
    return await handleSettingsRequest(
      req,
      "/api/settings",
      await getSettingsStore(),
    );
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 },
    );
  }
};

export const config: Config = {
  path: "/api/settings",
  method: ["GET", "PUT"],
};
