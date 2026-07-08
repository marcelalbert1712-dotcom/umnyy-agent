import { useState, useEffect } from "react";
import { MessageSquarePlusIcon, LoaderIcon, MenuIcon } from "lucide-react";

import { Sidebar } from "@/components/sidebar";
import { ChatPanel } from "@/components/chat-panel";
import { AdminPanel } from "@/components/admin-panel";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useChatStore } from "@/lib/chat-store";
import { Logo } from "@/components/logo";

function FullScreenLoader() {
  return (
    <div className="flex h-full w-full items-center justify-center bg-background">
      <LoaderIcon className="size-6 animate-spin text-muted-foreground" />
    </div>
  );
}

function App() {
  const {
    loaded,
    chats,
    activeId,
    selectChat,
    createChat,
    deleteChat,
    renameChat,
    pinChat,
    archiveChat,
    saveMessages,
    getMessages,
    isLoaded,
    setChatFolder,
  } = useChatStore();

  const [collapsed, setCollapsed] = useState(false);
  const [view, setView] = useState<"chat" | "admin">("chat");
  const [mobileMenu, setMobileMenu] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    setIsMobile(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const activeChat = chats.find((c) => c.id === activeId);
  const messagesReady = activeId != null && isLoaded(activeId);

  if (!loaded) {
    return <FullScreenLoader />;
  }

  const openAdmin = () => setView("admin");
  const backToChat = () => setView("chat");

  const closeMobile = () => setMobileMenu(false);

  return (
    <div className="flex h-full w-full overflow-hidden bg-background">
      {isMobile && mobileMenu && (
        <div className="fixed inset-0 z-40 bg-black/40" onClick={closeMobile} />
      )}
      <div className={cn(
        isMobile
          ? `fixed inset-y-0 left-0 z-50 transition-transform ${mobileMenu ? "translate-x-0" : "-translate-x-full"}`
          : "relative",
      )}>
        <Sidebar
          chats={chats}
          activeId={activeId}
          collapsed={isMobile ? false : collapsed}
          adminActive={view === "admin"}
          mobile={isMobile}
          onCloseMobile={closeMobile}
          onToggleCollapse={() => { if (!isMobile) setCollapsed((v) => !v); }}
          onCreate={() => {
            setView("chat");
            void createChat();
            closeMobile();
          }}
          onSelect={(id) => {
            setView("chat");
            void selectChat(id);
            closeMobile();
          }}
          onDelete={deleteChat}
          onRename={renameChat}
          onPinChat={pinChat}
          onArchiveChat={archiveChat}
          onOpenAdmin={() => { openAdmin(); closeMobile(); }}
          getMessages={getMessages}
          setChatFolder={setChatFolder}
        />
      </div>

      <main className="flex min-w-0 flex-1 flex-col">
        {isMobile && (
          <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3 md:hidden">
            <button
              type="button"
              onClick={() => setMobileMenu((v) => !v)}
              className="flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent"
              aria-label="Меню"
            >
              <MenuIcon className="size-5" />
            </button>
          </header>
        )}
        {view === "admin" ? (
          <AdminPanel onBack={backToChat} />
        ) : activeId && activeChat && messagesReady ? (
          <ChatPanel
            key={activeId}
            chatId={activeId}
            title={activeChat.title}
            initialMessages={getMessages(activeId)}
            onSaveMessages={saveMessages}
            onClearChat={(id) => saveMessages(id, [])}
          />
        ) : activeId ? (
          <div className="flex flex-1 items-center justify-center">
            <LoaderIcon className="size-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
            <Logo size="lg" />
            <div className="space-y-1">
              <h2 className="text-lg font-semibold">Нет активного чата</h2>
              <p className="text-sm text-muted-foreground">
                Создайте новый чат, чтобы начать общение.
              </p>
            </div>
            <Button type="button" onClick={() => { createChat(); closeMobile(); }}>
              <MessageSquarePlusIcon className="size-4" />
              Новый чат
            </Button>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
