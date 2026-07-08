"use client";

import {
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import { BrainIcon, ChevronDownIcon } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

export type ReasoningProps = ComponentProps<typeof Collapsible> & {
  isStreaming?: boolean;
  defaultOpen?: boolean;
  messageId?: string;
};

export const Reasoning = ({
  className,
  isStreaming = false,
  defaultOpen,
  messageId,
  children,
  ...props
}: ReasoningProps) => {
  const storageKey = messageId ? `reasoning-${messageId}` : null;
  const [open, setOpen] = useState(() => {
    if (defaultOpen ?? isStreaming) return true;
    if (storageKey) {
      try { return JSON.parse(localStorage.getItem(storageKey) ?? "false"); } catch { /* ignore */ }
    }
    return false;
  });

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (storageKey) localStorage.setItem(storageKey, JSON.stringify(next));
  };

  return (
    <Collapsible
      open={open}
      onOpenChange={handleOpenChange}
      className={cn("group not-prose mb-4 w-full", className)}
      {...props}
    >
      {children}
    </Collapsible>
  );
};

export type ReasoningTriggerProps = {
  isStreaming?: boolean;
  className?: string;
};

export const ReasoningTrigger = ({
  isStreaming = false,
  className,
}: ReasoningTriggerProps) => (
  <CollapsibleTrigger
    className={cn(
      "flex w-full items-center gap-2 text-muted-foreground text-xs transition-colors hover:text-foreground",
      className,
    )}
  >
    <BrainIcon className="size-4" />
    <span className={cn(isStreaming && "animate-pulse")}>
      {isStreaming ? "Размышляю…" : "Размышления"}
    </span>
    <ChevronDownIcon
      className={cn(
        "size-4 transition-transform",
        "group-data-[state=open]:rotate-180",
      )}
    />
  </CollapsibleTrigger>
);

export type ReasoningContentProps = ComponentProps<"div"> & {
  children: ReactNode;
};

export const ReasoningContent = ({
  className,
  children,
  ...props
}: ReasoningContentProps) => (
  <CollapsibleContent
    className={cn(
      "data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-top-2 data-[state=open]:slide-in-from-top-2 mt-2 text-muted-foreground text-sm outline-none data-[state=closed]:animate-out data-[state=open]:animate-in",
      className,
    )}
    {...props}
  >
    <div className="whitespace-pre-wrap rounded-md border border-border/60 bg-muted/40 p-3 leading-relaxed">
      {children}
    </div>
  </CollapsibleContent>
);
