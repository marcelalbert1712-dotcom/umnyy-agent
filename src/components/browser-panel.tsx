"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { GlobeIcon, RefreshCwIcon, ExternalLinkIcon } from "lucide-react";

export function BrowserPanel({ chatId }: { chatId: string }) {
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const hasEverLoaded = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/browser?chatId=${encodeURIComponent(chatId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "screenshot" }),
      });
      const data = await res.json();
      console.log("[BrowserPanel] refresh result:", res.status, data);
      if (!res.ok) {
        if (res.status === 500) setError(data.error ?? "Ошибка браузера");
        setScreenshot(null);
        return;
      }
      if (data.screenshot) {
        setScreenshot(data.screenshot);
        setError(null);
        if (!hasEverLoaded.current) {
          hasEverLoaded.current = true;
          setOpen(true);
          console.log("[BrowserPanel] auto-open triggered");
        }
      }
    } catch {
      console.log("[BrowserPanel] fetch failed (browser not active)");
    }
  }, [chatId]);

  useEffect(() => {
    const id = setInterval(refresh, 3000);
    return () => clearInterval(id);
  }, [refresh]);

  return (
    <div className="border-t">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground"
      >
        <GlobeIcon className="size-3.5" />
        <span className="flex-1 text-left">Браузер</span>
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
