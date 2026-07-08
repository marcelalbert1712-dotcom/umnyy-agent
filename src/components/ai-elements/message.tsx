"use client";

import { memo, useEffect, useRef, useState, type ComponentProps } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { cn } from "@/lib/utils";
import { CodeBlock } from "./code-block";

function SvgBlock({ code }: { code: string }) {
  const sanitized = code.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "");
  return (
    <div
      className="my-3 flex justify-center rounded-lg border bg-white p-4 dark:bg-black/40"
      dangerouslySetInnerHTML={{ __html: sanitized }}
    />
  );
}

function MermaidBlock({ code }: { code: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const mermaid = (window as unknown as Record<string, unknown>).mermaid as
      | { run: (opts: { nodes: HTMLDivElement[] }) => Promise<void>; initialize: (opts: Record<string, unknown>) => void }
      | undefined;
    if (!mermaid) {
      setError("Mermaid не загружен");
      return;
    }
    el.innerHTML = `<pre class="mermaid" style="display:block;text-align:center">${code.replace(/</g, "&lt;")}</pre>`;
    mermaid.initialize({ startOnLoad: false, theme: "default" });
    mermaid.run({ nodes: [el.firstElementChild as HTMLDivElement] }).catch((e) => {
      setError(String(e));
    });
  }, [code]);

  if (error) {
    return (
      <div className="my-2 rounded border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
        Ошибка Mermaid: {error}
      </div>
    );
  }
  return (
    <div
      ref={containerRef}
      className="my-3 flex justify-center rounded-lg border bg-white p-4 dark:bg-black/40"
    />
  );
}

export type MessageProps = ComponentProps<"div"> & {
  from: "user" | "assistant" | "system";
};

export const Message = ({ className, from, ...props }: MessageProps) => (
  <div
    className={cn(
      "group flex w-full max-w-[95%] flex-col gap-2",
      from === "user" ? "is-user ml-auto justify-end" : "is-assistant",
      className,
    )}
    style={{ contentVisibility: "auto", containIntrinsicSize: "auto 80px" }}
    {...props}
  />
);

export type MessageContentProps = ComponentProps<"div">;

export const MessageContent = ({
  className,
  children,
  ...props
}: MessageContentProps) => (
  <div
    className={cn(
      "flex w-fit min-w-0 max-w-full flex-col gap-3 overflow-hidden text-sm leading-relaxed",
      "group-[.is-user]:ml-auto group-[.is-user]:rounded-2xl group-[.is-user]:bg-muted group-[.is-user]:px-4 group-[.is-user]:py-3",
      "group-[.is-assistant]:bg-gradient-to-br group-[.is-assistant]:from-indigo-50/40 group-[.is-assistant]:to-purple-50/30 group-[.is-assistant]:dark:from-indigo-950/20 group-[.is-assistant]:dark:to-purple-950/15 group-[.is-assistant]:rounded-2xl group-[.is-assistant]:px-4 group-[.is-assistant]:py-3 group-[.is-assistant]:text-foreground",
      className,
    )}
    {...props}
  >
    {children}
  </div>
);

export type MessageActionsProps = ComponentProps<"div">;

export const MessageActions = ({
  className,
  children,
  ...props
}: MessageActionsProps) => (
  <div
    className={cn("flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100", className)}
    {...props}
  >
    {children}
  </div>
);

export type MessageResponseProps = {
  content: string;
  className?: string;
  highlight?: string;
};

export const MessageResponse = memo(function MessageResponse({
  content,
  className,
  highlight,
}: MessageResponseProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !highlight?.trim()) return;
    const q = highlight.toLowerCase();
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    while (walker.nextNode()) nodes.push(walker.currentNode as Text);
    for (const node of nodes) {
      const text = node.textContent ?? "";
      const lower = text.toLowerCase();
      if (!lower.includes(q)) continue;
      const span = document.createElement("span");
      let last = 0;
      let idx = lower.indexOf(q, last);
      while (idx !== -1) {
        if (idx > last) span.append(text.slice(last, idx));
        const mark = document.createElement("mark");
        mark.className = "rounded bg-yellow-200/60 px-0.5 text-inherit dark:bg-yellow-500/30";
        mark.textContent = text.slice(idx, idx + q.length);
        span.append(mark);
        last = idx + q.length;
        idx = lower.indexOf(q, last);
      }
      if (last < text.length) span.append(text.slice(last));
      node.parentNode?.replaceChild(span, node);
    }
  }, [content, highlight]);

  return (
    <div
      ref={containerRef}
      className={cn(
        "prose prose-sm dark:prose-invert max-w-none",
        "prose-headings:font-semibold prose-a:text-primary prose-strong:font-semibold",
        "prose-pre:m-0 prose-pre:rounded-md prose-pre:border prose-code:before:hidden prose-code:after:hidden",
        className,
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          pre({ children }) {
            return <>{children}</>;
          },
          code({ className: codeClassName, children, ...props }) {
            const lang = codeClassName?.replace("language-", "") ?? "";
            if (lang === "svg") {
              return <SvgBlock code={String(children)} />;
            }
            if (lang === "mermaid") {
              return <MermaidBlock code={String(children)} />;
            }
            if (lang) {
              return <CodeBlock language={lang} code={String(children)} />;
            }
            return <code className={codeClassName} {...props}>{children}</code>;
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
});
