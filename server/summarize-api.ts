import type { Plugin } from "vite";

const POLZAAI_BASE_URL = process.env.POLZAAI_BASE_URL ?? "https://api.polza.ai/v1";
const POLZAAI_API_KEY = process.env.POLZAAI_API_KEY;
const SUMMARY_MODEL = process.env.POLZAAI_MODEL ?? "openai/gpt-4o-mini";

export function summarizeApiPlugin(): Plugin {
  return {
    name: "summarize-api",
    configureServer(server) {
      server.middlewares.use("/api/summarize", async (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.setHeader("Allow", "POST");
          res.end();
          return;
        }

        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk as Buffer);
        let body: { messages?: Array<{ role: string; text: string }> };
        try {
          body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        } catch {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: "Invalid JSON" }));
          return;
        }

        if (!body.messages || body.messages.length === 0) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: "messages required" }));
          return;
        }

        const text = body.messages
          .map((m) => `${m.role === "user" ? "Пользователь" : "Ассистент"}: ${m.text}`)
          .join("\n\n");

        const prompt = `Сократи следующий диалог до краткого саммари (2-3 предложения на русском), сохранив все ключевые факты, решения и договорённости. Не добавляй отсебятину.\n\n${text}\n\nСаммари:`;

        try {
          const response = await fetch(`${POLZAAI_BASE_URL}/chat/completions`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${POLZAAI_API_KEY}`,
            },
            body: JSON.stringify({
              model: SUMMARY_MODEL,
              messages: [{ role: "user", content: prompt }],
              max_tokens: 300,
              temperature: 0.3,
            }),
            signal: AbortSignal.timeout(15_000),
          });

          if (!response.ok) {
            const errText = await response.text();
            res.statusCode = 500;
            res.end(JSON.stringify({ error: errText }));
            return;
          }

          const data = await response.json();
          const summary = data.choices?.[0]?.message?.content ?? "";
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ summary: summary.trim() }));
        } catch (err) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
        }
      });
    },
  };
}
