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

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Грузим .env в process.env, чтобы серверный middleware видел POLZAAI_*.
  const env = loadEnv(mode, process.cwd(), "");
  for (const [k, v] of Object.entries(env)) {
    if (process.env[k] === undefined) process.env[k] = v;
  }
  return {
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
    ],
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
      },
    },
  };
});
