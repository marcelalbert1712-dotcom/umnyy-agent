import type { UIMessage } from "ai";

function getMessageText(message: UIMessage): string {
  return message.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("");
}

export function messagesToMarkdown(messages: UIMessage[]): string {
  return messages
    .map((msg) => {
      const role = msg.role === "user" ? "Пользователь" : "Ассистент";
      const text = getMessageText(msg);
      return `**${role}:** ${text}`;
    })
    .join("\n\n");
}

export function messagesToText(messages: UIMessage[]): string {
  return messages
    .map((msg) => {
      const role = msg.role === "user" ? "Пользователь" : "Ассистент";
      const text = getMessageText(msg);
      return `${role}: ${text}`;
    })
    .join("\n\n");
}

export function messagesToHtml(messages: UIMessage[], title: string): string {
  const items = messages
    .map((msg) => {
      const role = msg.role === "user" ? "Пользователь" : "Ассистент";
      const text = getMessageText(msg);
      const isUser = msg.role === "user";
      return `<div style="margin-bottom:1.25rem;${isUser ? "text-align:right" : ""}">
        <div style="display:inline-block;max-width:80%;text-align:left;
          background:${isUser ? "#e5e7eb" : "#f3f4f6"};
          border-radius:12px;padding:0.75rem 1rem;">
          <div style="font-size:0.75rem;font-weight:600;color:#6b7280;margin-bottom:0.25rem;">${role}</div>
          <div style="white-space:pre-wrap;line-height:1.6;">${escapeHtml(text)}</div>
        </div>
      </div>`;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<title>${escapeHtml(title)}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
    font-size:14px;color:#111;background:#fff;padding:2rem;max-width:800px;margin:0 auto; }
  h1 { font-size:1.25rem;margin-bottom:2rem;color:#374151; }
  @media print { body { padding:0; } }
</style>
</head>
<body>
<h1>${escapeHtml(title)}</h1>
${items}
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function downloadBlob(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function downloadAsMarkdown(messages: UIMessage[], title: string) {
  const content = messagesToMarkdown(messages);
  const safe = title.replace(/[^a-zA-Zа-яА-Я0-9_-]/g, "_").substring(0, 50);
  downloadBlob(content, `${safe}.md`, "text/markdown;charset=utf-8");
}

export function downloadAsText(messages: UIMessage[], title: string) {
  const content = messagesToText(messages);
  const safe = title.replace(/[^a-zA-Zа-яА-Я0-9_-]/g, "_").substring(0, 50);
  downloadBlob(content, `${safe}.txt`, "text/plain;charset=utf-8");
}

export function openAsPdf(messages: UIMessage[], title: string) {
  const html = messagesToHtml(messages, title);
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const w = window.open(url);
  if (w) {
    w.onload = () => { w.print(); };
  } else {
    const a = document.createElement("a");
    a.href = url;
    a.download = `${title}.html`;
    a.click();
    a.remove();
  }
}

export function downloadAsJson(messages: UIMessage[], title: string) {
  const safe = title.replace(/[^a-zA-Zа-яА-Я0-9_-]/g, "_").substring(0, 50);
  const data = JSON.stringify({ title, messages, exportedAt: Date.now() }, null, 2);
  downloadBlob(data, `${safe}.json`, "application/json;charset=utf-8");
}

export function parseImportJson(file: File): Promise<{ title: string; messages: UIMessage[] } | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result as string);
        if (data && Array.isArray(data.messages)) {
          resolve({ title: data.title || "Импорт", messages: data.messages });
        } else {
          resolve(null);
        }
      } catch { resolve(null); }
    };
    reader.onerror = () => resolve(null);
    reader.readAsText(file);
  });
}
