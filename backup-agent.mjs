// Smart backup: copies only changed files to cloud folder
// Uses MD5 hashes to detect real changes — skips if nothing new
// Run: node backup-agent.mjs
import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

const SCRIPT_DIR = path.resolve(import.meta.dirname || ".");
const DESTINATIONS = [
  path.join(process.env.USERPROFILE || "C:\\Users", "OneDrive", "umnyy-agent-backup"),
  path.join("D:", "\u0410\u043D\u0434\u0440\u044E\u0445\u0430!!!", "umnyy-agent-backup"),
];
const STATE_FILE = path.join(SCRIPT_DIR, ".backup-state.json");

const SOURCES = [
  { rel: ".env", recursive: false },
  { rel: ".chats-data", recursive: true },
  { rel: ".user-data", recursive: true },
];

const SKIP_PATTERNS = [".chats-data/.backup", ".chats-data/.trash", ".tmp."];

function shouldSkip(relPath) {
  for (const p of SKIP_PATTERNS) {
    if (relPath.includes(p)) return true;
  }
  return false;
}

async function md5(filePath) {
  const buf = await fs.readFile(filePath);
  return createHash("md5").update(buf).digest("hex");
}

async function collectFiles(root, rel, recursive) {
  const fullPath = path.join(root, rel);
  const result = [];
  try {
    const entries = await fs.readdir(fullPath, { withFileTypes: true });
    for (const e of entries) {
      const eRel = path.join(rel, e.name).replace(/\\/g, "/");
      if (shouldSkip(eRel)) continue;
      if (e.isFile()) {
        result.push(eRel);
      } else if (e.isDirectory() && recursive) {
        const sub = await collectFiles(root, eRel, true);
        result.push(...sub);
      }
    }
  } catch { /* file/folder may not exist */ }
  return result;
}

async function main() {
  // Load previous state
  let prevState = {};
  try {
    const raw = await fs.readFile(STATE_FILE, "utf8");
    prevState = JSON.parse(raw);
  } catch { /* first run */ }
  
  // Collect current file list
  const files = [];
  for (const src of SOURCES) {
    const list = await collectFiles(SCRIPT_DIR, src.rel, src.recursive);
    files.push(...list);
  }
  
  if (files.length === 0) {
    console.log("[backup] No files found, skipping");
    return;
  }
  
  // Compare hashes
  const changed = [];
  let totalBytes = 0;
  
  for (const rel of files) {
    const fullPath = path.join(SCRIPT_DIR, rel);
    try {
      const hash = await md5(fullPath);
      if (!prevState[rel] || prevState[rel] !== hash) {
        const stat = await fs.stat(fullPath);
        changed.push({ rel, hash, size: stat.size });
        totalBytes += stat.size;
      }
    } catch { /* file disappeared */ }
  }
  
  if (changed.length === 0) {
    const time = new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    console.log(`[backup] ${time} - no changes, skipping`);
    return;
  }
  
  console.log(`[backup] Changed: ${changed.length} files (${(totalBytes / 1024).toFixed(0)} KB)`);
  
  // Copy changed files to all destinations
  let totalErrors = 0;
  
  for (const dest of DESTINATIONS) {
    await fs.mkdir(dest, { recursive: true });
    let copied = 0;
    
    for (const item of changed) {
      const destFile = path.join(dest, item.rel.replace(/\//g, path.sep));
      const destDir = path.dirname(destFile);
      try {
        await fs.mkdir(destDir, { recursive: true });
        await fs.copyFile(path.join(SCRIPT_DIR, item.rel), destFile);
        copied++;
      } catch (err) {
        console.error(`[backup] ERROR ${dest}: ${item.rel} - ${err.message}`);
        totalErrors++;
      }
    }
    console.log(`[backup] ${dest.split("\\").pop()}: ${copied} files`);
  }
  console.log(`[backup] Done: ${DESTINATIONS.length} destinations`);
  
  // Save new state (only if all copies succeeded)
  if (totalErrors === 0) {
    const newState = { ...prevState };
    for (const item of changed) {
      newState[item.rel] = item.hash;
    }
    for (const key of Object.keys(newState)) {
      if (!files.includes(key)) delete newState[key];
    }
    await fs.writeFile(STATE_FILE, JSON.stringify(newState, null, 2), "utf8");
    console.log("[backup] State saved");
  } else {
    console.log(`[backup] State NOT saved (${totalErrors} errors) - will re-check next run`);
  }
  
  console.log(`[backup] Destinations: ${DESTINATIONS.join(", ")}`);
}

main().catch((err) => {
  console.error("[backup] FATAL:", err.message);
  process.exit(1);
});
