import { promises as fs } from "node:fs";
import path from "node:path";

export type Skill = {
  id: string;
  name: string;
  description: string;
  prompt: string;
  enabled: boolean;
  createdAt: number;
};

export type SkillInput = {
  name: string;
  description: string;
  prompt: string;
};

export type SkillUpdate = {
  name?: string;
  description?: string;
  prompt?: string;
  enabled?: boolean;
};

export interface SkillStore {
  list(): Promise<Skill[]>;
  add(input: SkillInput): Promise<Skill>;
  update(id: string, patch: SkillUpdate): Promise<Skill | null>;
  delete(id: string): Promise<boolean>;
}

const DATA_DIR = path.join(process.cwd(), ".user-data");
const SKILLS_FILE = path.join(DATA_DIR, "skills.json");

type SkillsFile = { skills: Skill[] };

async function ensureDir(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

async function readFile(): Promise<SkillsFile> {
  try {
    const raw = await fs.readFile(SKILLS_FILE, "utf8");
    return JSON.parse(raw) as SkillsFile;
  } catch {
    return { skills: [] };
  }
}

async function writeFile(data: SkillsFile): Promise<void> {
  await ensureDir();
  await fs.writeFile(SKILLS_FILE, JSON.stringify(data, null, 2));
}

function genId(): string {
  return `skill_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

export const fileSkillStore: SkillStore = {
  async list(): Promise<Skill[]> {
    const data = await readFile();
    return data.skills.sort((a, b) => b.createdAt - a.createdAt);
  },

  async add(input: SkillInput): Promise<Skill> {
    const data = await readFile();
    const skill: Skill = {
      id: genId(),
      name: input.name,
      description: input.description,
      prompt: input.prompt,
      enabled: true,
      createdAt: Date.now(),
    };
    data.skills.push(skill);
    await writeFile(data);
    return skill;
  },

  async update(id: string, patch: SkillUpdate): Promise<Skill | null> {
    const data = await readFile();
    const skill = data.skills.find((s) => s.id === id);
    if (!skill) return null;
    if (patch.name !== undefined) skill.name = patch.name;
    if (patch.description !== undefined) skill.description = patch.description;
    if (patch.prompt !== undefined) skill.prompt = patch.prompt;
    if (patch.enabled !== undefined) skill.enabled = patch.enabled;
    await writeFile(data);
    return skill;
  },

  async delete(id: string): Promise<boolean> {
    const data = await readFile();
    const before = data.skills.length;
    data.skills = data.skills.filter((s) => s.id !== id);
    if (data.skills.length === before) return false;
    await writeFile(data);
    return true;
  },
};

export function getActiveSkillsPrompt(skills: Skill[]): string {
  const active = skills.filter((s) => s.enabled);
  if (active.length === 0) return "";
  const lines = active.map((s) => `[Навык: ${s.name}] ${s.prompt}`);
  return `\n\nАктивные навыки:\n${lines.join("\n")}`;
}
