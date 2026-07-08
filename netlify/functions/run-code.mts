import type { Config } from "@netlify/functions";
import { execSync } from "node:child_process";

export default async (req: Request): Promise<Response> => {
  if (req.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405, headers: { Allow: "POST" } });
  }

  let body: { language?: string; code?: string };
  try {
    body = (await req.json()) as { language?: string; code?: string };
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.code || !body.code.trim()) {
    return Response.json({ error: "code is required" }, { status: 400 });
  }

  const language = body.language ?? "javascript";
  const timeout = 15_000;

  try {
    let stdout = "";
    let stderr = "";

    if (language === "javascript" || language === "js") {
      const result = execSync(`node -e ${JSON.stringify(body.code)}`, {
        timeout,
        maxBuffer: 1024 * 100,
        windowsHide: true,
        encoding: "utf8",
        env: { ...process.env, NODE_PATH: "" },
      });
      stdout = result.trim();
    } else if (language === "python" || language === "py") {
      const result = execSync(`python3 -c ${JSON.stringify(body.code)}`, {
        timeout,
        maxBuffer: 1024 * 100,
        windowsHide: true,
        encoding: "utf8",
      });
      stdout = result.trim();
    } else if (language === "bash" || language === "sh") {
      const result = execSync(body.code, {
        timeout,
        maxBuffer: 1024 * 100,
        windowsHide: true,
        encoding: "utf8",
        shell: true,
      });
      stdout = result.trim();
    } else {
      return Response.json({ error: `Unsupported language: ${language}` }, { status: 400 });
    }

    return Response.json({ stdout, stderr });
  } catch (err: any) {
    return Response.json({
      stdout: "",
      stderr: err.stderr ?? err.message ?? String(err),
    });
  }
};

export const config: Config = {
  path: "/api/run-code",
  method: "POST",
};
