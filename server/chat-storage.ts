import { promises as fs } from "node:fs";
import path from "node:path";
import type { UIMessage } from "ai";
import {
  DEFAULT_TITLE,
  type ChatMeta,
  type ChatRecord,
  type ChatStore,
  deriveTitle,
  genChatId,
  metaFrom,
  sanitizeId,
} from "./chat-store.ts";

const DATA_DIR = path.join(process.cwd(), ".chats-data");
const TRASH_DIR = path.join(DATA_DIR, ".trash");
const BACKUP_DIR = path.join(DATA_DIR, ".backup");
const BACKUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_BACKUPS = 12; // keep last 12 backups (~1 hour of history)

async function ensureDir(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.mkdir(TRASH_DIR, { recursive: true });
  await fs.mkdir(BACKUP_DIR, { recursive: true });
}

function fileFor(id: string): string {
  return path.join(DATA_DIR, `${sanitizeId(id)}.json`);
}

/**
 * Atomic write: write to temp file in same dir, then rename.
 * Prevents corruption if process crashes mid-write.
 * Uses os.tmpdir() to avoid cross-device rename issues, then renames.
 */
async function atomicWrite(filePath: string, data: string): Promise<void> {
  const tmp = filePath + ".tmp." + process.pid;
  await fs.writeFile(tmp, data, "utf8");
  // fs.rename is atomic on same volume; temp file is in same dir as target
  await fs.rename(tmp, filePath);
}

/**
 * Auto-backup: copies all *.json from DATA_DIR into a timestamped folder
 * inside BACKUP_DIR. Prunes old backups beyond MAX_BACKUPS.
 */
async function createBackup(): Promise<void> {
  try {
    const entries = await fs.readdir(DATA_DIR);
    const jsonFiles = entries.filter((e) => e.endsWith(".json"));
    if (jsonFiles.length === 0) return;

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const dest = path.join(BACKUP_DIR, stamp);
    await fs.mkdir(dest, { recursive: true });

    for (const file of jsonFiles) {
      await fs.copyFile(path.join(DATA_DIR, file), path.join(dest, file));
    }

    // Prune old backups
    const backups = (await fs.readdir(BACKUP_DIR)).sort();
    const toRemove = backups.slice(0, Math.max(0, backups.length - MAX_BACKUPS));
    for (const old of toRemove) {
      await fs.rm(path.join(BACKUP_DIR, old), { recursive: true, force: true });
    }
  } catch {
    /* backup failures should never crash the app */
  }
}

let backupTimer: ReturnType<typeof setInterval> | null = null;

export function startBackupScheduler(): void {
  if (backupTimer) return;
  // Initial backup shortly after startup
  setTimeout(() => void createBackup(), 10_000);
  backupTimer = setInterval(() => void createBackup(), BACKUP_INTERVAL_MS);
}

export function stopBackupScheduler(): void {
  if (backupTimer) {
    clearInterval(backupTimer);
    backupTimer = null;
  }
}

export async function listChats(): Promise<ChatMeta[]> {
  await ensureDir();
  const entries = await fs.readdir(DATA_DIR);
  const metas: ChatMeta[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    try {
      const raw = await fs.readFile(path.join(DATA_DIR, entry), "utf8");
      const record = JSON.parse(raw) as ChatRecord;
      metas.push(metaFrom(record));
    } catch {
      /* skip corrupt files */
    }
  }
  return metas.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getChat(id: string): Promise<ChatRecord | null> {
  try {
    const raw = await fs.readFile(fileFor(id), "utf8");
    return JSON.parse(raw) as ChatRecord;
  } catch {
    return null;
  }
}

export async function createChat(title = DEFAULT_TITLE): Promise<ChatMeta> {
  await ensureDir();
  const id = genChatId();
  const now = Date.now();
  const record: ChatRecord = {
    id,
    title,
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
  await atomicWrite(fileFor(id), JSON.stringify(record, null, 2));
  return metaFrom(record);
}

/** Удаляет тяжёлые base64-данные из сообщений перед сохранением на диск.
 *  ВИДЕО/АУДИО уже сохранены в workspace, base64 в JSON не нужен.
 *  Большие изображения (>50KB base64) тоже вырезаем, оставляем data-URL мигом. */
function stripMediaPayload(messages: UIMessage[]): UIMessage[] {
  return messages.map((msg) => {
    if (!msg.parts) return msg;
    const stripped = msg.parts.map((part: any) => {
      // File part с data: URL — вырезаем payload
      if (part.type === "file" && typeof part.url === "string" && part.url.startsWith("data:")) {
        const mediaType = part.mediaType ?? part.mimeType ?? "application/octet-stream";
        return {
          ...part,
          url: `[data:${mediaType};base64,...stripped by saveChat...]`,
          filename: part.filename ?? "uploaded-file",
        };
      }
      // Image part с data: URL (>50KB) — вырезаем payload
      if (part.type === "image" && typeof part.image === "string" && part.image.startsWith("data:")) {
        if (part.image.length > 50_000) {
          return {
            ...part,
            image: `[image stripped by saveChat...]`,
          };
        }
      }
      return part;
    });
    return { ...msg, parts: stripped };
  });
}

export async function saveChat(
  id: string,
  data: { title?: string; messages: UIMessage[]; folder?: string | null; archived?: boolean; pinned?: boolean },
): Promise<ChatMeta | null> {
  const existing = await getChat(id);
  if (!existing) return null;
  const title = data.title ?? deriveTitle(data.messages, existing.title);
  const now = Date.now();

  // Вырезаем base64-видео/аудио/большие изображения перед сохранением
  const cleanMessages = stripMediaPayload(data.messages);

  const record: ChatRecord = {
    ...existing,
    title,
    messages: cleanMessages,
    updatedAt: now,
  };
  if (data.folder !== undefined) record.folder = data.folder ?? undefined;
  if (data.archived !== undefined) record.archived = data.archived;
  if (data.pinned !== undefined) record.pinned = data.pinned;
  try {
    await atomicWrite(fileFor(id), JSON.stringify(record, null, 2));
  } catch (err) {
    console.error("[saveChat] atomicWrite failed:", err instanceof Error ? err.message : err);
    throw err;
  }
  return metaFrom(record);
}

export const fileChatStore: ChatStore = {
  list: listChats,
  get: getChat,
  create: createChat,
  save: saveChat,
  delete: deleteChat,
};

/**
 * Soft-delete: moves chat JSON to .trash/ instead of unlinking.
 * Files in .trash/ can be manually restored if needed.
 */
export async function deleteChat(id: string): Promise<boolean> {
  try {
    const src = fileFor(id);
    const filename = path.basename(src);
    const dest = path.join(TRASH_DIR, `${filename}.${Date.now()}`);
    await fs.rename(src, dest);
    return true;
  } catch {
    return false;
  }
}