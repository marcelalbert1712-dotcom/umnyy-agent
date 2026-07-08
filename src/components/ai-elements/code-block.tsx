"use client";

import { useState } from "react";
import { CheckIcon, CopyIcon, PlayIcon, LoaderIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const RUNNABLE = new Set(["javascript", "js", "python", "py", "bash", "sh", "html"]);

export type CodeBlockProps = {
  code: string;
  language?: string;
  className?: string;
  onRunOutput?: (output: string) => void;
};

export function CodeBlock({ code, language = "text", className, onRunOutput }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const [running, setRunning] = useState(false);
  const [confirmRun, setConfirmRun] = useState(false);
  const [output, setOutput] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isRunnable = RUNNABLE.has(language);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard unavailable */ }
  };

  const handleRun = async () => {
    setRunning(true);
    setOutput(null);
    setError(null);
    try {
      if (language === "python" || language === "py") {
        const res = await fetch("/api/run-code", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ language: "python", code }),
        });
        const data = await res.json();
        const out = (data.stdout || data.stderr || "").trim();
        if (out) { setOutput(out); onRunOutput?.(out); }
        else { setOutput("(пустой вывод)"); }
        if (data.stderr) setError(data.stderr);
      } else if (language === "bash" || language === "sh") {
        const res = await fetch("/api/run-code", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ language: "bash", code }),
        });
        const data = await res.json();
        const out = (data.stdout || data.stderr || "").trim();
        if (out) { setOutput(out); onRunOutput?.(out); }
        else { setOutput("(пустой вывод)"); }
        if (data.stderr) setError(data.stderr);
      } else if (language === "html") {
        const blob = new Blob([code], { type: "text/html" });
        const url = URL.createObjectURL(blob);
        window.open(url, "_blank");
        setOutput("Открыто в новой вкладке");
      } else {
        const res = await fetch("/api/run-code", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ language, code }),
        });
        const data = await res.json();
        const out = (data.stdout || data.stderr || "").trim();
        if (out) { setOutput(out); onRunOutput?.(out); }
        else { setOutput("(пустой вывод)"); }
        if (data.stderr) setError(data.stderr);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className={cn("group/code relative w-full overflow-hidden rounded-md bg-muted/50 text-xs", className)}>
      <div className="flex items-center justify-between border-b border-border/60 px-3 py-1.5">
        <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">{language}</span>
        <div className="flex items-center gap-1">
          {isRunnable && !confirmRun && (
            <button type="button" onClick={() => setConfirmRun(true)} disabled={running}
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-muted-foreground transition-colors hover:bg-background/60 hover:text-foreground disabled:opacity-50"
              aria-label="Запустить" title="Запустить код">
              {running ? <LoaderIcon className="size-3.5 animate-spin" /> : <PlayIcon className="size-3.5" />}
              <span className="text-[10px]">Run</span>
            </button>
          )}
          {confirmRun && (
            <span className="flex items-center gap-1 text-[10px]">
              <span className="text-muted-foreground">Запустить?</span>
              <button type="button" onClick={() => { setConfirmRun(false); handleRun(); }}
                className="rounded bg-destructive/10 px-1.5 py-0.5 text-destructive hover:bg-destructive/20">
                Да
              </button>
              <button type="button" onClick={() => setConfirmRun(false)}
                className="rounded px-1.5 py-0.5 text-muted-foreground hover:bg-background/60">
                Нет
              </button>
            </span>
          )}
          <button type="button" onClick={handleCopy}
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-muted-foreground transition-colors hover:bg-background/60 hover:text-foreground"
            aria-label="Скопировать">
            {copied ? <CheckIcon className="size-3.5 text-green-500" /> : <CopyIcon className="size-3.5" />}
          </button>
        </div>
      </div>
      <pre className="overflow-x-auto p-3">
        <code className="font-mono leading-relaxed">{code}</code>
      </pre>
      {output && (
        <div className="border-t border-border/60 bg-black/5 p-3 dark:bg-white/5">
          <div className="mb-1 text-[10px] font-semibold text-muted-foreground">Вывод:</div>
          <pre className="whitespace-pre-wrap font-mono text-muted-foreground">{output}</pre>
        </div>
      )}
      {error && (
        <div className="border-t border-destructive/30 bg-destructive/5 p-3">
          <div className="mb-1 text-[10px] font-semibold text-destructive">Ошибка:</div>
          <pre className="whitespace-pre-wrap font-mono text-destructive/80">{error}</pre>
        </div>
      )}
    </div>
  );
}
