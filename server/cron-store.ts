import { promises as fs } from "node:fs";
import path from "node:path";

export type CronTask = {
  id: string;
  name: string;
  cron: string;
  prompt: string;
  chatId: string;
  enabled: boolean;
  lastRun: number | null;
  lastResult: string | null;
  createdAt: number;
};

type CronFile = { tasks: CronTask[] };

const DATA_DIR = path.join(process.cwd(), ".user-data");
const FILE = path.join(DATA_DIR, "cron-tasks.json");

async function ensureDir(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

async function read(): Promise<CronFile> {
  try {
    const raw = await fs.readFile(FILE, "utf8");
    return JSON.parse(raw) as CronFile;
  } catch {
    return { tasks: [] };
  }
}

async function write(data: CronFile): Promise<void> {
  await ensureDir();
  await fs.writeFile(FILE, JSON.stringify(data, null, 2), "utf8");
}

export async function listTasks(): Promise<CronTask[]> {
  const f = await read();
  return f.tasks;
}

export async function addTask(data: { name: string; cron: string; prompt: string; chatId: string }): Promise<CronTask> {
  const f = await read();
  const task: CronTask = {
    id: `cron_${Date.now().toString(36)}`,
    name: data.name,
    cron: data.cron,
    prompt: data.prompt,
    chatId: data.chatId,
    enabled: true,
    lastRun: null,
    lastResult: null,
    createdAt: Date.now(),
  };
  f.tasks.push(task);
  await write(f);
  return task;
}

export async function removeTask(id: string): Promise<boolean> {
  const f = await read();
  const before = f.tasks.length;
  f.tasks = f.tasks.filter((x) => x.id !== id);
  await write(f);
  return f.tasks.length < before;
}

export async function toggleTask(id: string): Promise<boolean> {
  const f = await read();
  const t = f.tasks.find((x) => x.id === id);
  if (!t) return false;
  t.enabled = !t.enabled;
  await write(f);
  return t.enabled;
}

export async function updateTaskResult(id: string, result: string): Promise<void> {
  const f = await read();
  const t = f.tasks.find((x) => x.id === id);
  if (!t) return;
  t.lastRun = Date.now();
  t.lastResult = result.slice(0, 500);
  await write(f);
}

// ── Scheduler ──────────────────────────────────────────────────────────

type ScheduledJob = { id: string; cron: string; task: ReturnType<typeof import("node-cron").schedule> };
const activeJobs = new Map<string, ScheduledJob>();
let initialized = false;

/**
 * Run a cron task: calls PolzaAI with the stored prompt and sends result via Telegram if configured.
 */
async function executeTask(task: CronTask): Promise<string> {
  const apiKey = process.env.POLZAAI_API_KEY;
  if (!apiKey) return "POLZAAI_API_KEY not set";

  const baseUrl = process.env.POLZAAI_BASE_URL ?? "https://api.polza.ai/v1";
  const modelRaw = process.env.POLZAAI_MODEL ?? "openai/gpt-4o-mini";
  const provider = process.env.POLZAAI_PROVIDER ?? "OpenAI";
  const model = modelRaw.includes("@") ? modelRaw : `${modelRaw}@provider=${provider}&allow_fallbacks=false`;

  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: "Ты — ассистент. Выполни задачу кратко и точно. Отвечай на русском." },
          { role: "user", content: task.prompt },
        ],
        temperature: 0.4,
        max_tokens: 1024,
      }),
    });
    if (!res.ok) return `API error: ${res.status}`;
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content ?? "(пустой ответ)";

    // Send via Telegram if configured
    try {
      const { getSettingsStore } = await import("./user-settings.ts");
      const store = await getSettingsStore();
      const settings = await store.get();
      if (settings.telegramBotToken && settings.telegramChatId) {
        await fetch(`https://api.telegram.org/bot${settings.telegramBotToken}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: settings.telegramChatId, text: `[${task.name}]\n${text.slice(0, 4000)}` }),
        });
      }
    } catch { /* ignore telegram errors */ }

    return text;
  } catch (err: any) {
    return `Error: ${err.message}`;
  }
}

export async function startCronScheduler(): Promise<void> {
  if (initialized) return;
  initialized = true;

  const cron = await import("node-cron");
  const tasks = await listTasks();

  for (const task of tasks) {
    if (!task.enabled) continue;
    if (!cron.default.validate(task.cron)) continue;
    const job = cron.default.schedule(task.cron, async () => {
      const result = await executeTask(task);
      await updateTaskResult(task.id, result);
    });
    job.start();
    activeJobs.set(task.id, { id: task.id, cron: task.cron, task: job });
  }
}

export function stopCronScheduler(): void {
  for (const [, job] of activeJobs) {
    (job.task as any).stop();
  }
  activeJobs.clear();
  initialized = false;
}

export async function refreshJob(id: string): Promise<void> {
  // Remove existing job
  const existing = activeJobs.get(id);
  if (existing) {
    (existing.task as any).stop();
    activeJobs.delete(id);
  }

  const cron = await import("node-cron");
  const tasks = await listTasks();
  const task = tasks.find((x) => x.id === id);
  if (!task || !task.enabled || !cron.default.validate(task.cron)) return;

  const job = cron.default.schedule(task.cron, async () => {
    const result = await executeTask(task);
    await updateTaskResult(task.id, result);
  });
  job.start();
  activeJobs.set(id, { id: task.id, cron: task.cron, task: job });
}

export async function scheduleNewJob(task: CronTask): Promise<void> {
  const cron = await import("node-cron");
  if (!task.enabled || !cron.default.validate(task.cron)) return;
  const job = cron.default.schedule(task.cron, async () => {
    const result = await executeTask(task);
    await updateTaskResult(task.id, result);
  });
  job.start();
  activeJobs.set(task.id, { id: task.id, cron: task.cron, task: job });
}

export async function cancelJob(id: string): Promise<void> {
  const existing = activeJobs.get(id);
  if (existing) {
    (existing.task as any).stop();
    activeJobs.delete(id);
  }
}