"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  LoaderIcon,
  CheckCircle2Icon,
  CircleAlertIcon,
  Trash2Icon,
  ClockIcon,
  ListTodoIcon,
  EyeIcon,
  PlusIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

type TaskStatus = "pending" | "running" | "done" | "error";

type Task = {
  id: string;
  chatId: string;
  goal: string;
  status: TaskStatus;
  result?: string;
  error?: string;
  createdAt: number;
};

const STATUS_ICONS: Record<TaskStatus, typeof LoaderIcon> = {
  pending: ClockIcon,
  running: LoaderIcon,
  done: CheckCircle2Icon,
  error: CircleAlertIcon,
};

const STATUS_COLORS: Record<TaskStatus, string> = {
  pending: "text-muted-foreground",
  running: "text-primary",
  done: "text-green-500",
  error: "text-destructive",
};

export function TaskPanel({
  chatId,
  input,
  onInsertResult,
}: {
  chatId: string;
  input?: string;
  onInsertResult?: (text: string) => void;
}) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [open, setOpen] = useState(false);
  const prevDoneCount = useRef(0);
  const [newDoneFlash, setNewDoneFlash] = useState(false);

  const fetchTasks = useCallback(async () => {
    try {
      const res = await fetch(`/api/tasks?chatId=${encodeURIComponent(chatId)}`);
      const data = await res.json();
      const t = data.tasks ?? [];
      setTasks((prev) => {
        const newDone = t.filter((x: Task) => x.status === "done" || x.status === "error").length;
        const oldDone = prev.filter((x) => x.status === "done" || x.status === "error").length;
        if (newDone > oldDone) {
          setNewDoneFlash(true);
          setTimeout(() => setNewDoneFlash(false), 3000);
        }
        return t;
      });
    } catch { /* ignore */ }
  }, [chatId]);

  useEffect(() => {
    fetchTasks();
    const interval = setInterval(fetchTasks, 5000);
    return () => clearInterval(interval);
  }, [fetchTasks]);

  const handleDelete = async (id: string) => {
    try {
      await fetch(`/api/tasks/${encodeURIComponent(id)}`, { method: "DELETE" });
      setTasks((prev) => prev.filter((t) => t.id !== id));
    } catch { /* ignore */ }
  };

  const handleCreateBackground = async () => {
    if (!input?.trim()) return;
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId, goal: input.trim() }),
      });
      if (res.ok) setOpen(true);
    } catch { /* ignore */ }
  };

  const activeTasks = tasks.filter((t) => t.status === "pending" || t.status === "running");
  const doneTasks = tasks.filter((t) => t.status === "done" || t.status === "error");

  if (tasks.length === 0 && !input) return null;

  return (
    <div className={cn("border-t", newDoneFlash && "animate-pulse")}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground"
      >
        <ListTodoIcon className="size-3.5" />
        <span className="flex-1 text-left">Задачи</span>
        {activeTasks.length > 0 && (
          <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">
            {activeTasks.length}
          </span>
        )}
        {newDoneFlash && doneTasks.length > 0 && (
          <span className="rounded-full bg-green-500/10 px-1.5 py-0.5 text-[10px] text-green-600">
            +{doneTasks.length - prevDoneCount.current}
          </span>
        )}
      </button>
      {open && (
        <div className="space-y-1 px-2 pb-2">
          {/* Background task creation */}
          {input && (
            <button
              type="button"
              onClick={handleCreateBackground}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <PlusIcon className="size-3" />
              Запустить в фоне
            </button>
          )}

          {activeTasks.map((task) => {
            const Icon = STATUS_ICONS[task.status];
            return (
              <div key={task.id} className="group flex items-start gap-2 rounded-lg px-2 py-1.5 text-xs">
                <Icon className={cn("mt-0.5 size-3 shrink-0", STATUS_COLORS[task.status], task.status === "running" && "animate-spin")} />
                <span className="flex-1 text-muted-foreground line-clamp-2">{task.goal}</span>
                <button type="button" onClick={() => handleDelete(task.id)}
                  className="hidden shrink-0 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground group-hover:block"
                  aria-label="Удалить">
                  <Trash2Icon className="size-3" />
                </button>
              </div>
            );
          })}
          {doneTasks.length > 0 && !activeTasks.length && (
            <div className="px-2 py-1 text-[10px] text-muted-foreground/60">Завершённые</div>
          )}
          {doneTasks.map((task) => {
            const Icon = STATUS_ICONS[task.status];
            return (
              <div key={task.id} className="group flex items-start gap-2 rounded-lg px-2 py-1.5 text-xs">
                <Icon className={cn("mt-0.5 size-3 shrink-0", STATUS_COLORS[task.status])} />
                <div className="flex-1 min-w-0">
                  <div className="truncate text-muted-foreground">{task.goal}</div>
                  {task.result && <div className="truncate text-[10px] text-muted-foreground/60">{task.result}</div>}
                  {task.error && <div className="truncate text-[10px] text-destructive/70">{task.error}</div>}
                </div>
                <div className="flex items-center gap-0.5">
                  {task.result && onInsertResult && (
                    <button
                      type="button"
                      onClick={() => onInsertResult(task.result!)}
                      className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                      aria-label="Показать результат"
                      title="Показать результат в чате"
                    >
                      <EyeIcon className="size-3" />
                    </button>
                  )}
                  <button type="button" onClick={() => handleDelete(task.id)}
                    className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                    aria-label="Удалить">
                    <Trash2Icon className="size-3" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
