import { promises as fs } from "node:fs";
import path from "node:path";
import { DEFAULT_PRESET_ID } from "./presets.ts";

/**
 * Настройки пользователя: пресет характера + произвольный промпт,
 * который добавляется к системному промпту агента.
 */
export type FolderDef = {
  id: string;
  name: string;
};

export type ToolConfig = {
  id: string;
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  enabled: boolean;
};

export type UserSettings = {
  preset: string;
  customPrompt: string;
  model: string;
  temperature: number | null;
  folders: FolderDef[];
  mcpServers: ToolConfig[];
  telegramBotToken: string;
  telegramChatId: string;
  githubToken: string;
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPass: string;
  smtpFrom: string;
  updatedAt: number;
};

export const DEFAULT_SETTINGS: UserSettings = {
  preset: DEFAULT_PRESET_ID,
  customPrompt: "",
  model: "",
  temperature: null,
  folders: [],
  mcpServers: [],
  telegramBotToken: "",
  telegramChatId: "",
  githubToken: "",
  smtpHost: "",
  smtpPort: 587,
  smtpUser: "",
  smtpPass: "",
  smtpFrom: "",
  updatedAt: 0,
};

export interface SettingsStore {
  get(): Promise<UserSettings>;
  save(data: Partial<Omit<UserSettings, "updatedAt">>): Promise<UserSettings>;
}

// ── File-based implementation (для локальной разработки: vite dev) ──────────

const DATA_DIR = path.join(process.cwd(), ".user-data");
const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");

async function ensureDir(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

async function readFile(): Promise<UserSettings> {
  try {
    const raw = await fs.readFile(SETTINGS_FILE, "utf8");
    const data = JSON.parse(raw) as Partial<UserSettings>;
    return {
      preset: data.preset ?? DEFAULT_SETTINGS.preset,
      customPrompt: data.customPrompt ?? DEFAULT_SETTINGS.customPrompt,
      model: data.model ?? DEFAULT_SETTINGS.model,
      temperature: data.temperature !== undefined ? data.temperature : DEFAULT_SETTINGS.temperature,
      folders: Array.isArray(data.folders) ? data.folders : DEFAULT_SETTINGS.folders,
      mcpServers: Array.isArray(data.mcpServers) ? data.mcpServers : DEFAULT_SETTINGS.mcpServers,
      telegramBotToken: typeof data.telegramBotToken === "string" ? data.telegramBotToken : DEFAULT_SETTINGS.telegramBotToken,
      telegramChatId: typeof data.telegramChatId === "string" ? data.telegramChatId : DEFAULT_SETTINGS.telegramChatId,
      githubToken: typeof data.githubToken === "string" ? data.githubToken : DEFAULT_SETTINGS.githubToken,
      smtpHost: typeof data.smtpHost === "string" ? data.smtpHost : DEFAULT_SETTINGS.smtpHost,
      smtpPort: typeof data.smtpPort === "number" ? data.smtpPort : DEFAULT_SETTINGS.smtpPort,
      smtpUser: typeof data.smtpUser === "string" ? data.smtpUser : DEFAULT_SETTINGS.smtpUser,
      smtpPass: typeof data.smtpPass === "string" ? data.smtpPass : DEFAULT_SETTINGS.smtpPass,
      smtpFrom: typeof data.smtpFrom === "string" ? data.smtpFrom : DEFAULT_SETTINGS.smtpFrom,
      updatedAt: data.updatedAt ?? 0,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

async function writeFile(data: UserSettings): Promise<void> {
  await ensureDir();
  await fs.writeFile(SETTINGS_FILE, JSON.stringify(data, null, 2));
}

export const fileSettingsStore: SettingsStore = {
  async get(): Promise<UserSettings> {
    return readFile();
  },

  async save(
    input: Partial<Omit<UserSettings, "updatedAt">>,
  ): Promise<UserSettings> {
    const current = await readFile();
    const next: UserSettings = {
      preset: input.preset ?? current.preset,
      customPrompt:
        input.customPrompt !== undefined
          ? input.customPrompt
          : current.customPrompt,
      model: input.model !== undefined ? input.model : current.model,
      temperature: input.temperature !== undefined ? input.temperature : current.temperature,
      folders: Array.isArray(input.folders) ? input.folders : current.folders,
      mcpServers: Array.isArray(input.mcpServers) ? input.mcpServers : current.mcpServers,
      telegramBotToken: typeof input.telegramBotToken === "string" ? input.telegramBotToken : current.telegramBotToken,
      telegramChatId: typeof input.telegramChatId === "string" ? input.telegramChatId : current.telegramChatId,
      githubToken: typeof input.githubToken === "string" ? input.githubToken : current.githubToken,
      smtpHost: typeof input.smtpHost === "string" ? input.smtpHost : current.smtpHost,
      smtpPort: typeof input.smtpPort === "number" ? input.smtpPort : current.smtpPort,
      smtpUser: typeof input.smtpUser === "string" ? input.smtpUser : current.smtpUser,
      smtpPass: typeof input.smtpPass === "string" ? input.smtpPass : current.smtpPass,
      smtpFrom: typeof input.smtpFrom === "string" ? input.smtpFrom : current.smtpFrom,
      updatedAt: Date.now(),
    };
    await writeFile(next);
    return next;
  },
};

// ── Store selector ──────────────────────────────────────────────────────────

let cachedStore: SettingsStore | null = null;

/**
 * Возвращает подходящее хранилище настроек в зависимости от среды:
 *  - Netlify Functions / netlify dev → Blobs (USE_BLOBS=true)
 *  - Plain vite dev → файл (.user-data/settings.json)
 */
export async function getSettingsStore(): Promise<SettingsStore> {
  if (cachedStore) return cachedStore;

  if (process.env.USE_BLOBS === "true") {
    const { blobsSettingsStore } = await import("./blobs-user-settings.ts");
    cachedStore = blobsSettingsStore;
  } else {
    cachedStore = fileSettingsStore;
  }
  return cachedStore;
}
