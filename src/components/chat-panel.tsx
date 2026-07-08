import { useChat } from "@ai-sdk/react";
import { type UIMessage } from "ai";
import {
  CopyIcon,
  DownloadIcon,
  EraserIcon,
  GitBranchIcon,
  HistoryIcon,
  Maximize2Icon,
  Minimize2Icon,
  PencilIcon,
  PlusIcon,
  RefreshCwIcon,
  SaveIcon,
  SearchIcon,
  StarIcon,
  Volume2Icon,
  WrenchIcon,
  XIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import { PromptInput } from "@/components/ai-elements/prompt-input";
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@/components/ai-elements/reasoning";
import { Tool, ToolHeader, ToolContent, ToolInput, ToolOutput } from "@/components/ai-elements/tool";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  AVAILABLE_MODELS,
  type UserSettings,
} from "@/lib/presets";
import { pushAction } from "@/lib/action-log";
import { downloadAsMarkdown, downloadAsText, openAsPdf } from "@/lib/export-chat";
import { PlanPanel } from "@/components/plan-panel";
import { TaskPanel } from "@/components/task-panel";

const SUGGESTIONS = [
  {
    title: "Напиши письмо",
    prompt: "Напиши официальное письмо клиенту о переносе дедлайна проекта.",
  },
  {
    title: "Объясни тему",
    prompt: "Объясни простыми словами, что такое blockchain и как он работает.",
  },
  {
    title: "Погода и время",
    prompt: "Какая сейчас погода в Токио и сколько там времени?",
  },
  {
    title: "Веб-поиск",
    prompt: "Найди информацию о языке программирования Rust.",
  },
  {
    title: "Перевод",
    prompt: "Переведи на английский: «Мне нужно сдать отчёт до пятницы».",
  },
  {
    title: "Генерация картинки",
    prompt: "Нарисуй логотип для ИИ-стартапа в минималистичном стиле.",
  },
  {
    title: "Вычисления",
    prompt: "Посчитай (1234 + 5678) * 3 / 7 и объясни результат.",
  },
  {
    title: "Идеи для поста",
    prompt: "Придумай 5 идей для поста в Instagram про искусственный интеллект.",
  },
];

const TOOL_TITLES: Record<string, string> = {
  getCurrentTime: "Текущее время",
  getWeather: "Погода",
  webSearch: "Веб-поиск",
  calculator: "Калькулятор",
  generateImage: "Генерация картинки",
  runCode: "Запуск кода",
  saveFile: "Сохранение файла",
  downloadFile: "Загрузка файла",
  browserAgent: "Браузер",
  saveUserFact: "Память",
  updateUserFact: "Память",
  deleteUserFact: "Память",
};

const TOOL_COLORS: Record<string, string> = {
  getCurrentTime: "text-tool-time",
  getWeather: "text-tool-weather",
  webSearch: "text-tool-search",
  calculator: "text-tool-calc",
  generateImage: "text-tool-image",
  runCode: "text-tool-code",
  saveFile: "text-tool-file",
  downloadFile: "text-tool-file",
  browserAgent: "text-tool-browser",
  saveUserFact: "text-tool-memory",
  updateUserFact: "text-tool-memory",
  deleteUserFact: "text-tool-memory",
};

type ToolPartLike = {
  type: string;
  state: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
  toolName?: string;
};

function TypingDots() {
  return (
    <div className="flex items-center gap-1 py-1">
      <span className="typing-dot size-2 rounded-full bg-muted-foreground" />
      <span className="typing-dot size-2 rounded-full bg-muted-foreground" />
      <span className="typing-dot size-2 rounded-full bg-muted-foreground" />
    </div>
  );
}

