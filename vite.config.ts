import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import { polzaaiChatPlugin } from "./server/polza-chat.ts";
import { chatsApiPlugin } from "./server/chats-api.ts";
import { adminApiPlugin } from "./server/admin-api.ts";
import { transcribeApiPlugin } from "./server/transcribe-api.ts";
import { evaluateConfidencePlugin } from "./server/evaluate-confidence.ts";
import { runCodePlugin } from "./server/run-code-api.ts";
import { tasksApiPlugin } from "./server/tasks-api.ts";
import { workspaceApiPlugin } from "./server/workspace-api.ts";
import { browserApiPlugin } from "./server/browser-api.ts";
import { summarizeApiPlugin } from "./server/summarize-api.ts";
import { wsPlugin } from "./server/ws-server.ts";
import { researchApiPlugin } from "./server/research-api.ts";
import { uploadApiPlugin } from "./server/upload-api.ts";
import { integrationsApiPlugin } from "./server/integrations-api.ts";
import { startTelegramPolling } from "./server/telegram-polling.ts";

// Предотвращаем тихий краш сервера при uncaughtException
process.on("uncaughtException", (err) => {
  console.error("[FATAL uncaughtException]", err.message, err.stack ?? "");
});
process.on("unhandledRejection", (err) => {
  console.error("[FATAL unhandledRejection]", err);
});

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Грузим .env в process.env, чтобы серверный middleware видел POLZAAI_*.
  const env = loadEnv(mode, process.cwd(), "");
  for (const [k, v] of Object.entries(env)) {
    if (process.env[k] === undefined) process.env[k] = v;
  }
  return {
    server: {
      host: true,
      fs: { strict: false },
      watch: null,
    },
    plugins: [
      react(),
      tailwindcss(),
      polzaaiChatPlugin(),
      chatsApiPlugin(),
      adminApiPlugin(),
      transcribeApiPlugin(),
      evaluateConfidencePlugin(),
      runCodePlugin(),
      tasksApiPlugin(),
      workspaceApiPlugin(),
      browserApiPlugin(),
      summarizeApiPlugin(),
      wsPlugin(),
      researchApiPlugin(),
      uploadApiPlugin(),
      integrationsApiPlugin(),
      {
        name: "telegram-polling",
        configureServer() {
          startTelegramPolling();
        },
      },
    ],
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
      },
    },
  };
});
