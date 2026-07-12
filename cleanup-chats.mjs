// Cleanup script: strips base64 media from old chat files
// Run: node cleanup-chats.mjs

import { promises as fs } from "node:fs";
import path from "node:path";

const DATA_DIR = path.join(process.cwd(), ".chats-data");

function stripMediaPayload(messages) {
  return messages.map((msg) => {
    if (!msg.parts) return msg;
    const stripped = msg.parts.map((part) => {
      if (part.type === "file" && typeof part.url === "string" && part.url.startsWith("data:")) {
        return {
          ...part,
          url: `[stripped]`,
        };
      }
      if (part.type === "image" && typeof part.image === "string" && part.image.startsWith("data:")) {
        if (part.image.length > 50000) {
          return { ...part, image: `[stripped]` };
        }
      }
      return part;
    });
    return { ...msg, parts: stripped };
  });
}

async function main() {
  const entries = await fs.readdir(DATA_DIR);
  const jsonFiles = entries.filter((e) => e.endsWith(".json"));
  
  let cleaned = 0;
  let skipped = 0;
  let bytesSaved = 0;
  
  for (const file of jsonFiles) {
    const filePath = path.join(DATA_DIR, file);
    try {
      const statBefore = await fs.stat(filePath);
      const raw = await fs.readFile(filePath, "utf8");
      const record = JSON.parse(raw);
      
      if (!record.messages || record.messages.length === 0) {
        skipped++;
        continue;
      }
      
      const cleanMessages = stripMediaPayload(record.messages);
      record.messages = cleanMessages;
      
      const newJson = JSON.stringify(record, null, 2);
      const statAfter = { size: Buffer.byteLength(newJson, "utf8") };
      
      if (statAfter.size < statBefore.size) {
        await fs.writeFile(filePath, newJson, "utf8");
        const saved = statBefore.size - statAfter.size;
        bytesSaved += saved;
        console.log(`[clean] ${file}: ${(statBefore.size / 1024).toFixed(0)}KB -> ${(statAfter.size / 1024).toFixed(0)}KB (saved ${(saved / 1024).toFixed(0)}KB)`);
        cleaned++;
      } else {
        console.log(`[skip] ${file}: no changes needed`);
        skipped++;
      }
    } catch (err) {
      console.error(`[error] ${file}: ${err.message}`);
    }
  }
  
  console.log(`\n=== DONE ===`);
  console.log(`Cleaned: ${cleaned} files`);
  console.log(`Skipped: ${skipped} files`);
  console.log(`Saved: ${(bytesSaved / 1024 / 1024).toFixed(1)} MB`);
}

main().catch(console.error);
