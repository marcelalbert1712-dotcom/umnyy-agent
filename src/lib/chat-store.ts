import { useCallback, useEffect, useRef, useState } from "react";
import type { UIMessage } from "ai";

export type ChatMeta = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  pinned?: boolean;
  archived?: boolean;
  folder?: string;
};

export function useChatStore() {
  const [chats, setChats] = useState<ChatMeta[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messagesById, setMessagesById] = useState<Record<string, UIMessage[]>>(
    {},
  );
  const [loaded, setLoaded] = useState(false);

  // Refs для стабильных колбэков (без зависимостей)
  const chatsRef = useRef(chats);
  chatsRef.current = chats;
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;
  const messagesByIdRef = useRef(messagesById);
  messagesByIdRef.current = messagesById;
  const loadingRef = useRef<Set<string>>(new Set());
  const creatingRef = useRef(false);

  // Загрузка списка чатов с сервера при монтировании
  useEffect(() => {
    if (loaded) return;
    (async () => {
      try {
        const res = await fetch("/api/chats");
        if (res.ok) {
          const data = await res.json();
          setChats(data.chats ?? []);
        }
      } catch {
        /* сеть недоступна */
      }
      setLoaded(true);
    })();
  }, [loaded]);

  // Авто-выбор первого чата или создание нового
  useEffect(() => {
    if (!loaded) return;
    if (chats.length === 0 && !activeId && !creatingRef.current) {
      creatingRef.current = true;
      void createChat().finally(() => {
        creatingRef.current = false;
      });
    } else if (chats.length > 0 && !activeId) {
      void selectChat(chats[0].id);
    }
  }, [loaded, chats, activeId]);

  const selectChat = useCallback(async (id: string): Promise<void> => {
    setActiveId(id);
    if (loadingRef.current.has(id)) return;
    if (messagesByIdRef.current[id] !== undefined) return;
    loadingRef.current.add(id);
    try {
      const res = await fetch(`/api/chats/${encodeURIComponent(id)}`);
      if (res.ok) {
        const data = await res.json();
        setMessagesById((prev) => ({
          ...prev,
          [id]: data.messages ?? [],
        }));
      } else {
        setMessagesById((prev) => ({ ...prev, [id]: [] }));
      }
    } catch {
      setMessagesById((prev) => ({ ...prev, [id]: [] }));
    } finally {
      loadingRef.current.delete(id);
    }
  }, []);

  const createChat = useCallback(async (): Promise<string | null> => {
    try {
      const res = await fetch("/api/chats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) return null;
      const data = await res.json();
      const chat = data.chat as ChatMeta;
      setChats((prev) => [chat, ...prev]);
      setMessagesById((prev) => ({ ...prev, [chat.id]: [] }));
      setActiveId(chat.id);
      return chat.id;
    } catch {
      return null;
    }
  }, []);

  const deleteChat = useCallback(
    async (id: string): Promise<void> => {
      try {
        await fetch(`/api/chats/${encodeURIComponent(id)}`, {
          method: "DELETE",
        });
      } catch {
        /* ignore */
      }
      setMessagesById((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      const remaining = chatsRef.current.filter((c) => c.id !== id);
      setChats(remaining);
      if (activeIdRef.current === id) {
        if (remaining[0]) {
          void selectChat(remaining[0].id);
        } else {
          setActiveId(null);
        }
      }
    },
    [selectChat],
  );

  const saveMessages = useCallback(
    async (id: string, messages: UIMessage[]): Promise<void> => {
      setMessagesById((prev) => ({ ...prev, [id]: messages }));
      try {
        const res = await fetch(`/api/chats/${encodeURIComponent(id)}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages }),
        });
        if (res.ok) {
          const data = await res.json();
          const meta = data.chat as ChatMeta;
          setChats((prev) =>
            prev
              .map((c) => (c.id === id ? meta : c))
              .sort((a, b) => {
                if (a.pinned && !b.pinned) return -1;
                if (!a.pinned && b.pinned) return 1;
                return b.updatedAt - a.updatedAt;
              }),
          );
        }
      } catch {
        /* сеть недоступна — локальная копия сохранится при следующем запросе */
      }
    },
    [],
  );

  const archiveChat = useCallback(async (id: string): Promise<void> => {
    const chat = chatsRef.current.find((c) => c.id === id);
    if (!chat) return;
    const nextArchived = !chat.archived;
    setChats((prev) =>
      prev.map((c) => (c.id === id ? { ...c, archived: nextArchived } : c)),
    );
    try {
      await fetch(`/api/chats/${encodeURIComponent(id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived: nextArchived }),
      });
    } catch { /* ignore */ }
  }, []);

  const pinChat = useCallback(async (id: string): Promise<void> => {
    const chat = chatsRef.current.find((c) => c.id === id);
    if (!chat) return;
    const nextPinned = !chat.pinned;
    setChats((prev) =>
      prev.map((c) => (c.id === id ? { ...c, pinned: nextPinned } : c)),
    );
    try {
      await fetch(`/api/chats/${encodeURIComponent(id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pinned: nextPinned }),
      });
    } catch {
      /* ignore */
    }
  }, []);

  const setChatFolder = useCallback(
    async (id: string, folder: string | null): Promise<void> => {
      setChats((prev) =>
        prev.map((c) => (c.id === id ? { ...c, folder: folder ?? undefined } : c)),
      );
      try {
        await fetch(`/api/chats/${encodeURIComponent(id)}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ folder }),
        });
      } catch { /* ignore */ }
    },
    [],
  );

  const renameChat = useCallback(
    async (id: string, title: string): Promise<void> => {
      setChats((prev) =>
        prev.map((c) => (c.id === id ? { ...c, title } : c)),
      );
      try {
        await fetch(`/api/chats/${encodeURIComponent(id)}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title }),
        });
      } catch {
        /* ignore */
      }
    },
    [],
  );

  const getMessages = useCallback(
    (id: string): UIMessage[] => messagesById[id] ?? [],
    [messagesById],
  );

  const isLoaded = useCallback(
    (id: string): boolean => messagesById[id] !== undefined,
    [messagesById],
  );

  return {
    loaded,
    chats,
    activeId,
    selectChat,
    createChat,
    deleteChat,
    saveMessages,
    renameChat,
    pinChat,
    archiveChat,
    setChatFolder,
    getMessages,
    isLoaded,
  };
}

export type ChatStoreApi = ReturnType<typeof useChatStore>;
