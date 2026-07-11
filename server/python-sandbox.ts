import { promises as fs } from "node:fs";
import { execSync, exec } from "node:child_process";
import path from "node:path";

const DATA_DIR = path.join(process.cwd(), ".user-data", "python-sandbox");
const VENV_DIR = path.join(DATA_DIR, "venv");
const SCRIPTS_DIR = path.join(DATA_DIR, "scripts");

function pythonBin(): string {
  return path.join(VENV_DIR, "Scripts", "python.exe");
}

function pipBin(): string {
  return path.join(VENV_DIR, "Scripts", "pip.exe");
}

async function ensureDirs(): Promise<void> {
  await fs.mkdir(SCRIPTS_DIR, { recursive: true });
}

async function ensureVenv(): Promise<boolean> {
  try {
    await fs.access(pythonBin());
    return true;
  } catch {
    return false;
  }
}

export async function initSandbox(): Promise<{ ok: boolean; message: string }> {
  try {
    await ensureDirs();
    const exists = await ensureVenv();
    if (exists) return { ok: true, message: "Sandbox уже создан" };
    execSync(`python -m venv "${VENV_DIR}"`, { timeout: 60000, stdio: "pipe" });
    if (await ensureVenv()) return { ok: true, message: "Sandbox создан" };
    return { ok: false, message: "Не удалось создать venv" };
  } catch (err: any) {
    return { ok: false, message: err.message };
  }
}

export async function getInfo(): Promise<{
  ok: boolean;
  version?: string;
  venv?: string;
  packages?: string;
  error?: string;
}> {
  try {
    const exists = await ensureVenv();
    if (!exists) return { ok: false, error: "Sandbox не инициализирован. Сначала вызови pythonInfo для инициализации" };
    await ensureDirs();
    const ver = execSync(`"${pythonBin()}" --version`, { timeout: 5000, encoding: "utf8" }).toString().trim();
    const pkgs = execSync(`"${pipBin()}" list --format=columns`, { timeout: 15000, encoding: "utf8" }).toString().trim();
    return { ok: true, version: ver, venv: VENV_DIR, packages: pkgs };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

export async function install(packages: string[]): Promise<{ ok: boolean; output: string; error?: string }> {
  try {
    await ensureDirs();
    const exists = await ensureVenv();
    if (!exists) {
      const init = await initSandbox();
      if (!init.ok) return { ok: false, output: "", error: init.message };
    }
    const names = packages.join(" ");
    const out = execSync(`"${pipBin()}" install --no-cache-dir ${names}`, { timeout: 120000, encoding: "utf8", maxBuffer: 1024 * 1024 }).toString();
    return { ok: true, output: out };
  } catch (err: any) {
    return { ok: false, output: err.stdout?.toString() ?? "", error: err.stderr?.toString() ?? err.message };
  }
}

export async function runScript(
  code: string,
  timeoutMs = 30000,
): Promise<{ ok: boolean; stdout: string; stderr: string; filePath?: string; error?: string }> {
  try {
    await ensureDirs();
    const exists = await ensureVenv();
    if (!exists) {
      const init = await initSandbox();
      if (!init.ok) return { ok: false, stdout: "", stderr: "", error: init.message };
    }
    const ts = Date.now();
    const scriptFile = path.join(SCRIPTS_DIR, `script_${ts}.py`);
    await fs.writeFile(scriptFile, code, "utf8");

    return new Promise((resolve) => {
      const proc = exec(`"${pythonBin()}" "${scriptFile}"`, {
        timeout: timeoutMs,
        maxBuffer: 5 * 1024 * 1024,
        encoding: "utf8",
      }, async (err, stdout, stderr) => {
        // Cleanup script file
        await fs.unlink(scriptFile).catch(() => {});
        // Save output to workspace
        const outputDir = path.join(process.cwd(), ".user-data", "workspace", "default");
        await fs.mkdir(outputDir, { recursive: true }).catch(() => {});
        const outputFile = path.join(outputDir, `python-output-${ts}.txt`);
        const fullOutput = `STDOUT:\n${stdout}\n\nSTDERR:\n${stderr}`;
        await fs.writeFile(outputFile, fullOutput, "utf8").catch(() => {});

        if (err && !stdout) {
          resolve({ ok: false, stdout, stderr, error: err.message, filePath: outputFile });
        } else {
          resolve({ ok: true, stdout: stdout.slice(0, 10000), stderr: stderr.slice(0, 2000), filePath: outputFile });
        }
      });
    });
  } catch (err: any) {
    return { ok: false, stdout: "", stderr: "", error: err.message };
  }
}