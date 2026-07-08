"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import type { UIMessage } from "ai";

type ChatStatus = "ready" | "submitted" | "streaming" | "error";

type UseSimpleChatOptions = {
  api: string;
  id: string;
  initialMessages?: UIMessage[];
  onError?: (err: Error) => void;
  onFinish?: (msg: UIMessage) => void;
};

type UseSimpleChatReturn = {
  messages: UIMessage[];
  setMessages: (msgs: UIMessage[]) => void;
  status: ChatStatus;
  error: Error | undefined;
  sendMessage: (msg: { role: "user"; content: string }) => Promise<void>;
  stop: () => void;
  regenerate: () => Promise<void>;
};

function parseSSELine(line: string): { event?: string; data?: string } | null {
  if (!line || line.startsWith(":")) return null;
  const colonIdx = line.indexOf(":");
  if (colonIdx === -1) return null;
  const field = line.slice(0, colonIdx);
  const value = line.slice(colonIdx + 1).trim();
  if (field === "event") return { event: value };
  if (field === "data") return { data: value };
  return null;
}

/**
 * Minimal chat hook that reads SSE from /api/chat.
 * Avoids useSyncExternalStore to prevent max-update-depth loops with tool calls.
 */
export function useSimpleChat({
  api,
  id,
  initialMessages = [],
  onError,
  onFinish,
}: UseSimpleChatOptions): UseSimpleChatReturn {
  const [messages, setMessages] = useState<UIMessage[]>(initialMessages);
  const [status, setStatus] = useState<ChatStatus>("ready");
  const [error, setErrorState] = useState<Error | undefined>();
  const abortRef = useRef<AbortController | null>(null);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  const updateMessages = useCallback((update: UIMessage[] | ((prev: UIMessage[]) => UIMessage[])) => {
    setMessages(update);
  }, []);

  const sendMessage = useCallback(async (msg: { role: "user"; content: string }) => {
    if (status !== "ready") return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setStatus("submitted");

    const userMsg: UIMessage = {
      id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      role: "user",
      parts: [{ type: "text", text: msg.content } as any],
    };

    const pendingAssistantId = `msg_pending_${Date.now()}`;
    const pendingAssistant: UIMessage = {
      id: pendingAssistantId,
      role: "assistant",
      parts: [{ type: "text", text: "" } as any],
    };

    setMessages((prev) => [...prev, userMsg, pendingAssistant]);
    setStatus("streaming");

    try {
      const res = await fetch(api, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [...messagesRef.current, userMsg].map((m) => ({
            id: m.id,
            role: m.role,
            parts: m.parts,
          })),
          id,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      let buffer = "";
      let eventType = "";
      let dataAccum = "";
      let finalContent = "";
      const toolCalls: Map<string, { toolName: string; input: any }> = new Map();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (line === "") {
            // empty line = end of event
            if (eventType === "data" && dataAccum) {
              try {
                const parsed = JSON.parse(dataAccum);
                // Handle different event types from UIMessageStream
                if (parsed.type === "text-delta" && parsed.textDelta != null) {
                  finalContent += parsed.textDelta;
                } else if (parsed.type === "tool-call" || parsed.type === "tool_call") {
                  toolCalls.set(parsed.toolCallId || parsed.id, {
                    toolName: parsed.toolName || "unknown",
                    input: parsed.args || parsed.input || {},
                  });
                } else if (parsed.type === "tool-result" || parsed.type === "tool_result") {
                  // tool result
                } else if (parsed.type === "finish" || parsed.type === "finish_step") {
                  // finish
                } else if (parsed.type === "error") {
                  throw new Error(parsed.error || "Stream error");
                }
              } catch (e) {
                if (e instanceof SyntaxError) {
                  // partial JSON, ignore
                } else {
                  throw e;
                }
              }
            }
            eventType = "";
            dataAccum = "";
          } else {
            const parsed = parseSSELine(line);
            if (parsed?.event) eventType = parsed.event;
            if (parsed?.data) {
              if (eventType === "data") dataAccum += parsed.data;
            }
          }
        }
      }

      // Build final message
      const parts: any[] = [];
      if (finalContent) parts.push({ type: "text", text: finalContent });
      toolCalls.forEach((tc, id) => {
        parts.push({ type: "tool-call", toolCallId: id, toolName: tc.toolName, args: tc.input });
      });

      const finalMsg: UIMessage = {
        id: pendingAssistantId,
        role: "assistant",
        parts: parts.length > 0 ? parts : [{ type: "text", text: "" }],
      };

      setMessages((prev) => {
        const next = [...prev];
        const idx = next.findIndex((m) => m.id === pendingAssistantId);
        if (idx >= 0) next[idx] = finalMsg;
        return next;
      });

      setStatus("ready");
      onFinish?.(finalMsg);
    } catch (err: any) {
      if (err.name === "AbortError") {
        setStatus("ready");
        return;
      }
      setErrorState(err);
      setStatus("error");
      onError?.(err);
    }
  }, [api, id, status, onError, onFinish]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    setStatus("ready");
  }, []);

  const regenerate = useCallback(async () => {
    // Remove last assistant message and re-send the last user message
    const msgs = messagesRef.current;
    const lastUserIdx = msgs.map((m) => m.role).lastIndexOf("user");
    if (lastUserIdx < 0) return;
    const lastUserMsg = msgs[lastUserIdx];
    const text = lastUserMsg.parts.filter((p) => p.type === "text").map((p: any) => p.text).join("");
    // Remove everything after last user message
    setMessages((prev) => prev.slice(0, lastUserIdx + 1));
    await sendMessage({ role: "user", content: text });
  }, [sendMessage]);

  return {
    messages,
    setMessages,
    status,
    error,
    sendMessage: sendMessage as any,
    stop,
    regenerate,
  };
}
