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

async function ensureDir(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

function fileFor(id: string): string {
  return path.join(DATA_DIR, `${sanitizeId(id)}.json`);
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
  await fs.writeFile(fileFor(id), JSON.stringify(record, null, 2));
  return metaFrom(record);
}

export async function saveChat(
  id: string,
  data: { title?: string; messages: UIMessage[]; folder?: string | null },
): Promise<ChatMeta | null> {
  const existing = await getChat(id);
  if (!existing) return null;
  const title = data.title ?? deriveTitle(data.messages, existing.title);
  const now = Date.now();
  const record: ChatRecord = {
    ...existing,
    title,
    messages: data.messages,
    updatedAt: now,
  };
  if (data.folder !== undefined) record.folder = data.folder ?? undefined;
  await fs.writeFile(fileFor(id), JSON.stringify(record, null, 2));
  return metaFrom(record);
}

export const fileChatStore: ChatStore = {
  list: listChats,
  get: getChat,
  create: createChat,
  save: saveChat,
  delete: deleteChat,
};

export async function deleteChat(id: string): Promise<boolean> {
  try {
    await fs.unlink(fileFor(id));
    return true;
  } catch {
    return false;
  }
}
