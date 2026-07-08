import type { Plugin } from "vite";

const POLZAAI_BASE_URL =
  process.env.POLZAAI_BASE_URL ?? "https://api.polza.ai/v1";
const POLZAAI_MODEL =
  process.env.POLZAAI_MODEL ?? "openai/gpt-4o-mini";

/**
 * Оценивает уверенность в ответе от 1 до 10.
 * Делает один дешёвый completion-запрос и парсит число.
 */
async function evaluateConfidence(responseText: string): Promise<number> {
  const apiKey = process.env.POLZAAI_API_KEY;
  if (!apiKey) return 5;

  try {
    const res = await fetch(`${POLZAAI_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: POLZAAI_MODEL,
        messages: [
          {
            role: "system",
            content:
              "Ты — оценщик уверенности. Оцени уверенность в следующем ответе от 1 до 10. "
              + "Учитывай: если ответ содержит факты без источников — уверенность ниже. "
              + "Если содержит предположения или догадки — уверенность ниже. "
              + "Если основан на общеизвестных фактах или результатах инструментов — уверенность выше. "
              + "Ответь ТОЛЬКО целым числом от 1 до 10, без пояснений.",
          },
          { role: "user", content: responseText },
        ],
        max_tokens: 5,
        temperature: 0,
      }),
    });

    if (!res.ok) {
      console.warn(`[evaluate-confidence] HTTP ${res.status}`);
      return 5;
    }

    const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
    const text: string =
      data.choices?.[0]?.message?.content?.trim() ?? "";
    const num = parseInt(text, 10);
    if (isNaN(num) || num < 1 || num > 10) return 5;
    return num;
  } catch (err) {
    console.warn("[evaluate-confidence] error:", err);
    return 5;
  }
}

export function evaluateConfidencePlugin(): Plugin {
  return {
    name: "evaluate-confidence-api",
    configureServer(server) {
      server.middlewares.use(
        "/api/evaluate-confidence",
        async (req, res) => {
          if (req.method !== "POST") {
            res.statusCode = 405;
            res.setHeader("Allow", "POST");
            res.end();
            return;
          }

          try {
            const chunks: Buffer[] = [];
            for await (const chunk of req) chunks.push(chunk as Buffer);
            const body = JSON.parse(
              Buffer.concat(chunks).toString("utf8"),
            ) as { text?: string };

            if (!body.text || !body.text.trim()) {
              res.statusCode = 400;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ error: "text is required" }));
              return;
            }

            const score = await evaluateConfidence(body.text);
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ score }));
          } catch (err) {
            res.statusCode = 500;
            res.setHeader("Content-Type", "application/json");
            res.end(
              JSON.stringify({
                error:
                  err instanceof Error
                    ? err.message
                    : "Internal error",
              }),
            );
          }
        },
      );
    },
  };
}
