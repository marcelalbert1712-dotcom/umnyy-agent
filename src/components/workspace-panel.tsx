"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { FolderOpenIcon, FileIcon, DownloadIcon, Trash2Icon, ExternalLinkIcon } from "lucide-react";

type FileEntry = {
  name: string;
  size: number;
  modifiedAt: number;
  chatId: string;
};

export function WorkspacePanel({ chatId }: { chatId: string }) {
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [open, setOpen] = useState(false);
  const openOnce = useRef(false);

  const fetchFiles = useCallback(async () => {
    try {
      // Load all files from all chats
      const res = await fetch("/api/workspace-all");
      const data = await res.json();
      const list: FileEntry[] = data.files ?? [];
      setFiles(list);
      if (list.length > 0 && !openOnce.current) {
        openOnce.current = true;
        setOpen(true);
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    fetchFiles();
    const id = setInterval(fetchFiles, 4000);
    return () => clearInterval(id);
  }, [fetchFiles]);

  const handleDelete = async (file: FileEntry) => {
    try {
      await fetch(`/api/workspace/${encodeURIComponent(file.chatId)}/${encodeURIComponent(file.name)}`, { method: "DELETE" });
      setFiles((prev) => prev.filter((f) => f.name !== file.name || f.chatId !== file.chatId));
    } catch { /* ignore */ }
  };

  if (files.length === 0 && !open) return null;

  return (
    <div className="border-t">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground"
      >
        <FolderOpenIcon className="size-3.5" />
        <span className="flex-1 text-left">Файлы</span>
        {files.length > 0 && (
          <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px]">{files.length}</span>
        )}
      </button>
      {open && (
        <div className="space-y-0.5 px-2 pb-2 max-h-[200px] overflow-y-auto">
          {files.length === 0 ? (
            <p className="px-2 py-2 text-[10px] text-muted-foreground/60">Нет файлов</p>
          ) : (
            files.map((f) => {
              const ext = f.name.split(".").pop()?.toUpperCase();
              const fileUrl = `/api/workspace/${encodeURIComponent(f.chatId)}/${encodeURIComponent(f.name)}`;
              return (
                <div key={`${f.chatId}/${f.name}`} className="group flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs">
                  <FileIcon className="size-3 shrink-0 text-muted-foreground" />
                  <span className="flex-1 min-w-0 truncate text-muted-foreground">{f.name}</span>
                  {ext && <span className="shrink-0 rounded bg-muted px-1 text-[9px] text-muted-foreground">{ext}</span>}
                  <a href={fileUrl} target="_blank" rel="noopener noreferrer"
                    className="hidden rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground group-hover:block"
                    aria-label="Открыть" title="Открыть">
                    <ExternalLinkIcon className="size-3" />
                  </a>
                  <a href={fileUrl} download={f.name}
                    className="hidden rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground group-hover:block"
                    aria-label="Скачать" title="Скачать">
                    <DownloadIcon className="size-3" />
                  </a>
                  <button type="button" onClick={() => handleDelete(f)}
                    className="hidden rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground group-hover:block"
                    aria-label="Удалить" title="Удалить">
                    <Trash2Icon className="size-3" />
                  </button>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}