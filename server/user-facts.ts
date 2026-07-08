import { promises as fs } from "node:fs";
import path from "node:path";

export type FactCategory =
  | "personal"
  | "work"
  | "preference"
  | "hobby"
  | "goal"
  | "other";

export type UserFact = {
  id: string;
  text: string;
  category: FactCategory;
  createdAt: number;
};

export type FactInput = {
  text: string;
  category: FactCategory;
};

export type FactUpdate = {
  text?: string;
  category?: FactCategory;
};

export interface FactStore {
  list(): Promise<UserFact[]>;
  add(input: FactInput): Promise<UserFact>;
  update(id: string, patch: FactUpdate): Promise<UserFact | null>;
  delete(id: string): Promise<boolean>;
  clear(): Promise<void>;
}

// ── File-based implementation (для локальной разработки: vite dev) ──────────

const DATA_DIR = path.join(process.cwd(), ".user-data");
const FACTS_FILE = path.join(DATA_DIR, "facts.json");

type FactsFile = { facts: UserFact[] };

async function ensureDir(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

async function readFile(): Promise<FactsFile> {
  try {
    const raw = await fs.readFile(FACTS_FILE, "utf8");
    return JSON.parse(raw) as FactsFile;
  } catch {
    return { facts: [] };
  }
}

async function writeFile(data: FactsFile): Promise<void> {
  await ensureDir();
  await fs.writeFile(FACTS_FILE, JSON.stringify(data, null, 2));
}

function genFactId(): string {
  return `fact_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

export const fileFactStore: FactStore = {
  async list(): Promise<UserFact[]> {
    const data = await readFile();
    return data.facts.sort((a, b) => b.createdAt - a.createdAt);
  },

  async add(input: FactInput): Promise<UserFact> {
    const data = await readFile();
    const fact: UserFact = {
      id: genFactId(),
      text: input.text,
      category: input.category,
      createdAt: Date.now(),
    };
    data.facts.push(fact);
    await writeFile(data);
    return fact;
  },

  async update(id: string, patch: FactUpdate): Promise<UserFact | null> {
    const data = await readFile();
    const fact = data.facts.find((f) => f.id === id);
    if (!fact) return null;
    if (patch.text !== undefined) fact.text = patch.text;
    if (patch.category !== undefined) fact.category = patch.category;
    await writeFile(data);
    return fact;
  },

  async delete(id: string): Promise<boolean> {
    const data = await readFile();
    const before = data.facts.length;
    data.facts = data.facts.filter((f) => f.id !== id);
    if (data.facts.length === before) return false;
    await writeFile(data);
    return true;
  },

  async clear(): Promise<void> {
    await writeFile({ facts: [] });
  },
};

// ── Store selector ──────────────────────────────────────────────────────────

let cachedStore: FactStore | null = null;

/**
 * Возвращает подходящее хранилище фактов в зависимости от среды:
 *  - Netlify Functions / netlify dev → Blobs (USE_BLOBS=true)
 *  - Plain vite dev → файл (.user-data/facts.json)
 */
export async function getFactStore(): Promise<FactStore> {
  if (cachedStore) return cachedStore;

  if (process.env.USE_BLOBS === "true") {
    const { blobsFactStore } = await import("./blobs-user-facts.ts");
    cachedStore = blobsFactStore;
  } else {
    cachedStore = fileFactStore;
  }
  return cachedStore;
}
