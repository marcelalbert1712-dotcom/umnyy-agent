import { getStore } from "@netlify/blobs";
import {
  DEFAULT_SETTINGS,
  type SettingsStore,
  type UserSettings,
} from "./user-settings.ts";

const STORE_NAME = "user-settings";
const SETTINGS_KEY = "settings";

async function readSettings(): Promise<UserSettings> {
  const store = getStore(STORE_NAME, { consistency: "strong" });
  const data = await store.get(SETTINGS_KEY, { type: "json" });
  if (!data || typeof data !== "object") return { ...DEFAULT_SETTINGS };
  const d = data as Partial<UserSettings>;
  return {
    preset: d.preset ?? DEFAULT_SETTINGS.preset,
    customPrompt: d.customPrompt ?? DEFAULT_SETTINGS.customPrompt,
    model: d.model ?? DEFAULT_SETTINGS.model,
    temperature: d.temperature !== undefined ? d.temperature : DEFAULT_SETTINGS.temperature,
    folders: Array.isArray(d.folders) ? d.folders : DEFAULT_SETTINGS.folders,
    updatedAt: d.updatedAt ?? 0,
  };
}

async function writeSettings(data: UserSettings): Promise<void> {
  const store = getStore(STORE_NAME, { consistency: "strong" });
  await store.setJSON(SETTINGS_KEY, data);
}

export const blobsSettingsStore: SettingsStore = {
  async get(): Promise<UserSettings> {
    return readSettings();
  },

  async save(
    input: Partial<Omit<UserSettings, "updatedAt">>,
  ): Promise<UserSettings> {
    const current = await readSettings();
    const next: UserSettings = {
      preset: input.preset ?? current.preset,
      customPrompt:
        input.customPrompt !== undefined
          ? input.customPrompt
          : current.customPrompt,
      model: input.model !== undefined ? input.model : current.model,
      temperature: input.temperature !== undefined ? input.temperature : current.temperature,
      folders: Array.isArray(input.folders) ? input.folders : current.folders,
      updatedAt: Date.now(),
    };
    await writeSettings(next);
    return next;
  },
};
