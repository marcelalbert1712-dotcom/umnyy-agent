import type { Plugin } from "vite";

const POLZAAI_BASE_URL = process.env.POLZAAI_BASE_URL ?? "https://api.polza.ai/v1";
const POLZAAI_API_KEY = process.env.POLZAAI_API_KEY;
const RESEARCH_MODEL = process.env.POLZAAI_MODEL ?? "openai/gpt-4o-mini";
const MAX_ITERATIONS = 3;

function jsonErr(msg: string) {
  return new Response(JSON.stringify({ error: msg }), {
    status: 400,
    headers: { "Content-Type": "application/json" },
  });
}

async function llm(prompt: string, maxTokens = 800, temp = 0.3): Promise<string> {
  const res = await fetch(`${POLZAAI_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${POLZAAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: RESEARCH_MODEL,
      messages: [{ role: "user", content: prompt }],
      max_tokens: maxTokens,
      temperature: temp,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`LLM error: ${await res.text()}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? "";
}

async function searchWeb(query: string): Promise<Array<{ title: string; url: string; snippet: string }>> {
  const res = await fetch("https://html.duckduckgo.com/html/", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    },
    body: `q=${encodeURIComponent(query)}`,
  });
  if (!res.ok) return [];
  const html = await res.text();
  const results: Array<{ title: string; url: string; snippet: string }> = [];
  const linkRe = /<a[^>]+class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  const snippetRe = /<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;
  const links: string[] = [];
  const titles: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(html)) !== null) {
    links.push(m[1].trim());
    titles.push(m[2].replace(/<[^>]*>/g, "").trim());
  }
  const snippets: string[] = [];
  while ((m = snippetRe.exec(html)) !== null) {
    snippets.push(m[1].replace(/<[^>]*>/g, "").trim());
  }
  for (let i = 0; i < Math.min(links.length, 5); i++) {
    results.push({
      title: titles[i] ?? `Result ${i + 1}`,
      url: links[i]?.startsWith("http") ? links[i] : `https:${links[i]}`,
      snippet: snippets[i] ?? "",
    });
  }
  return results;
}

async function readUrl(url: string): Promise<string> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    const html = await res.text();
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<nav[\s\S]*?<\/nav>/gi, "")
      .replace(/<footer[\s\S]*?<\/footer>/gi, "")
      .replace(/<header[\s\S]*?<\/header>/gi, "")
      .replace(/<[^>]*>/g, " ")
      .replace(/&[^;]+;/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return text.slice(0, 4000);
  } catch {
    return "";
  }
}

export function researchApiPlugin(): Plugin {
  return {
    name: "research-api",
    configureServer(server) {
      server.middlewares.use("/api/research", async (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.setHeader("Allow", "POST");
          res.end();
          return;
        }

        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk as Buffer);
        let body: { query?: string };
        try {
          body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        } catch {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: "Invalid JSON" }));
          return;
        }

        if (!body.query?.trim()) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: "query required" }));
          return;
        }

        const query = body.query.trim();

        try {
          // Step 1: Generate sub-questions
          const planPrompt = `Разбей следующий исследовательский вопрос на 3-5 подвопросов, которые нужно изучить. Верни ТОЛЬКО JSON-массив строк, без пояснений.\n\nВопрос: ${query}`;
          const planRaw = await llm(planPrompt, 500, 0.2);
          let subQuestions: string[];
          try {
            subQuestions = JSON.parse(planRaw.replace(/```(?:json)?\s*([\s\S]*?)```/g, "$1").trim());
            if (!Array.isArray(subQuestions)) throw new Error();
          } catch {
            subQuestions = [query];
          }

          const allFindings: Array<{ question: string; findings: string; sources: string[] }> = [];

          for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
            const remaining = subQuestions.filter((_, i) => !allFindings[i] || iter > 0);
            const questions = remaining.length > 0 ? remaining : subQuestions;

            for (let qi = 0; qi < questions.length; qi++) {
              const q = questions[qi];
              const results = await searchWeb(q);
              if (results.length === 0) continue;

              const readingPromises = results.slice(0, 3).map(async (r) => {
                const text = await readUrl(r.url);
                return { url: r.url, title: r.title, text, snippet: r.snippet };
              });
              const readings = await Promise.all(readingPromises);
              const validReadings = readings.filter((r) => r.text.length > 100);

              if (validReadings.length === 0) continue;

              const extractPrompt = `Извлеки ключевые факты из следующих источников по вопросу: "${q}". Верни краткую сводку (2-4 предложения) и перечень ключевых тезисов.

Источники:
${validReadings.map((r) => `--- ${r.title} (${r.url}) ---\n${r.text.slice(0, 2000)}`).join("\n\n")}

Сводка:`;
              const findings = await llm(extractPrompt, 600, 0.2);

              const existing = allFindings.find((f) => f.question === q);
              if (existing) {
                existing.findings = findings;
                validReadings.forEach((r) => {
                  if (!existing.sources.includes(r.url)) existing.sources.push(r.url);
                });
              } else {
                allFindings.push({
                  question: q,
                  findings,
                  sources: validReadings.map((r) => r.url),
                });
              }
            }

            if (iter < MAX_ITERATIONS - 1) {
              const findingsText = allFindings.map((f) => `Вопрос: ${f.question}\nОтвет: ${f.findings}`).join("\n\n");
              const gapPrompt = `На основе собранной информации по вопросу "${query}" определи, каких данных не хватает для полного ответа. Верни JSON-массив из 0-3 дополнительных поисковых запросов. Если данных достаточно — верни [].\n\nСобранная информация:\n${findingsText}`;
              const gapRaw = await llm(gapPrompt, 400, 0.2);
              let gaps: string[];
              try {
                gaps = JSON.parse(gapRaw.replace(/```(?:json)?\s*([\s\S]*?)```/g, "$1").trim());
                if (!Array.isArray(gaps)) gaps = [];
              } catch {
                gaps = [];
              }
              if (gaps.length === 0) break;
              subQuestions = gaps;
            }
          }

          // Step 3: Generate final report
          const findingsText = allFindings.map((f) => `## ${f.question}\n${f.findings}\n\nИсточники: ${f.sources.join(", ")}`).join("\n\n");
          const reportPrompt = `Составь подробный, хорошо структурированный отчёт на русском языке по вопросу: "${query}".

Итоговый отчёт должен содержать:
- Введение (1-2 абзаца)
- Основные разделы по ключевым аспектам
- Заключение
- Список источников (только те, что реально использованы)

Используй Markdown. Будь информативным и объективным.

Собранная информация:
${findingsText}

Отчёт:`;

          const report = await llm(reportPrompt, 3000, 0.4);
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ report, subQuestions: subQuestions.length, sources: [...new Set(allFindings.flatMap((f) => f.sources))] }));
        } catch (err) {
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
        }
      });
    },
  };
}
