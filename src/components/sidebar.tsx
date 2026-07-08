"use client";

import { useRef, useState, useMemo, useEffect } from "react";
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  MessageSquarePlusIcon,
  MessageSquareIcon,
  Trash2Icon,
  PencilIcon,
  PinIcon,
  PanelLeftCloseIcon,
  PanelLeftIcon,
  SettingsIcon,
  SearchIcon,
  SunIcon,
  MoonIcon,
  XIcon,
  FolderIcon,
  FolderPlusIcon,
  FolderOpenIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/lib/theme";
import type { ChatMeta } from "@/lib/chat-store";
import type { UIMessage } from "ai";
import { Logo } from "@/components/logo";
import { CHAT_TEMPLATES } from "@/lib/presets";

export type FolderDef = { id: string; name: string };

export type SidebarProps = {
  chats: ChatMeta[];
  activeId: string | null;
  collapsed: boolean;
  adminActive?: boolean;
  mobile?: boolean;
  onCloseMobile?: () => void;
  onToggleCollapse: () => void;
  onCreate: () => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onPinChat: (id: string) => void;
  onArchiveChat?: (id: string) => void;
  onOpenAdmin: () => void;
  getMessages?: (id: string) => UIMessage[];
  setChatFolder?: (id: string, folder: string | null) => void;
};

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "только что";
  if (min < 60) return `${min} мин назад`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} ч назад`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d} дн назад`;
  return new Date(ts).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "short",
  });
}

