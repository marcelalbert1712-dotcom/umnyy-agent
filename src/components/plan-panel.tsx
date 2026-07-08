"use client";

import { useState, useMemo } from "react";
import { ListChecksIcon, LoaderIcon } from "lucide-react";
import type { UIMessage } from "ai";

type PlanStep = {
  text: string;
  done: boolean;
  active: boolean;
};

export function PlanPanel({ messages }: { messages: UIMessage[] }) {
  const [open, setOpen] = useState(true);

  const steps = useMemo(() => {
    const result: PlanStep[] = [];

    // Find the first assistant message with a reasoning part
    for (const msg of messages) {
      if (msg.role !== "assistant") continue;

      const reasoning = msg.parts.find((p) => p.type === "reasoning");
      if (!reasoning) continue;

      const text = (reasoning as any).text ?? "";
      // Extract numbered steps like "1. text" or "- text"
      const lines = text.split("\n");
      let stepDetected = false;
      for (const line of lines) {
        const trimmed = line.trim();
        // Match: "1. text" or "1) text" or "- text" or "* text"
        const match = trimmed.match(/^(?:\d+[\.\)]|[\-\*])\s+(.+)/);
        if (match) {
          result.push({ text: match[1], done: false, active: false });
          stepDetected = true;
        }
      }
      if (stepDetected) break;
    }

    // If no structured steps found, try to extract from reasoning as paragraphs
    if (result.length === 0) {
      const firstAssistant = messages.find((m) => m.role === "assistant");
      if (firstAssistant) {
        const reasoning = firstAssistant.parts.find((p) => p.type === "reasoning");
        if (reasoning) {
          const text = ((reasoning as any).text ?? "").trim();
          if (text) {
            result.push({ text: "Задача поставлена, начинаю выполнение", done: false, active: false });
          }
        }
      }
    }

    // Determine which steps are done based on tool calls
    const toolCallsSeen = new Set<string>();
    for (const msg of messages) {
      if (msg.role !== "assistant") continue;
      for (const part of msg.parts) {
        if (part.type === "tool-call" || (part.type as string).startsWith("tool-")) {
          const tp = part as any;
          const toolName = tp.toolName ?? "";
          if (toolName) toolCallsSeen.add(toolName);
        }
      }
    }

    // Mark steps as done/active
    const toolNames = Array.from(toolCallsSeen);
    for (let i = 0; i < result.length; i++) {
      const idx = toolNames.length > 0 ? Math.min(i, toolNames.length - 1) : -1;
      if (i < toolNames.length) {
        result[i].done = true;
      }
      if (i === toolNames.length) {
        result[i].active = true;
      }
    }

    return result;
  }, [messages]);

  if (steps.length === 0) return null;

  return (
    <div className="border-t">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground"
      >
        <ListChecksIcon className="size-3.5" />
        <span className="flex-1 text-left">План</span>
        <span className="text-[10px] text-muted-foreground/50">
          {steps.filter((s) => s.done).length}/{steps.length}
        </span>
      </button>
      {open && (
        <div className="space-y-1 px-3 pb-2">
          {steps.map((step, i) => (
            <div
              key={i}
              className={`flex items-start gap-2 rounded-md px-2 py-1 text-[11px] ${
                step.active
                  ? "bg-primary/10 text-primary font-medium"
                  : step.done
                    ? "text-muted-foreground/60"
                    : "text-muted-foreground"
              }`}
            >
              {step.active ? (
                <LoaderIcon className="mt-0.5 size-3 shrink-0 animate-spin" />
              ) : step.done ? (
                <span className="mt-0.5 size-3 shrink-0 rounded-full bg-green-500/30 text-center text-[8px] leading-3 text-green-600">
                  ✓
                </span>
              ) : (
                <span className="mt-0.5 size-3 shrink-0 rounded-full border border-muted-foreground/30" />
              )}
              <span className="leading-4">{step.text}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
