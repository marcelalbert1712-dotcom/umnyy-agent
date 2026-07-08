import { promises as fs } from "node:fs";
import path from "node:path";

type SessionMemory = {
  chatId: string;
  title: string;
  summary: string;
  updatedAt: number;
};

const DATA_DIR = path.join(process.cwd(), ".user-data");
const MEMORY_FILE = path.join(DATA_DIR, "session-memories.json");

type MemoryFile = { memories: SessionMemory[] };

async function ensureDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

async function readFile(): Promise<MemoryFile> {
  try {
    const raw = await fs.readFile(MEMORY_FILE, "utf8");
    return JSON.parse(raw) as MemoryFile;
  } catch {
    return { memories: [] };
  }
}

async function writeFile(data: MemoryFile) {
  await ensureDir();
  await fs.writeFile(MEMORY_FILE, JSON.stringify(data, null, 2));
}

export async function saveSessionMemory(
  chatId: string,
  title: string,
  summary: string,
): Promise<void> {
  const data = await readFile();
  const idx = data.memories.findIndex((m) => m.chatId === chatId);
  const entry: SessionMemory = { chatId, title, summary, updatedAt: Date.now() };
  if (idx >= 0) data.memories[idx] = entry;
  else data.memories.push(entry);
  // Keep only the last 20 sessions
  data.memories.sort((a, b) => b.updatedAt - a.updatedAt);
  if (data.memories.length > 20) data.memories = data.memories.slice(0, 20);
  await writeFile(data);
}

export async function getRecentMemories(limit = 5): Promise<SessionMemory[]> {
  const data = await readFile();
  return data.memories.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit);
}