function SpeakButton({ parts }: { parts: UIMessage["parts"] }) {
  const [speaking, setSpeaking] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [preferredVoice, setPreferredVoice] = useState<string>(() => localStorage.getItem("tts-voice") ?? "");
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  useEffect(() => {
    const update = () => {
      setVoices(window.speechSynthesis.getVoices());
    };
    update();
    window.speechSynthesis.addEventListener("voiceschanged", update);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", update);
  }, []);

  const text = parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join(" ");
  if (!text) return null;

  const ruVoices = voices.filter((v) => v.lang.startsWith("ru"));
  const pickVoice = (): SpeechSynthesisVoice | null => {
    if (preferredVoice) {
      const found = ruVoices.find((v) => v.name === preferredVoice);
      if (found) return found;
    }
    // Prefer neural/online voices, fall back to any Russian
    const neural = ruVoices.find((v) => v.name.includes("Neural") || v.name.includes("Online") || v.localService === false);
    if (neural) return neural;
    // Prefer female voices (usually more natural on Windows)
    const female = ruVoices.find((v) =>
      ["Irina", "Dariya", "Svetlana", " Olga", " Elena", "Maria", "Anna", "Galina", " female", "женский"].some((n) =>
        v.name.toLowerCase().includes(n.toLowerCase()),
      ),
    );
    if (female) return female;
    return ruVoices[0] ?? null;
  };

  const toggle = () => {
    if (speaking) {
      window.speechSynthesis.cancel();
      setSpeaking(false);
      return;
    }
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "ru-RU";
    u.rate = 0.85;
    u.pitch = 1.05;
    const voice = pickVoice();
    if (voice) u.voice = voice;
    u.onend = () => setSpeaking(false);
    u.onerror = () => setSpeaking(false);
    utteranceRef.current = u;
    window.speechSynthesis.speak(u);
    setSpeaking(true);
  };

  const handleVoiceChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const v = e.target.value;
    setPreferredVoice(v);
    localStorage.setItem("tts-voice", v);
  };

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={toggle}
        className={cn(
          "flex size-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
          speaking && "text-agent-start",
        )}
        aria-label={speaking ? "Остановить" : "Озвучить"}
        title={speaking ? "Остановить" : "Озвучить"}
      >
        <Volume2Icon className={cn("size-3.5", speaking && "tts-speaking")} />
      </button>
      {ruVoices.length > 1 && (
        <select
          value={preferredVoice}
          onChange={handleVoiceChange}
          onClick={(e) => e.stopPropagation()}
          className="max-w-[120px] truncate rounded border-0 bg-transparent text-[10px] text-muted-foreground outline-none hover:text-foreground"
          aria-label="Голос"
        >
          <option value="">Авто</option>
          {ruVoices.map((v) => (
            <option key={v.name} value={v.name}>
              {v.name.replace(/^Microsoft /, "").replace(/ - Russian.*$/, "")}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

function StepDivider({ step }: { step: number }) {
  return (
    <div className="my-1 flex items-center gap-2 text-[11px] text-muted-foreground">
      <span className="h-px flex-1 bg-border" />
      <span className="flex items-center gap-1">
        <WrenchIcon className="size-3" />
        Шаг {step}
      </span>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

export type ChatPanelProps = {
  chatId: string;
  title: string;
  initialMessages: UIMessage[];
  onSaveMessages: (id: string, messages: UIMessage[]) => void;
  onClearChat: (id: string) => void;
};

export function ChatPanel({
  chatId,
  title,
  initialMessages,
  onSaveMessages,
  onClearChat,
}: ChatPanelProps) {
  const { messages, sendMessage, status, stop, error, regenerate, setMessages } =
    useChat({
      id: chatId,
      api: "/api/chat",
      messages: initialMessages,
      experimental_throttle: 150,
      onError: (err) => {
        console.error("useChat error:", err);
      },
    });

  const [input, setInput] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [currentModel, setCurrentModel] = useState("");
  const [currentTemperature, setCurrentTemperature] = useState(1.0);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const timestampsRef = useRef<Record<string, number>>({});
  const historyRef = useRef<{ messages: UIMessage[]; ts: number }[]>([]);
  const [timeTravelIdx, setTimeTravelIdx] = useState<number | null>(null);
  const [focusMode, setFocusMode] = useState(false);
  const [researchMode, setResearchMode] = useState(false);
  const [chatSearchQuery, setChatSearchQuery] = useState("");
  const [editingMsgId, setEditingMsgId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const [showHotkeys, setShowHotkeys] = useState(false);
  const [confidenceScores, setConfidenceScores] = useState<Record<string, number>>({});
  const [quoteText, setQuoteText] = useState<string | null>(null);
  const [quotePos, setQuotePos] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const handler = () => {
      const sel = window.getSelection();
      const text = sel?.toString().trim();
      if (text && sel && sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        setQuoteText(text);
        setQuotePos({ x: rect.left + rect.width / 2, y: rect.top - 8 });
      } else {
        setQuoteText(null);
        setQuotePos(null);
      }
    };
    document.addEventListener("selectionchange", handler);
    return () => document.removeEventListener("selectionchange", handler);
  }, []);

  const handleQuote = () => {
    if (!quoteText) return;
    const quoted = quoteText.split("\n").map((l) => `> ${l}`).join("\n");
    setInput((prev) => (prev ? `${prev}\n\n${quoted}\n\n` : `${quoted}\n\n`));
    setQuoteText(null);
    setQuotePos(null);
  };

  // Запоминаем время первого появления каждого сообщения
  for (const m of messages) {
    if (!timestampsRef.current[m.id]) {
      timestampsRef.current[m.id] = Date.now();
    }
  }

  // Drag & drop файлов
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    setDragOver(true);
  }, []);
  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
  }, []);
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const dropped = Array.from(e.dataTransfer.files);
    if (dropped.length > 0) setFiles((prev) => [...prev, ...dropped]);
  }, []);

  const isStreaming = status === "submitted" || status === "streaming";
  const canSend = status === "ready" || status === "error";

  // Персистентность: дебаунс-сохранение при изменении сообщений
  // + синхронное сохранение при размонтировании (переключение чата).
  const messagesRef = useRef(initialMessages);
  messagesRef.current = messages;

  useEffect(() => {
    if (error) console.error("[ChatPanel] error:", error);
  }, [error]);

  useEffect(() => {
    const t = setTimeout(() => onSaveMessages(chatId, messages), 500);
    return () => clearTimeout(t);
  }, [messages, chatId, onSaveMessages]);

  // Оценка уверенности после завершения стриминга
  const prevStatusRef = useRef(status);
  const scoredRef = useRef(new Set<string>());
  useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = status;
    if (prev !== "ready" && status === "ready") {
      const lastMsg = messages[messages.length - 1];
      if (lastMsg?.role === "assistant" && lastMsg.id && !scoredRef.current.has(lastMsg.id)) {
        scoredRef.current.add(lastMsg.id);
        const text = lastMsg.parts.filter((p) => p.type === "text").map((p) => (p as { text: string }).text).join("");
        if (text.trim()) {
          fetch("/api/evaluate-confidence", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: text.slice(0, 2000) }),
          })
            .then((r) => r.json())
            .then((data) => {
              if (typeof data.score === "number") {
                setConfidenceScores((prev) => ({ ...prev, [lastMsg.id]: data.score }));
              }
            })
            .catch(() => {});
        }
      }
    }
  }, [status]);

  // Проактивность: подсказки при бездействии
  const lastActivityRef = useRef(Date.now());
  const [proactiveSuggestion, setProactiveSuggestion] = useState<string | null>(null);
  useEffect(() => {
    lastActivityRef.current = Date.now();
  }, [input, messages]);

  // Load current model from settings
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/settings");
        if (res.ok) {
          const data = await res.json();
          const s = data.settings as UserSettings;
          setCurrentModel(s.model ?? "");
          setCurrentTemperature(s.temperature ?? 1.0);
        }
      } catch { /* ignore */ }
    })();
  }, []);

  useEffect(() => {
    return () => {
      onSaveMessages(chatId, messagesRef.current);
    };
  }, [chatId, onSaveMessages]);

  // Record message history snapshot for time travel
  useEffect(() => {
    if (isStreaming || messages.length === 0) return;
    const hist = historyRef.current;
    const prev = hist[hist.length - 1];
    if (
      prev &&
      prev.messages.length === messages.length &&
      prev.messages[prev.messages.length - 1]?.id === messages[messages.length - 1]?.id
    ) {
      return;
    }
    hist.push({ messages: messages.map((m) => ({ ...m })), ts: Date.now() });
    if (hist.length > 50) hist.shift();
  }, [messages, isStreaming]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.ctrlKey || e.metaKey) {
        switch (e.key.toLowerCase()) {
          case "n": e.preventDefault(); /* handled via App */ break;
          case "e": e.preventDefault(); setMenuOpen((o) => !o); break;
          case "l": e.preventDefault(); handleClear(); break;
        }
      }
      // Ctrl+Shift+C: copy last assistant answer
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "c") {
        e.preventDefault();
        if (lastAssistantText) copyToClipboard(lastAssistantText);
      }
      if (e.key === "?") {
        setShowHotkeys((v) => !v);
      }
      if (e.key === "Escape") {
        setMenuOpen(false);
        setModelMenuOpen(false);
        setShowHotkeys(false);
        setChatSearchQuery("");
        setEditingMsgId(null);
        setFocusMode(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });

  // Notification sound when streaming finishes
  const prevStatus = useRef(status);
  useEffect(() => {
    if (prevStatus.current === "streaming" && status === "ready" && !focusMode) {
      try {
        const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = 880;
        gain.gain.value = 0.08;
        osc.start();
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.2);
        osc.stop(ctx.currentTime + 0.2);
      } catch { /* audio not supported */ }
    }
    prevStatus.current = status;
  }, [status, focusMode]);

  // Auto-title from first user message
  const titleGeneratedRef = useRef(false);
  useEffect(() => {
    if (titleGeneratedRef.current) return;
    const firstUser = messages.find((m) => m.role === "user");
    if (!firstUser) return;
    titleGeneratedRef.current = true;
    const text = firstUser.parts.filter((p) => p.type === "text").map((p) => (p as { text: string }).text).join(" ").slice(0, 60);
    if (text.length > 3 && title === "Новый чат") {
      onSaveMessages(chatId, messages);
      fetch(`/api/chats/${encodeURIComponent(chatId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: text + (text.length >= 60 ? "..." : "") }),
      }).catch(() => {});
    }
  }, [messages, chatId, title, onSaveMessages]);

  const displayMessages =
    timeTravelIdx !== null && historyRef.current[timeTravelIdx]
      ? historyRef.current[timeTravelIdx].messages
      : messages;

  // Проактивность: таймер бездействия (должен быть после displayMessages)
  useEffect(() => {
    if (isStreaming || displayMessages.length === 0) { setProactiveSuggestion(null); return; }
    const timer = setInterval(() => {
      const idle = Date.now() - lastActivityRef.current;
      if (idle < 8000) { setProactiveSuggestion(null); return; }
      const last = displayMessages[displayMessages.length - 1];
      if (last?.role === "assistant" && messages.length >= 2) {
        setProactiveSuggestion("Продолжить ответ?");
      } else if (messages.length >= 2) {
        setProactiveSuggestion("Задать следующий вопрос?");
      } else {
        setProactiveSuggestion(null);
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [isStreaming, displayMessages, messages.length]);

  // Search filter within displayed messages
  const searchFiltered = chatSearchQuery.trim()
    ? displayMessages.filter((m) =>
        m.parts.some(
          (p) => p.type === "text" && (p as { text: string }).text.toLowerCase().includes(chatSearchQuery.toLowerCase()),
        ),
      )
    : displayMessages;

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setToast("Скопировано");
      setTimeout(() => setToast(null), 1500);
    } catch { /* not available */ }
  };

  const startEdit = (msgId: string, text: string) => {
    setEditingMsgId(msgId);
    setEditText(text);
  };

  const retryMessage = (msgId: string, text: string) => {
    const idx = messages.findIndex((m) => m.id === msgId);
    if (idx === -1) return;
    setMessages(messages.slice(0, idx));
    setTimeout(() => sendMessage({ text }), 0);
  };

  const saveEdit = () => {
    if (!editingMsgId || !editText.trim()) { setEditingMsgId(null); return; }
    const idx = messages.findIndex((m) => m.id === editingMsgId);
    if (idx === -1) { setEditingMsgId(null); return; }
    setMessages(messages.slice(0, idx));
    setEditingMsgId(null);
    setInput(editText.trim());
  };

  const handleSubmit = () => {
    const text = input.trim();
    if ((!text && files.length === 0) || !canSend) return;
    if (researchMode) {
      handleResearch(text);
      return;
    }
    const dt = new DataTransfer();
    for (const f of files) dt.items.add(f);
    sendMessage({ text, files: dt.files });
    setInput("");
    setFiles([]);
  };

  const [researchStatus, setResearchStatus] = useState<string>("");
  const handleResearch = async (query: string) => {
    if (!query) return;
    setInput("");
    setResearchMode(false);
    setResearchStatus("Исследую…");

    const placeholderId = `research_${Date.now()}`;
    const loadingMsg: any = {
      id: placeholderId,
      role: "assistant",
      parts: [{ type: "text", text: `*Исследую:* ${query}\n\n⏳ Исследую…` }],
    };

    sendMessage({ text: query });

    setTimeout(async () => {
      setMessages((prev) => [...prev, loadingMsg]);
      try {
        const res = await fetch("/api/research", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query }),
          signal: AbortSignal.timeout(120_000),
        });
        if (!res.ok) {
          const err = await res.text();
          setMessages((prev) =>
            prev.map((m: any) =>
              m.id === placeholderId
                ? { ...m, parts: [{ type: "text", text: `❌ Ошибка: ${err}` }] }
                : m,
            ),
          );
          return;
        }
        const data = await res.json();
        if (data.error) {
          setMessages((prev) =>
            prev.map((m: any) =>
              m.id === placeholderId
                ? { ...m, parts: [{ type: "text", text: `❌ ${data.error}` }] }
                : m,
            ),
          );
          return;
        }
        const sources = data.sources?.length
          ? `\n\n---\n*Источники:*\n${data.sources.map((s: string) => `- ${s}`).join("\n")}`
          : "";
        const fullText = data.report + sources;
        setMessages((prev) =>
          prev.map((m: any) =>
            m.id === placeholderId
              ? { ...m, parts: [{ type: "text", text: fullText }] }
              : m,
          ),
        );
      } catch (err: any) {
        setMessages((prev) =>
          prev.map((m: any) =>
            m.id === placeholderId
              ? { ...m, parts: [{ type: "text", text: `❌ Ошибка: ${err.message ?? String(err)}` }] }
              : m,
          ),
        );
      }
    }, 100);
  };

  const handleSuggestion = (prompt: string) => {
    if (!canSend) return;
    sendMessage({ text: prompt });
  };

  const handleClear = () => {
    const count = messages.length;
    setMessages([]);
    onClearChat(chatId);
    pushAction({ type: "clear", detail: `Очищен чат «${title}» (${count} сообщений)` });
  };

  const [compressing, setCompressing] = useState(false);
  const handleCompress = async () => {
    if (messages.length < 4) return;
    setCompressing(true);
    const keep = 2;
    const old = messages.slice(0, -keep);
    const recent = messages.slice(-keep);
    try {
      const res = await fetch("/api/summarize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: old.map((m) => ({
            role: m.role,
            text: m.parts.filter((p) => p.type === "text").map((p: any) => p.text).join(" "),
          })),
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      const summary = data.summary || "(пусто)";
      const summaryMsg = {
        id: `summary_${Date.now()}`,
        role: "assistant" as const,
        parts: [{ type: "text" as const, text: `*Сжатая история:* ${summary}` }],
      } as any;
      setMessages([summaryMsg, ...recent]);
      pushAction({ type: "compress", detail: `Сжато ${old.length} сообщений` });
    } catch (err) {
      console.error("Compress error:", err);
    } finally {
      setCompressing(false);
    }
  };

  // ── Favorites ─────────────────────────────────────────────────
  const [favorites, setFavorites] = useState<Record<string, boolean>>(() => {
    try { return JSON.parse(localStorage.getItem("chat-fav") ?? "{}"); } catch { return {}; }
  });
  const toggleFav = (msgId: string) => {
    setFavorites((prev) => {
      const next = { ...prev, [msgId]: !prev[msgId] };
      localStorage.setItem("chat-fav", JSON.stringify(next));
      return next;
    });
  };

  // ── Branching ─────────────────────────────────────────────────
  const handleBranch = (msgId: string) => {
    const snapshot = historyRef.current;
    const idx = messages.findIndex((m) => m.id === msgId);
    if (idx === -1) return;
    setTimeTravelIdx(null);
    historyRef.current = [...snapshot, { messages, ts: Date.now() }];
    setMessages(messages.slice(0, idx + 1));
    pushAction({ type: "branch", detail: `Ветвление на сообщении ${msgId.slice(0, 8)}` });
    setTimeout(() => {
      const log = document.querySelector('[role="log"]');
      if (log) log.scrollTop = log.scrollHeight;
    }, 50);
  };

  // ── Presets ────────────────────────────────────────────────────
  type Preset = { name: string; text: string };
  const [presets, setPresets] = useState<Preset[]>(() => {
    try { return JSON.parse(localStorage.getItem("chat-presets") ?? "[]"); } catch { return []; }
  });
  const [presetsOpen, setPresetsOpen] = useState(false);
  const [addingPreset, setAddingPreset] = useState(false);
  const [newPresetName, setNewPresetName] = useState("");
  const [newPresetText, setNewPresetText] = useState("");
  const savePresets = (list: Preset[]) => {
    setPresets(list);
    localStorage.setItem("chat-presets", JSON.stringify(list));
  };
  const exportPresets = () => {
    const json = JSON.stringify(presets, null, 2);
    navigator.clipboard.writeText(json).then(() => setToast("Пресеты скопированы в буфер")).catch(() => {
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = "presets.json"; a.click();
      URL.revokeObjectURL(url);
    });
    pushAction({ type: "preset-export", detail: `Экспортировано ${presets.length} пресетов` });
  };
  const importPresets = () => {
    const input = document.createElement("input"); input.type = "file"; input.accept = ".json";
    input.onchange = async () => {
      const file = input.files?.[0]; if (!file) return;
      try {
        const text = await file.text();
        const imported = JSON.parse(text) as Preset[];
        if (!Array.isArray(imported) || !imported.every((p) => typeof p.name === "string" && typeof p.text === "string")) {
          setToast("Неверный формат файла"); return;
        }
        savePresets([...presets, ...imported]);
        setToast(`Импортировано ${imported.length} пресетов`);
        pushAction({ type: "preset-import", detail: `Импортировано ${imported.length} пресетов` });
      } catch { setToast("Ошибка импорта"); }
    };
    input.click();
  };

  // ── Continue generation ────────────────────────────────────────
  const handleContinue = () => {
    if (!canSend) return;
    sendMessage({ text: "продолжай" });
  };

  // ── JSON export ────────────────────────────────────────────────
  const downloadAsJson = () => {
    const data = { title, model: currentModel, exportedAt: new Date().toISOString(), messages: displayMessages };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${title.replace(/[^a-zA-Zа-яА-Я0-9]/g, "_")}.json`; a.click();
    URL.revokeObjectURL(url);
  };

  // ── Token estimate ─────────────────────────────────────────────
  const tokenEstimate = (text: string) => Math.ceil(text.length / 4);

  // ── Ctrl+Shift+C: copy last assistant text ─────────────────────
  const lastAssistantText = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "assistant") {
        return messages[i].parts.filter((p) => p.type === "text").map((p) => (p as { text: string }).text).join(" ");
      }
    }
    return "";
  }, [messages]);

  const renderAssistantParts = (
    message: (typeof messages)[number],
    isLast: boolean,
  ): ReactNode[] => {
    let step = 0;
    const toolIndices = message.parts
      .map((p, i) => (p.type === "dynamic-tool" || p.type.startsWith("tool-") ? i : -1))
      .filter((i) => i >= 0);
    const lastToolIdx = toolIndices[toolIndices.length - 1];
    return message.parts.map((part, i) => {
      const key = `${message.id}-${i}`;
      const partIsStreaming = isStreaming && isLast;

      if (part.type === "step-start") {
        step += 1;
        if (i === 0) return null;
        return <StepDivider key={key} step={step} />;
      }

      if (part.type === "text") {
        if (!part.text) return null;
        return <MessageResponse key={key} content={part.text} highlight={chatSearchQuery || undefined} />;
      }

      if (part.type === "reasoning") {
        return (
          <Reasoning
            key={key}
            messageId={key}
            isStreaming={partIsStreaming}
            defaultOpen={partIsStreaming}
          >
            <ReasoningTrigger isStreaming={partIsStreaming} />
            <ReasoningContent>{part.text}</ReasoningContent>
          </Reasoning>
        );
      }

      if (part.type === "dynamic-tool" || part.type.startsWith("tool-")) {
        const tp = part as unknown as ToolPartLike;
        const rawName = tp.type === "dynamic-tool" ? tp.toolName ?? "tool" : tp.type.slice("tool-".length);
        const isLastTool = i === lastToolIdx;
        return (
          <Tool key={key} defaultOpen={false}>
            <ToolHeader title={TOOL_TITLES[rawName] ?? rawName} type={tp.type as any} state={tp.state as any} toolName={tp.toolName} />
            <ToolContent>
              {tp.input != null && <ToolInput input={tp.input} />}
              {tp.output != null && <ToolOutput output={tp.output} errorText={tp.errorText} />}
            </ToolContent>
          </Tool>
        );
      }

      return null;
    });
  };

  const highlightText = (text: string, query: string): ReactNode => {
    if (!query.trim()) return text;
    const lower = text.toLowerCase();
    const q = query.toLowerCase();
    const parts: ReactNode[] = [];
    let last = 0;
    let idx = lower.indexOf(q, last);
    while (idx !== -1) {
      if (idx > last) parts.push(text.slice(last, idx));
      parts.push(<mark key={idx} className="rounded bg-yellow-200/60 px-0.5 text-inherit dark:bg-yellow-500/30">{text.slice(idx, idx + q.length)}</mark>);
      last = idx + q.length;
      idx = lower.indexOf(q, last);
    }
    if (last < text.length) parts.push(text.slice(last));
    return parts.length ? <>{parts}</> : text;
  };

  const showTyping =
    status === "submitted" &&
    (displayMessages.length === 0 ||
      displayMessages[displayMessages.length - 1]?.role !== "assistant");

  return (
    <div
      className={cn("flex h-full flex-col bg-background", dragOver && "ring-2 ring-primary ring-inset")}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {!focusMode && (
      <header className="flex h-14 shrink-0 items-center justify-between border-b px-3 md:px-4">
        <div className="flex min-w-0 items-center gap-1 md:gap-2">
          <Logo size="sm" showTagline={false} />
          <span className="truncate font-semibold">{title}</span>
          <div className="relative ml-1 hidden md:block">
            <button
              type="button"
              onClick={() => setModelMenuOpen((o) => !o)}
              className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-accent"
            >
              {AVAILABLE_MODELS.find((m) => m.id === currentModel)?.label ?? "По умолчанию"}
            </button>
            {modelMenuOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setModelMenuOpen(false)} />
                <div className="absolute right-0 top-full z-50 mt-1 w-48 rounded-lg border bg-card py-1 shadow-lg">
                  {AVAILABLE_MODELS.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-accent ${m.id === currentModel ? "bg-accent font-medium" : ""}`}
                      onClick={async () => {
                        setCurrentModel(m.id);
                        setModelMenuOpen(false);
                        try {
                          await fetch("/api/settings", {
                            method: "PUT",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ model: m.id }),
                          });
                        } catch { /* ignore */ }
                      }}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          <div className="ml-2 hidden items-center gap-1 md:flex" title={`Температура: ${currentTemperature.toFixed(1)}`}>
            <input
              type="range"
              min="0"
              max="2"
              step="0.1"
              value={currentTemperature}
              onChange={async (e) => {
                const v = parseFloat(e.target.value);
                setCurrentTemperature(v);
                try {
                  await fetch("/api/settings", {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ temperature: v }),
                  });
                } catch { /* ignore */ }
              }}
              className="h-1 w-16 cursor-pointer appearance-none rounded-full bg-muted accent-primary [&::-webkit-slider-thumb]:size-2.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary"
            />
            <span className="tabular-nums text-[10px] text-muted-foreground">{currentTemperature.toFixed(1)}</span>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {!focusMode && (
            <>
          {historyRef.current.length > 1 && (
            <div className="hidden md:flex items-center gap-1.5 rounded-lg border bg-card px-2 py-1 text-xs">
              <button
                type="button"
                onClick={() => setTimeTravelIdx((prev) =>
                  prev !== null
                    ? prev > 0 ? prev - 1 : null
                    : historyRef.current.length - 2,
                )}
                className="flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                aria-label="Назад в историю"
                title="Назад в историю"
              >
                <HistoryIcon className="size-3.5" />
              </button>
              {timeTravelIdx !== null && (
                <span className="tabular-nums text-muted-foreground">
                  {timeTravelIdx + 1}/{historyRef.current.length}
                </span>
              )}
            </div>
          )}
          {displayMessages.length > 0 && (
            <div className="hidden md:block relative">
              <SearchIcon className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                value={chatSearchQuery}
                onChange={(e) => setChatSearchQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Escape") { setChatSearchQuery(""); (e.target as HTMLInputElement).blur(); } }}
                placeholder="Поиск в чате…"
                className="h-7 w-32 rounded-md border border-border bg-background pl-7 pr-2 text-xs outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary"
              />
            </div>
          )}
          <div className="relative">
            <Button
              variant="ghost"
              size="sm"
              type="button"
              disabled={displayMessages.length === 0}
              onClick={() => setMenuOpen((o) => !o)}
              className="hidden md:inline-flex"
            >
              <DownloadIcon className="size-4" />
              Экспорт
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              type="button"
              disabled={displayMessages.length === 0}
              onClick={() => setMenuOpen((o) => !o)}
              className="md:hidden"
            >
              <DownloadIcon className="size-4" />
            </Button>
            {menuOpen && displayMessages.length > 0 && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
                <div className="absolute right-0 top-full z-50 mt-1 w-36 rounded-lg border bg-card py-1 shadow-lg">
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-accent"
                    onClick={() => { downloadAsMarkdown(displayMessages, title); setMenuOpen(false); }}
                  >
                    Markdown (.md)
                  </button>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-accent"
                    onClick={() => { downloadAsText(displayMessages, title); setMenuOpen(false); }}
                  >
                    Текст (.txt)
                  </button>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-accent"
                    onClick={() => { openAsPdf(displayMessages, title); setMenuOpen(false); }}
                  >
                    PDF (печать)
                  </button>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-accent"
                    onClick={() => { downloadAsJson(); setMenuOpen(false); }}
                  >
                    JSON (.json)
                  </button>
                  <hr className="my-1 border-border" />
                  <label className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-accent">
                    Импорт JSON…
                    <input
                      type="file"
                      accept=".json"
                      className="hidden"
                      onChange={async (e) => {
                        const f = e.target.files?.[0];
                        if (!f) return;
                        const { parseImportJson } = await import("@/lib/export-chat");
                        const data = await parseImportJson(f);
                        if (data) {
                          onSaveMessages(chatId, data.messages);
                          setMenuOpen(false);
                        } else {
                          alert("Неверный формат JSON");
                        }
                      }}
                    />
                  </label>
                </div>
              </>
            )}
          </div>
          <Button
            variant="ghost"
            size="sm"
            type="button"
            onClick={handleClear}
            disabled={displayMessages.length === 0}
          >
            <EraserIcon className="size-4" />
            Очистить
          </Button>
          <Button
            variant="ghost"
            size="sm"
            type="button"
            onClick={handleCompress}
            disabled={messages.length < 4 || compressing}
            title="Сжать историю — заменить старые сообщения кратким саммари"
          >
            {compressing ? "Сжатие…" : "Сжать историю"}
          </Button>
          </>
          )}
          <Button
            variant="ghost"
            size="sm"
            type="button"
            onClick={() => {
              const lastUser = messages.filter((m) => m.role === "user").pop();
              const text = input.trim() || lastUser?.parts
                .filter((p) => p.type === "text")
                .map((p: any) => p.text)
                .join(" ")
                .trim();
              if (!text) return;
              fetch("/api/tasks", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ chatId, goal: text }),
              });
              setInput("");
            }}
            disabled={isStreaming || (!input.trim() && !messages.some((m) => m.role === "user"))}
            title="Запустить текущий запрос в фоне (или последний, если поле пусто)"
          >
            <PlusIcon className="size-4" />
            В фон
          </Button>
          <Button
            variant="ghost"
            size="sm"
            type="button"
            onClick={() => setResearchMode((v) => !v)}
            disabled={isStreaming}
            className={researchMode ? "text-primary" : ""}
            title={researchMode ? "Выйти из исследования" : "Режим исследования"}
          >
            <SearchIcon className="size-4" />
            Research
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            type="button"
            onClick={() => setFocusMode((v) => !v)}
            aria-label={focusMode ? "Выйти из фокуса" : "Режим фокуса"}
            title={focusMode ? "Выйти из фокуса" : "Режим фокуса"}
          >
            {focusMode ? <Minimize2Icon className="size-4" /> : <Maximize2Icon className="size-4" />}
          </Button>
        </div>
      </header>
      )}

      {researchMode && (
        <div className="flex items-center gap-2 border-b bg-primary/5 px-4 py-2 text-xs text-primary">
          <SearchIcon className="size-3.5 shrink-0" />
          <span>Режим глубокого исследования. Агент выполнит несколько поисков, прочитает статьи и сформирует развёрнутый отчёт.</span>
        </div>
      )}

      {timeTravelIdx !== null && (
        <div className="flex items-center justify-center gap-2 bg-primary/10 px-4 py-1.5 text-xs text-primary">
          <HistoryIcon className="size-3.5 shrink-0" />
          <span>Просмотр истории сообщений ({timeTravelIdx + 1}/{historyRef.current.length})</span>
          <button
            type="button"
            onClick={() => setTimeTravelIdx(null)}
            className="ml-2 rounded px-2 py-0.5 font-medium hover:bg-primary/20"
          >
            Вернуться
          </button>
          <button
            type="button"
            onClick={() => {
              const next = timeTravelIdx + 1;
              if (next < historyRef.current.length) setTimeTravelIdx(next);
            }}
            className="rounded px-1 py-0.5 hover:bg-primary/20"
            aria-label="Вперёд"
            title="Вперёд"
          >
            &rarr;
          </button>
          <button
            type="button"
            onClick={() => {
              const prev = timeTravelIdx - 1;
              setTimeTravelIdx(prev >= 0 ? prev : null);
            }}
            className="rounded px-1 py-0.5 hover:bg-primary/20"
            aria-label="Назад"
            title="Назад"
          >
            &larr;
          </button>
        </div>
      )}

      <PlanPanel messages={displayMessages} />

      <Conversation>
        <ConversationContent className="mx-auto w-full max-w-3xl gap-6 px-4">
          {displayMessages.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-6 py-16 text-center">
              <Logo size="lg" />
              <div className="space-y-1">
                <h2 className="text-xl font-semibold">Cabin Boy</h2>
                <p className="text-sm text-muted-foreground">
                  Ассистент с инструментами: время, погода, веб-поиск и
                  вычисления. Вы увидите каждый шаг его работы.
                </p>
              </div>
              <div className="grid w-full max-w-xl gap-2 sm:grid-cols-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s.title}
                    type="button"
                    onClick={() => handleSuggestion(s.prompt)}
                    disabled={!canSend}
                    className="flex flex-col items-start gap-1 rounded-xl border border-border bg-background p-3 text-left text-sm transition-colors hover:bg-accent disabled:opacity-50"
                  >
                    <span className="font-medium">{s.title}</span>
                    <span className="line-clamp-2 text-xs text-muted-foreground">
                      {s.prompt}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            searchFiltered.length === 0 && chatSearchQuery.trim() ? (
              <div className="flex flex-1 items-center justify-center py-16 text-sm text-muted-foreground">
                Ничего не найдено по запросу «{chatSearchQuery}».
              </div>
            ) : (
            searchFiltered.map((message) => {
              const ts = timestampsRef.current[message.id];
              const timeStr = ts ? new Date(ts).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }) : "";
              const isAssistant = message.role !== "user";
              const msgText = message.parts.filter((p) => p.type === "text").map((p) => (p as { text: string }).text).join(" ");
              return (
              <Message key={message.id} from={message.role}>
                <MessageContent>
                  {message.role === "user"
                    ? editingMsgId === message.id ? (
                      <div className="flex flex-col gap-2">
                        <textarea
                          value={editText}
                          onChange={(e) => setEditText(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); saveEdit(); }
                            if (e.key === "Escape") setEditingMsgId(null);
                          }}
                          rows={3}
                          className="w-full resize-none rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
                          autoFocus
                        />
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={saveEdit}
                            className="rounded-md bg-primary px-3 py-1 text-xs text-primary-foreground hover:bg-primary/90"
                          >
                            Сохранить
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingMsgId(null)}
                            className="rounded-md px-3 py-1 text-xs text-muted-foreground hover:bg-accent"
                          >
                            Отмена
                          </button>
                        </div>
                      </div>
                    )
                    : message.parts.map((part, i) => {
                        if (part.type === "text") {
                          return (
                            <span
                              key={`${message.id}-${i}`}
                              className="whitespace-pre-wrap"
                            >
                              {chatSearchQuery ? highlightText(part.text, chatSearchQuery) : part.text}
                            </span>
                          );
                        }
                        if (part.type === "file") {
                          const isImage = part.mediaType?.startsWith("image/");
                          return isImage ? (
                            <img
                              key={`${message.id}-${i}`}
                              src={part.url}
                              alt={part.filename ?? "Изображение"}
                              className="my-1 max-h-60 rounded-lg border object-contain"
                            />
                          ) : (
                            <a
                              key={`${message.id}-${i}`}
                              href={part.url}
                              download={part.filename}
                              className="my-1 inline-flex items-center gap-1.5 rounded-lg border bg-card px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent"
                            >
                              <span className="rounded bg-muted px-1 py-0.5 text-[10px] font-medium">
                                {part.filename?.split(".").pop()?.toUpperCase()}
                              </span>
                              {part.filename}
                            </a>
                          );
                        }
                        return null;
                      })
                    : renderAssistantParts(
                        message,
                        message.id === messages[messages.length - 1]?.id,
                      )}
                  </MessageContent>
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-1">
                      {isAssistant && <SpeakButton parts={message.parts} />}
                      {isAssistant && confidenceScores[message.id] != null && (
                        <span
                          className={cn(
                            "flex size-5 items-center justify-center rounded-full text-[9px] font-bold",
                            confidenceScores[message.id] >= 7
                              ? "bg-green-500/15 text-green-600 dark:text-green-400"
                              : confidenceScores[message.id] >= 4
                                ? "bg-yellow-500/15 text-yellow-600 dark:text-yellow-400"
                                : "bg-red-500/15 text-red-600 dark:text-red-400",
                          )}
                          title="Уверенность"
                        >
                          {confidenceScores[message.id]}
                        </span>
                      )}
                      {msgText && (
                        <button
                          type="button"
                          onClick={() => copyToClipboard(msgText)}
                          className="flex size-6 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover:opacity-100"
                          aria-label="Копировать"
                          title="Копировать"
                        >
                          <CopyIcon className="size-3.5" />
                        </button>
                      )}
                      {isAssistant && (
                        <button
                          type="button"
                          onClick={() => handleBranch(message.id)}
                          className="flex size-6 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover:opacity-100"
                          aria-label="Ветвить"
                          title="Ветвить"
                        >
                          <GitBranchIcon className="size-3.5" />
                        </button>
                      )}
                      {!isAssistant && editingMsgId !== message.id && (
                        <button
                          type="button"
                          onClick={() => startEdit(message.id, msgText)}
                          className="flex size-6 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover:opacity-100"
                          aria-label="Редактировать"
                          title="Редактировать"
                        >
                          <PencilIcon className="size-3.5" />
                        </button>
                      )}
                      {!isAssistant && (
                        <button
                          type="button"
                          onClick={() => retryMessage(message.id, msgText)}
                          className="flex size-6 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover:opacity-100"
                          aria-label="Повторить"
                          title="Повторить"
                        >
                          <RefreshCwIcon className="size-3.5" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => toggleFav(message.id)}
                        className={cn(
                          "flex size-6 items-center justify-center rounded transition-opacity hover:bg-accent",
                          favorites[message.id] ? "text-amber-400 opacity-100" : "text-muted-foreground opacity-0 group-hover:opacity-100",
                        )}
                        aria-label={favorites[message.id] ? "Убрать из избранного" : "В избранное"}
                        title={favorites[message.id] ? "Убрать из избранного" : "В избранное"}
                      >
                        <StarIcon className={cn("size-3.5", favorites[message.id] && "fill-amber-400")} />
                      </button>
                      {timeStr && <span className="text-[10px] text-muted-foreground/50">{timeStr}</span>}
                    </div>
                    {msgText && (
                      <span className="text-[10px] text-muted-foreground/30">~{tokenEstimate(msgText)} токенов</span>
                    )}
                  </div>
                </Message>
              );
            }))
          )}

          {showTyping && (
            <Message from="assistant">
              <MessageContent>
                <TypingDots />
              </MessageContent>
            </Message>
          )}
          {!isStreaming && displayMessages.length > 0 && displayMessages[displayMessages.length - 1]?.role === "assistant" && (
            <div className="flex justify-center gap-2 py-1">
              <button
                type="button"
                onClick={() => regenerate()}
                className="flex items-center gap-1 rounded-full border px-3 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <RefreshCwIcon className="size-3" />
                Ещё вариант
              </button>
              <button
                type="button"
                onClick={handleContinue}
                className="flex items-center gap-1 rounded-full border px-3 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <RefreshCwIcon className="size-3" />
                Продолжить
              </button>
            </div>
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <TaskPanel
        chatId={chatId}
        onInsertResult={(text) => {
          const resultMsg = {
            id: `bg-result-${Date.now()}`,
            role: "assistant" as const,
            parts: [{ type: "text" as const, text }],
          } as any;
          setMessages((prev: any) => [...prev, resultMsg]);
        }}
      />

      <div className="shrink-0 border-t p-3">
        <div className="mx-auto w-full max-w-3xl space-y-2">
          {error && (
            <div className="flex items-center justify-between gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <span className="flex flex-col gap-0.5">
                <span>Ошибка модели.</span>
                <span className="text-xs text-destructive/70">{error instanceof Error ? error.message : String(error)}</span>
              </span>
              <Button
                size="sm"
                variant="ghost"
                type="button"
                onClick={() => regenerate()}
              >
                <RefreshCwIcon className="size-4" />
                Повторить
              </Button>
            </div>
          )}
          <div className="relative">
            <PromptInput
              value={input}
              onChange={setInput}
              onSubmit={handleSubmit}
              onStop={stop}
              isStreaming={isStreaming}
              placeholder="Спросите что угодно…"
              files={files}
              onFilesChange={setFiles}
              leftExtra={
                <button
                  type="button"
                  onClick={() => setPresetsOpen((o) => !o)}
                  className="mb-1 flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  aria-label="Быстрые промпты"
                  title="Быстрые промпты"
                >
                  <SaveIcon className="size-4" />
                </button>
              }
            />
            {presetsOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setPresetsOpen(false)} />
                <div className="absolute bottom-full left-0 mb-2 z-50 w-56 rounded-lg border bg-card py-1 shadow-lg">
                  {presets.map((p, i) => (
                    <button
                      key={i}
                      type="button"
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-accent"
                      onClick={() => { setInput(p.text); setPresetsOpen(false); }}
                    >
                      <SaveIcon className="size-3.5 shrink-0 text-muted-foreground" />
                      <span className="truncate">{p.name}</span>
                    </button>
                  ))}
                  <div className="border-t" />
                  <button
                    type="button"
                    onClick={() => { setAddingPreset(true); setNewPresetName(""); setNewPresetText(input); setPresetsOpen(false); }}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-muted-foreground hover:bg-accent"
                  >
                    <PlusIcon className="size-3.5" />
                    Сохранить текущий как пресет
                  </button>
                  <div className="border-t" />
                  <button
                    type="button"
                    onClick={() => { exportPresets(); setPresetsOpen(false); }}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-muted-foreground hover:bg-accent"
                  >
                    <DownloadIcon className="size-3.5" />
                    Экспорт пресетов
                  </button>
                  <button
                    type="button"
                    onClick={() => { importPresets(); setPresetsOpen(false); }}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-muted-foreground hover:bg-accent"
                  >
                    <PlusIcon className="size-3.5" />
                    Импорт пресетов
                  </button>
                </div>
              </>
            )}
          </div>
          {addingPreset && (
            <div className="flex flex-col gap-2 rounded-lg border bg-card p-3">
              <input
                value={newPresetName}
                onChange={(e) => setNewPresetName(e.target.value)}
                placeholder="Название пресета"
                className="h-8 rounded-md border bg-background px-2 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
                autoFocus
                onKeyDown={(e) => { if (e.key === "Enter") { if (newPresetName.trim() && newPresetText.trim()) { savePresets([...presets, { name: newPresetName.trim(), text: newPresetText.trim() }]); setAddingPreset(false); } } if (e.key === "Escape") setAddingPreset(false); }}
              />
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => { if (newPresetName.trim() && newPresetText.trim()) { savePresets([...presets, { name: newPresetName.trim(), text: newPresetText.trim() }]); setAddingPreset(false); } }}
                  className="rounded-md bg-primary px-3 py-1 text-xs text-primary-foreground"
                >
                  Сохранить
                </button>
                <button
                  type="button"
                  onClick={() => setAddingPreset(false)}
                  className="rounded-md px-3 py-1 text-xs text-muted-foreground hover:bg-accent"
                >
                  Отмена
                </button>
              </div>
            </div>
          )}
          <p className="text-center text-[11px] text-muted-foreground">
            Enter — отправить · Shift+Enter — новая строка
          </p>
        </div>
      </div>

      {proactiveSuggestion && (
        <div className="fixed bottom-20 left-1/2 z-50 -translate-x-1/2 animate-in fade-in slide-in-from-bottom-2 duration-300">
          <div className="flex items-center gap-2 rounded-full border bg-card px-4 py-2 shadow-lg">
            <span className="text-xs text-muted-foreground">{proactiveSuggestion}</span>
            <button
              type="button"
              onClick={() => {
                if (proactiveSuggestion === "Продолжить ответ?") handleContinue();
                setProactiveSuggestion(null);
                lastActivityRef.current = Date.now();
              }}
              className="rounded-full bg-primary px-3 py-1 text-[11px] font-medium text-primary-foreground hover:bg-primary/90"
            >
              Да
            </button>
            <button
              type="button"
              onClick={() => { setProactiveSuggestion(null); lastActivityRef.current = Date.now(); }}
              className="text-[11px] text-muted-foreground hover:text-foreground"
            >
              Нет
            </button>
          </div>
        </div>
      )}

      {quoteText && quotePos && (
        <div
          className="fixed z-50 -translate-x-1/2 -translate-y-full"
          style={{ left: quotePos.x, top: quotePos.y }}
        >
          <button
            type="button"
            onClick={handleQuote}
            className="rounded-lg border bg-card px-3 py-1.5 text-xs font-medium shadow-lg hover:bg-accent"
          >
            Цитировать
          </button>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-foreground px-4 py-2 text-sm text-background shadow-lg">
          {toast}
        </div>
      )}

      {showHotkeys && (
        <>
          <div className="fixed inset-0 z-40 bg-black/40" onClick={() => setShowHotkeys(false)} />
          <div className="fixed left-1/2 top-1/2 z-50 w-80 -translate-x-1/2 -translate-y-1/2 rounded-lg border bg-card p-4 shadow-lg">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold">Горячие клавиши</h3>
              <button type="button" onClick={() => setShowHotkeys(false)} className="text-muted-foreground hover:text-foreground"><XIcon className="size-4" /></button>
            </div>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between"><kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono">Ctrl+N</kbd><span className="text-muted-foreground">Новый чат</span></div>
              <div className="flex justify-between"><kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono">Ctrl+E</kbd><span className="text-muted-foreground">Экспорт меню</span></div>
              <div className="flex justify-between"><kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono">Ctrl+L</kbd><span className="text-muted-foreground">Очистить чат</span></div>
              <div className="flex justify-between"><kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono">Ctrl+Shift+C</kbd><span className="text-muted-foreground">Копировать ответ ассистента</span></div>
              <div className="flex justify-between"><kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono">Escape</kbd><span className="text-muted-foreground">Закрыть меню / поиск</span></div>
              <div className="flex justify-between"><kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono">?</kbd><span className="text-muted-foreground">Эта справка</span></div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
