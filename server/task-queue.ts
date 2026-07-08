import { promises as fs } from "node:fs";
import path from "node:path";

export type TaskStatus = "pending" | "running" | "done" | "error";

export type Task = {
  id: string;
  chatId: string;
  goal: string;
  status: TaskStatus;
  result?: string;
  error?: string;
  createdAt: number;
  updatedAt: number;
};

const DATA_DIR = path.join(process.cwd(), ".user-data");
const TASKS_FILE = path.join(DATA_DIR, "tasks.json");

let tasks: Task[] = [];

async function load() {
  try {
    const raw = await fs.readFile(TASKS_FILE, "utf8");
    tasks = JSON.parse(raw) as Task[];
  } catch {
    tasks = [];
  }
}

async function save() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(TASKS_FILE, JSON.stringify(tasks, null, 2));
}

// Init
load();

export async function createTask(chatId: string, goal: string): Promise<Task> {
  const task: Task = {
    id: `task_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    chatId,
    goal,
    status: "pending",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  tasks.push(task);
  await save();
  return task;
}

export async function getTask(id: string): Promise<Task | undefined> {
  return tasks.find((t) => t.id === id);
}

export async function listTasks(chatId?: string): Promise<Task[]> {
  let list = tasks;
  if (chatId) list = list.filter((t) => t.chatId === chatId);
  return [...list].sort((a, b) => b.createdAt - a.createdAt);
}

export async function updateTask(id: string, update: Partial<Omit<Task, "id" | "chatId" | "createdAt">>): Promise<Task | undefined> {
  const task = tasks.find((t) => t.id === id);
  if (!task) return undefined;
  Object.assign(task, update, { updatedAt: Date.now() });
  await save();
  return task;
}

export async function deleteTask(id: string): Promise<boolean> {
  const idx = tasks.findIndex((t) => t.id === id);
  if (idx === -1) return false;
  tasks.splice(idx, 1);
  await save();
  return true;
}

export async function runTaskInBackground(taskId: string, executor: () => Promise<string>): Promise<void> {
  const task = tasks.find((t) => t.id === taskId);
  if (!task) return;
  task.status = "running";
  await save();
  try {
    const result = await executor();
    task.status = "done";
    task.result = result;
  } catch (err: any) {
    task.status = "error";
    task.error = err.message ?? String(err);
  }
  task.updatedAt = Date.now();
  await save();
}
