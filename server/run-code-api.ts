import { execSync } from "node:child_process";
import type { Plugin } from "vite";

function runCode(language: string, code: string): { stdout: string; stderr: string } {
  const timeout = 15_000;

  if (language === "javascript" || language === "js") {
    const result = execSync(`node -e ${JSON.stringify(code)}`, {
      timeout,
      maxBuffer: 1024 * 100,
      windowsHide: true,
      encoding: "utf8",
      env: { ...process.env, NODE_PATH: "" },
    });
    return { stdout: result.trim(), stderr: "" };
  }

  if (language === "python" || language === "py") {
    const candidates = process.platform === "win32" ? ["python", "python3"] : ["python3", "python"];
    let lastErr: unknown;
    for (const bin of candidates) {
      try {
        const result = execSync(`${bin} -c ${JSON.stringify(code)}`, {
          timeout,
          maxBuffer: 1024 * 100,
          windowsHide: true,
          encoding: "utf8",
        });
        return { stdout: result.trim(), stderr: "" };
      } catch (err) {
        lastErr = err;
        if (err && typeof err === "object" && "stderr" in err) {
          const stderr = (err as { stderr: string }).stderr?.toString() ?? "";
          if (stderr.includes("No such file") || stderr.includes("not found") || stderr.includes("not recognized")) continue;
        }
        throw err;
      }
    }
    throw lastErr;
  }

  throw new Error(`Unsupported language: ${language}`);
}

export function runCodePlugin(): Plugin {
  return {
    name: "run-code-api",
    configureServer(server) {
      server.middlewares.use("/api/run-code", async (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.setHeader("Allow", "POST");
          res.end();
          return;
        }

        try {
          const chunks: Buffer[] = [];
          for await (const chunk of req) chunks.push(chunk as Buffer);
          const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
            language?: string;
            code?: string;
          };

          if (!body.code || !body.code.trim()) {
            res.statusCode = 400;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: "code is required" }));
            return;
          }

          const lang = body.language ?? "javascript";
          const result = runCode(lang, body.code);
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(result));
        } catch (err: any) {
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({
            stdout: "",
            stderr: err.stderr ?? err.message ?? String(err),
          }));
        }
      });
    },
  };
}
