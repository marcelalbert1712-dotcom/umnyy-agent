export type Action = {
  id: string;
  type: string;
  detail: string;
  ts: number;
  undo?: () => void;
};

const STORAGE_KEY = "cabin-action-log";

export function getLog(): Action[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
  } catch {
    return [];
  }
}

export function pushAction(action: Omit<Action, "id" | "ts">): void {
  const log = getLog();
  log.unshift({ ...action, id: crypto.randomUUID(), ts: Date.now() });
  localStorage.setItem(STORAGE_KEY, JSON.stringify(log.slice(0, 50)));
}

export function clearLog(): void {
  localStorage.removeItem(STORAGE_KEY);
}
