import { getStore } from "@netlify/blobs";
import type { UIMessage } from "ai";
import {
  DEFAULT_TITLE,
  type ChatMeta,
  type ChatRecord,
  type ChatStore,
  deriveTitle,
  genChatId,
  metaFrom,
} from "./chat-store.ts";

const STORE_NAME = "chats";
const INDEX_KEY = "__index";

type IndexEntry = ChatMeta;

async function getIndex(): Promise<IndexEntry[]> {
  const store = getStore(STORE_NAME, { consistency: "strong" });
  const raw = await store.get(INDEX_KEY, { type: "json" });
  if (!Array.isArray(raw)) return [];
  return raw as IndexEntry[];
}

async function setIndex(entries: IndexEntry[]): Promise<void> {
  const store = getStore(STORE_NAME, { consistency: "strong" });
  const sorted = [...entries].sort((a, b) => b.updatedAt - a.updatedAt);
  await store.setJSON(INDEX_KEY, sorted);
}

async function upsertIndex(meta: ChatMeta): Promise<void> {
  const entries = await getIndex();
  const idx = entries.findIndex((e) => e.id === meta.id);
  if (idx >= 0) entries[idx] = meta;
  else entries.push(meta);
  await setIndex(entries);
}

async function removeFromIndex(id: string): Promise<void> {
  const entries = await getIndex();
  await setIndex(entries.filter((e) => e.id !== id));
}

export const blobsChatStore: ChatStore = {
  async list(): Promise<ChatMeta[]> {
    return await getIndex();
  },

  async get(id: string): Promise<ChatRecord | null> {
    const store = getStore(STORE_NAME, { consistency: "strong" });
    const record = await store.get(id, { type: "json" });
    if (!record || typeof record !== "object") return null;
    return record as ChatRecord;
  },

  async create(title = DEFAULT_TITLE): Promise<ChatMeta> {
    const id = genChatId();
    const now = Date.now();
    const record: ChatRecord = {
      id,
      title,
      createdAt: now,
      updatedAt: now,
      messages: [],
    };
    const store = getStore(STORE_NAME, { consistency: "strong" });
    await store.setJSON(id, record);
    await upsertIndex(metaFrom(record));
    return metaFrom(record);
  },

  async save(
    id: string,
    data: { title?: string; messages: UIMessage[] },
  ): Promise<ChatMeta | null> {
    const existing = await this.get(id);
    if (!existing) return null;
    const title = data.title ?? deriveTitle(data.messages, existing.title);
    const now = Date.now();
    const record: ChatRecord = {
      ...existing,
      title,
      messages: data.messages,
      updatedAt: now,
    };
    const store = getStore(STORE_NAME, { consistency: "strong" });
    await store.setJSON(id, record);
    await upsertIndex(metaFrom(record));
    return metaFrom(record);
  },

  async delete(id: string): Promise<boolean> {
    const store = getStore(STORE_NAME, { consistency: "strong" });
    const existing = await store.get(id);
    if (!existing) return false;
    await store.delete(id);
    await removeFromIndex(id);
    return true;
  },
};
