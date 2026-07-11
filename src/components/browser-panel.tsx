"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { GlobeIcon, RefreshCwIcon } from "lucide-react";

export function BrowserPanel({ chatId }: { chatId: string }) {
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [wsConnected, setWsConnected] = useState(false);
  const hasEverLoaded = useRef(false);
  const wsRef = useRef<WebSocket | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const updateScreenshot = useCallback((data: string | null, err: string | null) => {
    if (data) {
      setScreenshot(data);
      setError(null);
      if (!hasEverLoaded.current) {
        hasEverLoaded.current = true;
        setOpen(true);
      }
    } else if (err) {
      setError(err);
    }
  }, []);

  // Polling fallback
  const refresh = useCallback(async () => {
    if (wsConnected) return;
    try {
      const res = await fetch(`/api/browser?chatId=${encodeURIComponent(chatId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "screenshot" }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 500) updateScreenshot(null, data.error ?? "Ошибка браузера");
        else setScreenshot(null);
        return;
      }
      if (data.screenshot) updateScreenshot(data.screenshot, null);
    } catch {
      /* browser not active */
    }
  }, [chatId, wsConnected, updateScreenshot]);

  // WebSocket
  useEffect(() => {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${proto}//${window.location.host}/ws?chatId=${encodeURIComponent(chatId)}`;
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout>;
    let mounted = true;
    let reconnectAttempts = 0;
    const MAX_RECONNECT = 3;
    const RECONNECT_DELAY = 5000;

    const connect = () => {
      if (!mounted || reconnectAttempts >= MAX_RECONNECT) return;
      reconnectAttempts++;
      try {
        ws = new WebSocket(wsUrl);
      } catch {
        return;
      }
      wsRef.current = ws;

      ws.onopen = () => {
        setWsConnected(true);
        reconnectAttempts = 0;
        if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === "screenshot" && msg.data) {
            updateScreenshot(msg.data, null);
          }
        } catch { /* ignore malformed */ }
      };

      ws.onclose = () => {
        setWsConnected(false);
        wsRef.current = null;
        if (!mounted) return;
        // Start polling fallback only once
        if (!pollRef.current) {
          pollRef.current = setInterval(refresh, 5000);
        }
        // Reconnect with backoff only if under limit
        if (reconnectAttempts < MAX_RECONNECT) {
          reconnectTimer = setTimeout(connect, RECONNECT_DELAY * reconnectAttempts);
        }
      };

      ws.onerror = () => {
        // Don't close here — onclose will handle it
      };
    };

    connect();

    return () => {
      mounted = false;
      if (ws) { ws.onclose = null; ws.close(); }
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    };
  }, [chatId, refresh, updateScreenshot]);

  return (
    <div className="border-t">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground"
      >
        <GlobeIcon className="size-3.5" />
        <span className="flex-1 text-left">Браузер</span>
        <span className="text-[10px] text-muted-foreground/50">
          {wsConnected ? "WS" : "poll"}
        </span>
        {error && <span className="size-1.5 rounded-full bg-red-500" title={error} />}
        {screenshot && !error && <span className="size-1.5 rounded-full bg-green-500" title="Браузер активен" />}
      </button>
      {open && (
        <div className="px-2 pb-2">
          {error && (
            <p className="mb-1 rounded bg-red-500/10 px-2 py-1 text-[10px] text-red-500">
              {error}
            </p>
          )}
          {screenshot ? (
            <div className="relative">
              <img src={screenshot} alt="Browser screenshot" className="w-full rounded-lg border" />
              <button
                type="button"
                onClick={refresh}
                className="absolute right-1 top-1 rounded bg-background/80 p-1 text-muted-foreground hover:text-foreground"
                title="Обновить"
              >
                <RefreshCwIcon className="size-3" />
              </button>
            </div>
          ) : (
            <p className="py-2 text-center text-[10px] text-muted-foreground/60">
              Браузер не активен. Попросите агента открыть страницу.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
