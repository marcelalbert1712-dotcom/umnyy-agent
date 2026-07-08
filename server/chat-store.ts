import type { UIMessage } from "ai";

export type ChatMeta = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  pinned?: boolean;
  folder?: string;
};

export type ChatRecord = ChatMeta & { messages: UIMessage[] };

export const DEFAULT_TITLE = "Новый чат";

export interface ChatStore {
  list(): Promise<ChatMeta[]>;
  get(id: string): Promise<ChatRecord | null>;
  create(title?: string): Promise<ChatMeta>;
  save(
    id: string,
    data: { title?: string; messages: UIMessage[]; folder?: string | null },
  ): Promise<ChatMeta | null>;
  delete(id: string): Promise<boolean>;
}

export function genChatId(): string {
  return `chat_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function metaFrom(record: ChatRecord): ChatMeta {
  return {
    id: record.id,
    title: record.title,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    pinned: record.pinned,
  };
}

export function deriveTitle(
  messages: UIMessage[],
  current: string,
): string {
  if (current && current !== DEFAULT_TITLE) return current;
  for (const m of messages) {
    if (m.role !== "user") continue;
    for (const p of m.parts) {
      if (p.type === "text" && p.text.trim()) {
        const t = p.text.trim().replace(/\s+/g, " ");
        return t.length > 42 ? `${t.slice(0, 42)}…` : t;
      }
    }
  }
  return current || DEFAULT_TITLE;
}

export function sanitizeId(id: string): string {
  const safe = id.replace(/[^a-zA-Z0-9_-]/g, "");
  if (!safe) throw new Error("Invalid chat id");
  return safe;
}
