import { spawnSync } from "node:child_process";
import path from "node:path";
import { promises as fs } from "node:fs";

const SCRIPTS_DIR = path.join(process.cwd(), ".user-data", "python-sandbox", "scripts");

async function ensureDirs(): Promise<void> {
  await fs.mkdir(SCRIPTS_DIR, { recursive: true });
}

export async function initSandbox(): Promise<{ ok: boolean; message: string }> {
  try {
    await ensureDirs();
    // Check system Python
    const r = spawnSync("python", ["--version"], { timeout: 5000, encoding: "utf8" });
    if (r.status !== 0) return { ok: false, message: "Python not found" };
    return { ok: true, message: `Python ready: ${r.stdout.trim()}` };
  } catch (err: any) {
    return { ok: false, message: err.message };
  }
}

export async function getInfo(): Promise<{
  ok: boolean;
  version?: string;
  packages?: string;
  error?: string;
}> {
  try {
    await ensureDirs();
    const verR = spawnSync("python", ["--version"], { timeout: 5000, encoding: "utf8" });
    if (verR.status !== 0) return { ok: false, error: "Python not found" };
    const ver = (verR.stdout || verR.stderr || "").trim();
    let pkgs = "";
    try {
      const pkgsR = spawnSync("python", ["-m", "pip", "list"], { timeout: 15000, encoding: "utf8" });
      pkgs = pkgsR.stdout?.trim() ?? "";
    } catch { /* ignore */ }
    return { ok: true, version: ver, packages: pkgs };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

export async function install(packages: string[]): Promise<{ ok: boolean; output: string; error?: string }> {
  try {
    await ensureDirs();
    console.log(`[python-sandbox] pip install ${packages.join(" ")}`);
    const r = spawnSync("python", ["-m", "pip", "install", ...packages], {
      timeout: 180000,
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    });
    if (r.status !== 0) {
      return {
        ok: false,
        output: (r.stdout || "").slice(0, 2000),
        error: (r.stderr || r.stdout || "pip install failed").slice(0, 1000),
      };
    }
    return { ok: true, output: (r.stdout || "").slice(0, 2000) };
  } catch (err: any) {
    console.error("[python-sandbox] install error:", err.message);
    return { ok: false, output: "", error: err.message };
  }
}

export async function runScript(
  code: string,
  chatId: string,
  timeoutMs = 30000,
): Promise<{ ok: boolean; stdout: string; stderr: string; httpPath?: string; error?: string }> {
  try {
    await ensureDirs();
    const ts = Date.now();
    const scriptFile = path.join(SCRIPTS_DIR, `script_${ts}.py`);
    await fs.writeFile(scriptFile, code, "utf8");

    // Workspace dir for this chat — set as cwd so script can write files
    const wsDir = path.join(process.cwd(), ".user-data", "workspace", chatId);
    await fs.mkdir(wsDir, { recursive: true }).catch(() => {});

    const r = spawnSync("python", [scriptFile], {
      timeout: timeoutMs,
      encoding: "utf8",
      maxBuffer: 5 * 1024 * 1024,
      cwd: wsDir,
    });

    // Cleanup script file
    await fs.unlink(scriptFile).catch(() => {});

    // Save output to workspace
    const outputFileName = `python-output-${ts}.txt`;
    const outputPath = path.join(wsDir, outputFileName);
    const fullOutput = `STDOUT:\n${r.stdout || ""}\n\nSTDERR:\n${r.stderr || ""}`;
    await fs.writeFile(outputPath, fullOutput, "utf8").catch(() => {});

    if (r.status !== 0 && !(r.stdout || "").trim()) {
      return {
        ok: false,
        stdout: "",
        stderr: (r.stderr || "").slice(0, 2000),
        httpPath: `/api/workspace/${chatId}/${outputFileName}`,
        error: `Exit code ${r.status}: ${(r.stderr || "").slice(0, 500)}`,
      };
    }
    return {
      ok: true,
      stdout: (r.stdout || "").slice(0, 10000),
      stderr: (r.stderr || "").slice(0, 2000),
      httpPath: `/api/workspace/${chatId}/${outputFileName}`,
    };
  } catch (err: any) {
    return { ok: false, stdout: "", stderr: "", error: err.message };
  }
}