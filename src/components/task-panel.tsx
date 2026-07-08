"use client";

import { useState, useEffect, useCallback } from "react";
import { LoaderIcon, CheckCircle2Icon, CircleAlertIcon, Trash2Icon, ClockIcon, ListTodoIcon } from "lucide-react";
import { cn } from "@/lib/utils";

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

export function TaskPanel({ chatId }: { chatId: string }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [open, setOpen] = useState(false);

  const fetchTasks = useCallback(async () => {
    try {
      const res = await fetch(`/api/tasks?chatId=${encodeURIComponent(chatId)}`);
      const data = await res.json();
      setTasks(data.tasks ?? []);
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

  const activeTasks = tasks.filter((t) => t.status === "pending" || t.status === "running");
  const doneTasks = tasks.filter((t) => t.status === "done" || t.status === "error");

  if (tasks.length === 0) return null;

  return (
    <div className="border-t">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground"
      >
        <ListTodoIcon className="size-3.5" />
        <span className="flex-1 text-left">Задачи</span>
        {activeTasks.length > 0 && (
          <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">{activeTasks.length}</span>
        )}
      </button>
      {open && (
        <div className="space-y-1 px-2 pb-2">
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
                <button type="button" onClick={() => handleDelete(task.id)}
                  className="hidden shrink-0 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground group-hover:block"
                  aria-label="Удалить">
                  <Trash2Icon className="size-3" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
