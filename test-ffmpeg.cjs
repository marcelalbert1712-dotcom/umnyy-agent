const { spawnSync } = require("child_process");
const path = require("path");

// Test all candidate paths
const candidates = [
  "ffmpeg",
  path.join("C:", "Users", "!!!~1", "AppData", "Local", "Microsoft", "WinGet", "Packages", "Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe", "ffmpeg-8.1.2-full_build", "bin", "ffmpeg.exe"),
  path.join(process.env.LOCALAPPDATA || "", "Microsoft", "WinGet", "Packages", "Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe", "ffmpeg-8.1.2-full_build", "bin", "ffmpeg.exe"),
];

for (const c of candidates) {
  try {
    const r = spawnSync(c, ["-version"], { timeout: 3000, encoding: "utf8" });
    console.log(c, "->", r.status === 0 ? "OK" : `FAIL status=${r.status}`);
    if (r.status === 0) {
      console.log("  version:", r.stdout.split("\n")[0]);
    }
  } catch (e) {
    console.log(c, "-> ERROR:", e.message.slice(0, 60));
  }
}