export function Sidebar({
  chats,
  activeId,
  collapsed,
  adminActive,
  mobile,
  onCloseMobile,
  onToggleCollapse,
  onCreate,
  onSelect,
  onDelete,
  onRename,
  onPinChat,
  onArchiveChat,
  onOpenAdmin,
  getMessages,
  setChatFolder,
}: SidebarProps) {
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [showTemplates, setShowTemplates] = useState(false);
  const [folders, setFolders] = useState<FolderDef[]>([]);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [folderMenuChat, setFolderMenuChat] = useState<string | null>(null);
  const [newFolderName, setNewFolderName] = useState("");
  const [showNewFolder, setShowNewFolder] = useState(false);
  const editRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Загрузка папок из настроек
  useEffect(() => {
    fetch("/api/settings").then((r) => r.json()).then((data) => {
      if (data?.settings?.folders) setFolders(data.settings.folders);
    }).catch(() => {});
  }, []);

  const saveFolders = async (next: FolderDef[]) => {
    setFolders(next);
    await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folders: next }),
    }).catch(() => {});
  };

  const genFolderId = () => `f_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

  const renderChatItem = (chat: ChatMeta) => {
    const active = chat.id === activeId;
    const archived = chat.archived === true;
    return (
      <div key={chat.id}>
        <div
          className={cn(
            "group relative flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-sm transition-colors",
            active
              ? "bg-accent text-accent-foreground"
              : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
            chat.pinned && "border-l-2 border-primary/40 pl-[7px]",
            archived && "opacity-60",
          )}
          onClick={() => onSelect(chat.id)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onSelect(chat.id);
            }
          }}
        >
          <MessageSquareIcon className="size-4 shrink-0 opacity-70" />
          <span className="flex min-w-0 flex-1 flex-col">
            {editingId === chat.id ? (
              <input
                ref={editRef}
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onBlur={submitRename}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submitRename();
                  if (e.key === "Escape") setEditingId(null);
                  e.stopPropagation();
                }}
                onClick={(e) => e.stopPropagation()}
                className="h-5 w-full rounded bg-accent px-1 text-sm font-medium outline-none ring-1 ring-primary"
              />
            ) : (
              <span
                className="truncate font-medium"
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  startRename(chat);
                }}
              >
                {chat.pinned && "📌 "}{chat.title}
              </span>
            )}
            <span className="truncate text-[10px] text-muted-foreground/80">
              {timeAgo(chat.updatedAt)}
            </span>
          </span>
          {confirmId === chat.id ? (
            <span className="flex shrink-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
              <button type="button" className="rounded px-1 text-[10px] text-destructive hover:bg-destructive/10"
                onClick={() => { onDelete(chat.id); setConfirmId(null); }}>
                Удалить
              </button>
              <button type="button" className="rounded px-1 text-[10px] text-muted-foreground hover:bg-muted"
                onClick={() => setConfirmId(null)}>
                Отмена
              </button>
            </span>
          ) : (
            <span className="flex shrink-0 items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
              {/* Кнопка выбора папки (только для не-архивных) */}
              {setChatFolder && !archived && (
                <div className="relative">
                  <button type="button"
                    className="rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover:opacity-100"
                    aria-label="Папка"
                    title="Переместить в папку"
                    onClick={(e) => { e.stopPropagation(); setFolderMenuChat(folderMenuChat === chat.id ? null : chat.id); }}
                  >
                    <FolderIcon className="size-3.5" />
                  </button>
                  {folderMenuChat === chat.id && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setFolderMenuChat(null)} />
                      <div className="absolute left-0 top-full z-50 mt-1 w-40 rounded-lg border bg-card py-1 shadow-lg">
                        <button type="button"
                          className="flex w-full items-center gap-2 px-3 py-1.5 text-xs hover:bg-accent"
                          onClick={() => { setChatFolder(chat.id, null); setFolderMenuChat(null); }}>
                          Без папки
                        </button>
                        {folders.map((f) => (
                          <button key={f.id} type="button"
                            className={cn(
                              "flex w-full items-center gap-2 px-3 py-1.5 text-xs hover:bg-accent",
                              chat.folder === f.id && "bg-accent font-medium",
                            )}
                            onClick={() => { setChatFolder(chat.id, f.id); setFolderMenuChat(null); }}>
                            <FolderIcon className="size-3" />
                            {f.name}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}
              <button type="button"
                className={cn("rounded p-1 opacity-0 transition-opacity hover:bg-accent group-hover:opacity-100",
                  chat.pinned ? "text-primary opacity-100" : "text-muted-foreground hover:text-foreground")}
                aria-label={chat.pinned ? "Открепить" : "Закрепить"} title={chat.pinned ? "Открепить" : "Закрепить"}
                onClick={() => onPinChat(chat.id)}>
                <PinIcon className="size-3.5" />
              </button>
              <button type="button"
                className="rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover:opacity-100"
                aria-label="Переименовать" title="Переименовать"
                onClick={() => startRename(chat)}>
                <PencilIcon className="size-3.5" />
              </button>
              {archived ? (
                <>
                  {onArchiveChat && (
                    <button type="button"
                      className="rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover:opacity-100"
                      aria-label="Восстановить" title="Восстановить"
                      onClick={() => onArchiveChat(chat.id)}>
                      <ArchiveRestoreIcon className="size-3.5" />
                    </button>
                  )}
                  <button type="button"
                    className="rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                    aria-label="Удалить чат" title="Удалить чат"
                    onClick={() => setConfirmId(chat.id)}>
                    <Trash2Icon className="size-3.5" />
                  </button>
                </>
              ) : (
                onArchiveChat && (
                  <button type="button"
                    className="rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover:opacity-100"
                    aria-label="В архив" title="В архив"
                    onClick={() => onArchiveChat(chat.id)}>
                    <ArchiveIcon className="size-3.5" />
                  </button>
                )
              )}
            </span>
          )}
        </div>
      </div>
    );
  };

  const filteredChats = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    let list = chats;
    if (q) {
      list = chats.filter((c) => {
        if (c.title.toLowerCase().includes(q)) return true;
        if (!getMessages) return false;
        const msgs = getMessages(c.id);
        return msgs.some((m) =>
          m.parts.some(
            (p) => p.type === "text" && p.text.toLowerCase().includes(q),
          ),
        );
      });
    }
    return [...list].sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      return b.updatedAt - a.updatedAt;
    });
  }, [chats, searchQuery, getMessages]);

  const activeChats = useMemo(() => filteredChats.filter((c) => !c.archived), [filteredChats]);
  const archivedChats = useMemo(() => filteredChats.filter((c) => c.archived), [filteredChats]);
  const [showArchived, setShowArchived] = useState(false);

  function getDateGroup(ts: number): string {
    const now = new Date();
    const d = new Date(ts);
    const startOfDay = (dt: Date) => new Date(dt.getFullYear(), dt.getMonth(), dt.getDate()).getTime();
    const todayStart = startOfDay(now);
    const msgStart = startOfDay(d);
    const diffDays = Math.floor((todayStart - msgStart) / 86400000);
    if (diffDays === 0) return "Сегодня";
    if (diffDays === 1) return "Вчера";
    if (diffDays < 7) return "На этой неделе";
    return "Ранее";
  }

  const { folderGroups, ungroupedChats } = useMemo(() => {
    const folderMap: Record<string, ChatMeta[]> = {};
    const noFolder: ChatMeta[] = [];
    for (const chat of activeChats) {
      if (chat.folder && folders.some((f) => f.id === chat.folder)) {
        (folderMap[chat.folder] ??= []).push(chat);
      } else {
        noFolder.push(chat);
      }
    }
    const fg = folders
      .filter((f) => folderMap[f.id])
      .map((f) => ({ folder: f, chats: folderMap[f.id] }));
    return { folderGroups: fg, ungroupedChats: noFolder };
  }, [filteredChats, folders]);

  const groupedChats = useMemo(() => {
    const groups: Record<string, ChatMeta[]> = {};
    for (const chat of ungroupedChats) {
      const key = getDateGroup(chat.updatedAt);
      (groups[key] ??= []).push(chat);
    }
    const order = ["Сегодня", "Вчера", "На этой неделе", "Ранее"];
    return order.filter((k) => groups[k]).map((k) => ({ label: k, chats: groups[k] }));
  }, [ungroupedChats]);

  const startRename = (chat: ChatMeta) => {
    setEditingId(chat.id);
    setEditValue(chat.title);
    requestAnimationFrame(() => editRef.current?.select());
  };

  const { theme, toggle: toggleTheme } = useTheme();

  const submitRename = () => {
    if (!editingId) return;
    const val = editValue.trim();
    if (val && val !== chats.find((c) => c.id === editingId)?.title) {
      onRename(editingId, val);
    }
    setEditingId(null);
  };

  const handleCreateWithTemplate = async (template: typeof CHAT_TEMPLATES[number]) => {
    setShowTemplates(false);
    if (template.systemPrompt) {
      try {
        await fetch("/api/settings", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ customPrompt: template.systemPrompt }),
        });
      } catch { /* ignore */ }
    }
    onCreate();
  };

  if (collapsed && !mobile) {
    return (
      <aside className="flex h-full w-14 shrink-0 flex-col items-center gap-2 border-r bg-card py-3">
        <div className="flex size-9 items-center justify-center rounded-lg">
          <Logo size="sm" showTagline={false} />
        </div>
        <Button
          variant="ghost"
          size="icon"
          type="button"
          onClick={onToggleCollapse}
            aria-label="Развернуть панель"
            title="Развернуть панель"
            className="mt-1"
        >
          <PanelLeftIcon className="size-5" />
        </Button>
        <div className="relative">
          <Button
            variant="ghost"
            size="icon"
            type="button"
            onClick={() => setShowTemplates((v) => !v)}
            aria-label="Новый чат"
            title="Новый чат"
          >
            <MessageSquarePlusIcon className="size-5" />
          </Button>
          {showTemplates && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowTemplates(false)} />
              <div className="absolute left-full top-0 z-50 ml-1 w-48 space-y-0.5 rounded-lg border bg-card py-1 shadow-lg">
                {CHAT_TEMPLATES.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => handleCreateWithTemplate(t)}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent"
                  >
                    <span className="text-base">{t.icon}</span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="font-medium">{t.name}</span>
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        <div className="mt-auto flex flex-col items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            type="button"
            onClick={toggleTheme}
            aria-label={theme === "dark" ? "Светлая тема" : "Тёмная тема"}
            title={theme === "dark" ? "Светлая тема" : "Тёмная тема"}
          >
            {theme === "dark" ? <SunIcon className="size-5" /> : <MoonIcon className="size-5" />}
          </Button>
          <Button
            variant={adminActive ? "secondary" : "ghost"}
            size="icon"
            type="button"
            onClick={onOpenAdmin}
            aria-label="Админка"
            title="Админка"
          >
            <SettingsIcon className="size-5" />
          </Button>
        </div>
      </aside>
    );
  }

  return (
    <aside className={cn("flex w-72 shrink-0 flex-col border-r bg-card", mobile ? "h-screen" : "h-full")}>
      <div className="flex h-14 shrink-0 items-center justify-between px-3">
        <div className="flex items-center gap-2">
          <Logo size="sm" showTagline={false} />
          <span className="font-semibold text-sm">Cabin Boy</span>
        </div>
        <div className="flex items-center gap-1">
          {mobile && onCloseMobile && (
            <button
              type="button"
              onClick={onCloseMobile}
              className="flex size-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent"
              aria-label="Закрыть"
              title="Закрыть"
            >
              <XIcon className="size-4" />
            </button>
          )}
          {!mobile && (
            <Button
              variant="ghost"
              size="icon-sm"
              type="button"
              onClick={onToggleCollapse}
              aria-label="Свернуть панель"
              title="Свернуть панель"
            >
              <PanelLeftCloseIcon className="size-4" />
            </Button>
          )}
        </div>
      </div>

      <div className="relative px-3 pb-2">
        <Button
          variant="outline"
          type="button"
          onClick={() => setShowTemplates((v) => !v)}
          className="w-full justify-start gap-2"
        >
          <MessageSquarePlusIcon className="size-4" />
          Новый чат
        </Button>
        {showTemplates && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setShowTemplates(false)} />
            <div className="absolute left-3 right-3 top-full z-50 mt-1 space-y-0.5 rounded-lg border bg-card py-1 shadow-lg">
              {CHAT_TEMPLATES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => handleCreateWithTemplate(t)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent"
                >
                  <span className="text-base">{t.icon}</span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="font-medium">{t.name}</span>
                    <span className="truncate text-[11px] text-muted-foreground">
                      {t.description}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="px-3 pb-2">
        <div className="relative">
          <SearchIcon className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            ref={searchRef}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") { setSearchQuery(""); searchRef.current?.blur(); }
            }}
            placeholder="Поиск чатов и сообщений…"
            className="h-8 w-full rounded-lg border border-border bg-background pl-8 pr-3 text-xs outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {(searchQuery ? filteredChats.length === 0 : activeChats.length === 0 && archivedChats.length === 0) ? (
          <p className="px-2 py-8 text-center text-xs text-muted-foreground">
            {searchQuery ? "Ничего не найдено." : "Нет чатов.\nНажмите «Новый чат»."}
          </p>
        ) : (
          <ul className="space-y-0.5">

            {/* Секция создания папки */}
            {setChatFolder && !searchQuery && (
              <li className="px-2.5 py-1">
                {showNewFolder ? (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const name = newFolderName.trim();
                      if (name) {
                        const id = genFolderId();
                        saveFolders([...folders, { id, name }]);
                        setExpandedFolders(new Set([...expandedFolders, id]));
                      }
                      setNewFolderName("");
                      setShowNewFolder(false);
                    }}
                    className="flex gap-1"
                  >
                    <input
                      autoFocus
                      value={newFolderName}
                      onChange={(e) => setNewFolderName(e.target.value)}
                      onBlur={() => { setShowNewFolder(false); setNewFolderName(""); }}
                      placeholder="Название папки"
                      className="h-7 flex-1 rounded border bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-primary"
                    />
                  </form>
                ) : (
                  <button
                    type="button"
                    onClick={() => setShowNewFolder(true)}
                    className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground"
                  >
                    <FolderPlusIcon className="size-3.5" />
                    Создать папку
                  </button>
                )}
              </li>
            )}

            {/* Папки */}
            {setChatFolder && folderGroups.map((fg) => {
              const expanded = expandedFolders.has(fg.folder.id);
              return (
                <li key={fg.folder.id} className="space-y-0.5">
                  <div
                    className="group flex cursor-pointer items-center gap-1 px-2.5 py-1 text-xs font-semibold text-muted-foreground/70 hover:text-foreground"
                    onClick={() => {
                      const next = new Set(expandedFolders);
                      if (expanded) next.delete(fg.folder.id);
                      else next.add(fg.folder.id);
                      setExpandedFolders(next);
                    }}
                  >
                    {expanded ? <FolderOpenIcon className="size-3.5" /> : <FolderIcon className="size-3.5" />}
                    <span className="flex-1 truncate">{fg.folder.name}</span>
                    <button
                      type="button"
                      className="hidden rounded p-0.5 text-muted-foreground hover:bg-accent group-hover:block"
                      onClick={(e) => {
                        e.stopPropagation();
                        const next = folders.filter((f) => f.id !== fg.folder.id);
                        saveFolders(next);
                        // Убрать папку у чатов
                        fg.chats.forEach((c) => setChatFolder?.(c.id, null));
                      }}
                      title="Удалить папку"
                    >
                      <Trash2Icon className="size-3" />
                    </button>
                  </div>
                  {expanded && fg.chats.map((chat) => renderChatItem(chat))}
                </li>
              );
            })}

            {/* Чаты без папки (по датам) */}
            {groupedChats.map((group) => (
              <li key={group.label} className="space-y-0.5">
                <div className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                  {group.label}
                </div>
                {group.chats.map((chat) => renderChatItem(chat))}
              </li>
            ))}

            {/* Архив */}
            {archivedChats.length > 0 && (
              <li className="space-y-0.5">
                <div
                  className="group flex cursor-pointer items-center gap-1 px-2.5 py-1 text-xs font-semibold text-muted-foreground/70 hover:text-foreground"
                  onClick={() => setShowArchived((v) => !v)}
                >
                  <ArchiveIcon className="size-3.5" />
                  <span className="flex-1 truncate">Архив ({archivedChats.length})</span>
                </div>
                {showArchived && archivedChats.map((chat) => renderChatItem(chat))}
              </li>
            )}
          </ul>
        )}
      </div>

      <div className="shrink-0 border-t p-3">
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant={adminActive ? "secondary" : "outline"}
            onClick={onOpenAdmin}
            className="flex-1 justify-start gap-2"
          >
            <SettingsIcon className="size-4" />
            Админка
          </Button>
          <Button
            variant="ghost"
            size="icon"
            type="button"
            onClick={toggleTheme}
            aria-label={theme === "dark" ? "Светлая тема" : "Тёмная тема"}
            title={theme === "dark" ? "Светлая тема" : "Тёмная тема"}
          >
            {theme === "dark" ? <SunIcon className="size-4" /> : <MoonIcon className="size-4" />}
          </Button>
        </div>
      </div>
    </aside>
  );
}
