import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";

const SCRIPT_DIR = path.resolve(import.meta.dirname || ".");
const TEMP_DIR = process.env.TEMP || "C:\\Windows\\Temp";
const WAV_FILE = path.join(TEMP_DIR, "umnyy-dictate.wav");
const RESULT_FILE = process.argv[2] || path.join(TEMP_DIR, "umnyy-dictate-result.txt");
const LOG_FILE = path.join(TEMP_DIR, "umnyy-dictate.log");

function log(m) {
  try { fs.appendFile(LOG_FILE, `${new Date().toISOString()} ${m}\n`); } catch {}
}

log("=== START ===");
log("Result file: " + RESULT_FILE);

try {
  const envContent = await fs.readFile(path.join(SCRIPT_DIR, ".env"), "utf8");
  for (const line of envContent.split(/\r?\n/)) {
    const eq = line.indexOf("=");
    if (eq > 0 && !line.trim().startsWith("#") && !/^\s*$/.test(line)) {
      const key = line.slice(0, eq).trim();
      const val = line.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
      if (!process.env[key]) process.env[key] = val;
    }
  }
  log("ENV loaded");
} catch (e) { log("ENV skip: " + e.message); }

const API_URL = (process.env.POLZAAI_BASE_URL ?? "https://api.polza.ai/v1") + "/audio/transcriptions";
const API_KEY = process.env.POLZAAI_API_KEY;
if (!API_KEY) { log("No API key"); process.exit(1); }

try {
  const stat = await fs.stat(WAV_FILE);
  log(`WAV: ${stat.size}B`);
  if (stat.size < 100) {
    log("Silent");
    await fs.writeFile(RESULT_FILE, "", "utf8");
    process.exit(0);
  }
} catch (e) {
  log(`No file: ${e.message}`);
  await fs.writeFile(RESULT_FILE, "NO_WAV_FILE", "utf8");
  process.exit(0);
}

try {
  const audioBuffer = await fs.readFile(WAV_FILE);
  log(`Read ${audioBuffer.length}B`);
  const formData = new FormData();
  formData.append("file", new Blob([audioBuffer], { type: "audio/wav" }), "dictate.wav");
  formData.append("model", "whisper-1");
  formData.append("language", "ru");

  log("API call...");
  const res = await fetch(API_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${API_KEY}` },
    body: formData,
  });
  log(`API ${res.status}`);
  const rawText = await res.text();
  log(`Raw: ${rawText.slice(0, 200)}`);
  let data;
  try { data = JSON.parse(rawText); } catch { data = { text: rawText }; }
  const text = (data.text ?? "").trim();
  log(`Text: "${text.slice(0, 100)}"`);

  if (text) {
    await fs.writeFile(RESULT_FILE, text, "utf8");
    log("Result file written OK");
    console.log(text);
  } else {
    log("Empty response");
    await fs.writeFile(RESULT_FILE, "EMPTY_RESPONSE", "utf8");
  }
} catch (err) {
  log(`Error: ${err.message}`);
  await fs.writeFile(RESULT_FILE, "ERROR:" + err.message, "utf8");
} finally {
  await fs.unlink(WAV_FILE).catch(() => {});
  log("=== END ===");
}
process.exit(0);
