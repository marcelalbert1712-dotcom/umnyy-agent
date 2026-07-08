import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeftIcon,
  CheckIcon,
  HistoryIcon,
  LoaderIcon,
  PencilIcon,
  PlusIcon,
  SaveIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useTheme, ACCENT_COLORS } from "@/lib/theme";
import {
  CATEGORY_LABELS,
  CHARACTER_PRESETS,
  DEFAULT_PRESET_ID,
  AVAILABLE_MODELS,
  type UserFact,
  type UserSettings,
} from "@/lib/presets";
import { getLog, clearLog, type Action } from "@/lib/action-log";

type FactCategory = UserFact["category"];

const CATEGORIES: FactCategory[] = [
  "personal",
  "work",
  "preference",
  "hobby",
  "goal",
  "other",
];

type View = "facts" | "character" | "log";

export type AdminPanelProps = {
  onBack: () => void;
};

export function AdminPanel({ onBack }: AdminPanelProps) {
  const [view, setView] = useState<View>("facts");

  return (
    <div className="flex h-full w-full flex-col bg-background">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
        <Button
          variant="ghost"
          size="sm"
          type="button"
          onClick={onBack}
        >
          <ArrowLeftIcon className="size-4" />
          Назад к чатам
        </Button>
        <div className="ml-2 flex items-center gap-1 rounded-lg bg-muted p-0.5">
          <TabButton
            active={view === "facts"}
            onClick={() => setView("facts")}
          >
            Факты обо мне
          </TabButton>
          <TabButton
            active={view === "character"}
            onClick={() => setView("character")}
          >
            Характер агента
          </TabButton>
          <TabButton
            active={view === "log"}
            onClick={() => setView("log")}
          >
            <HistoryIcon className="size-3.5" />
            Журнал
          </TabButton>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-2xl px-4 py-6">
          {view === "facts" ? (
            <FactsSection />
          ) : view === "character" ? (
            <CharacterSection />
          ) : (
            <LogSection />
          )}
        </div>
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
        active
          ? "bg-background text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

// ── Факты ───────────────────────────────────────────────────────────────────

function FactsSection() {
  const [facts, setFacts] = useState<UserFact[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const reload = useCallback(async () => {
    try {
      const res = await fetch("/api/facts");
      if (res.ok) {
        const data = await res.json();
        setFacts(data.facts ?? []);
      } else {
        setFacts([]);
      }
    } catch {
      setFacts([]);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/facts/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setFacts((prev) => prev?.filter((f) => f.id !== id) ?? null);
      } else {
        setError("Не удалось удалить факт");
      }
    } catch {
      setError("Сеть недоступна");
    }
  };

  if (facts === null) {
    return (
      <div className="flex items-center justify-center py-16">
        <LoaderIcon className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <section className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">Факты обо мне</h2>
        <p className="text-sm text-muted-foreground">
          То, что агент запомнил о вас. Можно отредактировать или удалить —
          агент учтёт это в следующих ответах.
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setAdding((v) => !v)}
      >
        <PlusIcon className="size-4" />
        {adding ? "Отмена" : "Добавить факт"}
      </Button>

      {adding && (
        <FactForm
          onSaved={() => {
            setAdding(false);
            void reload();
          }}
          onCancel={() => setAdding(false)}
        />
      )}

      {facts.length === 0 ? (
        <p className="rounded-lg border border-dashed bg-muted/30 px-4 py-10 text-center text-sm text-muted-foreground">
          Пока нет сохранённых фактов.
          <br />
          Агент будет сохранять их по ходу общения.
        </p>
      ) : (
        <ul className="space-y-2">
          {facts.map((fact) =>
            editingId === fact.id ? (
              <li key={fact.id}>
                <FactForm
                  initial={fact}
                  onSaved={() => {
                    setEditingId(null);
                    void reload();
                  }}
                  onCancel={() => setEditingId(null)}
                />
              </li>
            ) : (
              <FactRow
                key={fact.id}
                fact={fact}
                onEdit={() => setEditingId(fact.id)}
                onDelete={() => void handleDelete(fact.id)}
              />
            ),
          )}
        </ul>
      )}
    </section>
  );
}

function FactRow({
  fact,
  onEdit,
  onDelete,
}: {
  fact: UserFact;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [confirm, setConfirm] = useState(false);
  return (
    <li className="flex items-start gap-3 rounded-lg border bg-card p-3">
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-sm">{fact.text}</p>
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span className="rounded-full bg-muted px-2 py-0.5">
            {CATEGORY_LABELS[fact.category]}
          </span>
          <span>{new Date(fact.createdAt).toLocaleString("ru-RU")}</span>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          aria-label="Редактировать"
          onClick={onEdit}
          className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <PencilIcon className="size-4" />
        </button>
        {confirm ? (
          <span className="flex items-center gap-1">
            <button
              type="button"
              onClick={onDelete}
              className="rounded px-1.5 py-1 text-[11px] text-destructive hover:bg-destructive/10"
            >
              Удалить
            </button>
            <button
              type="button"
              onClick={() => setConfirm(false)}
              className="rounded px-1.5 py-1 text-[11px] text-muted-foreground hover:bg-muted"
            >
              Нет
            </button>
          </span>
        ) : (
          <button
            type="button"
            aria-label="Удалить"
            onClick={() => setConfirm(true)}
            className="rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          >
            <Trash2Icon className="size-4" />
          </button>
        )}
      </div>
    </li>
  );
}

function FactForm({
  initial,
  onSaved,
  onCancel,
}: {
  initial?: UserFact;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(initial?.text ?? "");
  const [category, setCategory] = useState<FactCategory>(
    initial?.category ?? "other",
  );
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    if (!text.trim()) {
      setErr("Введите текст факта");
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      const res = initial
        ? await fetch(`/api/facts/${encodeURIComponent(initial.id)}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: text.trim(), category }),
          })
        : await fetch("/api/facts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: text.trim(), category }),
          });
      if (res.ok) {
        onSaved();
      } else {
        const data = await res.json().catch(() => ({}));
        setErr(data.error ?? "Не удалось сохранить");
      }
    } catch {
      setErr("Сеть недоступна");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3 rounded-lg border bg-card p-3">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={2}
        placeholder="Например: Пользователя зовут Юрий"
        className="w-full resize-none rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
      />
      <div className="flex items-center gap-2">
        <label className="text-xs text-muted-foreground">Категория</label>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value as FactCategory)}
          className="rounded-md border bg-background px-2 py-1 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABELS[c]}
            </option>
          ))}
        </select>
      </div>
      {err && <p className="text-xs text-destructive">{err}</p>}
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          onClick={submit}
          disabled={saving}
        >
          {saving ? (
            <LoaderIcon className="size-4 animate-spin" />
          ) : (
            <SaveIcon className="size-4" />
          )}
          Сохранить
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={onCancel}
          disabled={saving}
        >
          <XIcon className="size-4" />
          Отмена
        </Button>
      </div>
    </div>
  );
}

// ── Характер ────────────────────────────────────────────────────────────────

function CharacterSection() {
  const { accent, setAccent } = useTheme();
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [preset, setPreset] = useState<string>(DEFAULT_PRESET_ID);
  const [customPrompt, setCustomPrompt] = useState<string>("");
  const [model, setModel] = useState<string>("");
  const [temperature, setTemperature] = useState<string>("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/settings");
        if (res.ok) {
          const data = await res.json();
          const s = data.settings as UserSettings;
          setSettings(s);
          setPreset(s.preset ?? DEFAULT_PRESET_ID);
          setCustomPrompt(s.customPrompt ?? "");
          setModel(s.model ?? "");
          setTemperature(s.temperature != null ? String(s.temperature) : "");
        } else {
          setSettings({
            preset: DEFAULT_PRESET_ID,
            customPrompt: "",
            model: "",
            temperature: null,
            updatedAt: 0,
          });
        }
      } catch {
        setSettings({
          preset: DEFAULT_PRESET_ID,
          customPrompt: "",
          model: "",
          temperature: null,
          updatedAt: 0,
        });
      }
    })();
    return () => {
      if (flashTimer.current) clearTimeout(flashTimer.current);
    };
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setErr(null);
    try {
      const body: Record<string, unknown> = { preset, customPrompt, model };
      if (temperature === "") {
        body.temperature = null;
      } else {
        const t = parseFloat(temperature);
        body.temperature = isNaN(t) ? null : t;
      }
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const data = await res.json();
        const s = data.settings as UserSettings;
        setSettings(s);
        setDirty(false);
        setSavedFlash(true);
        if (flashTimer.current) clearTimeout(flashTimer.current);
        flashTimer.current = setTimeout(() => setSavedFlash(false), 2000);
      } else {
        const data = await res.json().catch(() => ({}));
        setErr(data.error ?? "Не удалось сохранить");
      }
    } catch {
      setErr("Сеть недоступна");
    } finally {
      setSaving(false);
    }
  };

  if (settings === null) {
    return (
      <div className="flex items-center justify-center py-16">
        <LoaderIcon className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <section className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">Характер агента</h2>
        <p className="text-sm text-muted-foreground">
          Выберите готовый режим или дополните поведение своим промптом.
          Изменения применятся к новым ответам агента.
        </p>
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-semibold">Пресеты</h3>
        <div className="grid gap-2 sm:grid-cols-2">
          {CHARACTER_PRESETS.map((p) => {
            const active = p.id === preset;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  setPreset(p.id);
                  setDirty(true);
                }}
                className={cn(
                  "flex flex-col items-start gap-1 rounded-xl border p-3 text-left transition-colors",
                  active
                    ? "border-primary bg-primary/5 ring-1 ring-primary"
                    : "hover:bg-accent",
                )}
              >
                <span className="flex items-center gap-2">
                  <span className="font-medium text-sm">{p.name}</span>
                  {active && <CheckIcon className="size-4 text-primary" />}
                </span>
                <span className="text-xs text-muted-foreground">
                  {p.description}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold">Свой промпт</h3>
        <p className="text-xs text-muted-foreground">
          Дополнение к системной инструкции. Например: «Отвечай коротко,
          без эмодзи, приведи пример из жизни».
        </p>
        <textarea
          value={customPrompt}
          onChange={(e) => {
            setCustomPrompt(e.target.value);
            setDirty(true);
          }}
          rows={5}
          placeholder="Введите дополнительную инструкцию для агента…"
          className="w-full resize-y rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold">Модель</h3>
        <select
          value={model}
          onChange={(e) => {
            setModel(e.target.value);
            setDirty(true);
          }}
          className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          {AVAILABLE_MODELS.map((m) => (
            <option key={m.id} value={m.id}>{m.label}</option>
          ))}
        </select>
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold">Temperature</h3>
        <p className="text-xs text-muted-foreground">0.0 — строго, 2.0 — креативно. Оставьте пустым для значения по умолчанию.</p>
        <input
          type="number"
          value={temperature}
          onChange={(e) => {
            setTemperature(e.target.value);
            setDirty(true);
          }}
          step="0.1"
          min="0"
          max="2"
          placeholder="По умолчанию"
          className="w-32 rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
      </div>

      {err && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {err}
        </div>
      )}

      <div className="flex items-center gap-3">
        <Button
          type="button"
          onClick={handleSave}
          disabled={!dirty || saving}
        >
          {saving ? (
            <LoaderIcon className="size-4 animate-spin" />
          ) : (
            <SaveIcon className="size-4" />
          )}
          Сохранить
        </Button>
        {savedFlash && (
          <span className="flex items-center gap-1 text-xs text-green-600">
            <CheckIcon className="size-3.5" />
            Сохранено
          </span>
        )}
        {dirty && !savedFlash && (
          <span className="text-xs text-muted-foreground">
            Есть несохранённые изменения
          </span>
        )}
      </div>

      <hr className="border-border" />

      <div className="space-y-3">
        <h3 className="text-sm font-semibold">Цвет акцента</h3>
        <div className="flex flex-wrap gap-2">
          {ACCENT_COLORS.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setAccent(c.id)}
              className={cn(
                "flex size-8 items-center justify-center rounded-full border-2 transition-all",
                accent === c.id
                  ? "border-foreground scale-110"
                  : "border-transparent hover:scale-105",
              )}
              style={{ backgroundColor: `oklch(0.6 0.15 ${c.hue})` }}
              title={c.label}
            >
              {accent === c.id && (
                <CheckIcon className="size-4 text-white" />
              )}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          Цвет акцента сохраняется локально и влияет на кольцо фокуса, градиент агента и другие элементы.
        </p>
      </div>
    </section>
  );
}

// ── Журнал действий ──────────────────────────────────────────────────────────

function LogSection() {
  const [log, setLog] = useState<Action[]>(() => getLog());

  const handleClear = () => {
    clearLog();
    setLog([]);
  };

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">Журнал действий</h2>
          <p className="text-sm text-muted-foreground">
            Последние 50 действий. Очищается автоматически.
          </p>
        </div>
        {log.length > 0 && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleClear}
          >
            <Trash2Icon className="size-4" />
            Очистить
          </Button>
        )}
      </div>

      {log.length === 0 ? (
        <p className="rounded-lg border border-dashed bg-muted/30 px-4 py-10 text-center text-sm text-muted-foreground">
          Журнал пуст. Действия будут появляться здесь по мере использования.
        </p>
      ) : (
        <ul className="space-y-1">
          {log.map((action) => (
            <li
              key={action.id}
              className="flex items-center justify-between rounded-lg border bg-card px-3 py-2 text-sm"
            >
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <HistoryIcon className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{action.detail}</span>
              </div>
              <span className="ml-2 shrink-0 text-[11px] text-muted-foreground">
                {new Date(action.ts).toLocaleString("ru-RU", {
                  day: "numeric",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
