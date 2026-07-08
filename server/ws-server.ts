import { WebSocketServer, WebSocket } from "ws";
import type { Plugin } from "vite";

const clients = new Map<string, Set<WebSocket>>();

export function broadcastToChat(chatId: string, data: object) {
  const set = clients.get(chatId);
  if (!set) return;
  const msg = JSON.stringify(data);
  for (const ws of set) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(msg);
    }
  }
}

export function wsPlugin(): Plugin {
  return {
    name: "ws-server",
    configureServer(server) {
      const wss = new WebSocketServer({ noServer: true });

      // Handle only WS upgrades on /ws path
      server.httpServer!.on("upgrade", (request, socket, head) => {
        const url = new URL(request.url ?? "/", "http://localhost");
        if (url.pathname === "/ws") {
          wss.handleUpgrade(request, socket, head, (ws) => {
            wss.emit("connection", ws, request);
          });
        }
      });

      wss.on("connection", (ws, req) => {
        const url = new URL(req.url ?? "/", "http://localhost");
        const chatId = url.searchParams.get("chatId") ?? "default";

        if (!clients.has(chatId)) clients.set(chatId, new Set());
        clients.get(chatId)!.add(ws);

        ws.on("close", () => {
          clients.get(chatId)?.delete(ws);
          if (clients.get(chatId)?.size === 0) clients.delete(chatId);
        });

        ws.send(JSON.stringify({ type: "connected", chatId }));
      });
    },
  };
}
