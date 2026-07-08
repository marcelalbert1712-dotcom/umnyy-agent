import { getStore } from "@netlify/blobs";
import {
  type FactInput,
  type FactStore,
  type FactUpdate,
  type UserFact,
} from "./user-facts.ts";

const STORE_NAME = "user-facts";
const FACTS_KEY = "facts";

type FactsData = { facts: UserFact[] };

function genFactId(): string {
  return `fact_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

async function readFacts(): Promise<FactsData> {
  const store = getStore(STORE_NAME, { consistency: "strong" });
  const data = await store.get(FACTS_KEY, { type: "json" });
  if (!data || typeof data !== "object" || !Array.isArray(data.facts)) {
    return { facts: [] };
  }
  return data as FactsData;
}

async function writeFacts(data: FactsData): Promise<void> {
  const store = getStore(STORE_NAME, { consistency: "strong" });
  await store.setJSON(FACTS_KEY, data);
}

export const blobsFactStore: FactStore = {
  async list(): Promise<UserFact[]> {
    const data = await readFacts();
    return data.facts.sort((a, b) => b.createdAt - a.createdAt);
  },

  async add(input: FactInput): Promise<UserFact> {
    const data = await readFacts();
    const fact: UserFact = {
      id: genFactId(),
      text: input.text,
      category: input.category,
      createdAt: Date.now(),
    };
    data.facts.push(fact);
    await writeFacts(data);
    return fact;
  },

  async update(id: string, patch: FactUpdate): Promise<UserFact | null> {
    const data = await readFacts();
    const fact = data.facts.find((f) => f.id === id);
    if (!fact) return null;
    if (patch.text !== undefined) fact.text = patch.text;
    if (patch.category !== undefined) fact.category = patch.category;
    await writeFacts(data);
    return fact;
  },

  async delete(id: string): Promise<boolean> {
    const data = await readFacts();
    const before = data.facts.length;
    data.facts = data.facts.filter((f) => f.id !== id);
    if (data.facts.length === before) return false;
    await writeFacts(data);
    return true;
  },

  async clear(): Promise<void> {
    await writeFacts({ facts: [] });
  },
};
