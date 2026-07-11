import { spawnSync } from "node:child_process";
import path from "node:path";
import { promises as fs } from "node:fs";

const WS_DIR = path.join(process.cwd(), ".user-data", "workspace");

// Find ffmpeg — search common locations if PATH is stale
function findFfmpeg(): string {
  const candidates = [
    "ffmpeg",
    path.join("C:\\Users\\!!!~1\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\\ffmpeg-8.1.2-full_build\\bin\\ffmpeg.exe"),
    path.join(process.env.LOCALAPPDATA || "", "Microsoft\\WinGet\\Packages\\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\\ffmpeg-8.1.2-full_build\\bin\\ffmpeg.exe"),
  ];
  for (const c of candidates) {
    try {
      const r = spawnSync(c, ["-version"], { timeout: 3000, encoding: "utf8" });
      if (r.status === 0) return c;
    } catch { /* try next */ }
  }
  return "ffmpeg"; // fallback — let it fail naturally
}

const FFMPEG = findFfmpeg();
const FFPROBE = FFMPEG.replace("ffmpeg.exe", "ffprobe.exe").replace("ffmpeg", "ffprobe");

function ffmpeg(args: string[], timeoutMs = 30000): { ok: boolean; stdout: string; stderr: string } {
  const r = spawnSync(FFMPEG, args, { timeout: timeoutMs, encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
  return {
    ok: r.status === 0,
    stdout: r.stdout || "",
    stderr: r.stderr || "",
  };
}

/** Extract frames from a video file at intervals */
export async function extractFrames(
  chatId: string,
  videoName: string,
  intervalSec = 5,
  maxFrames = 10,
): Promise<{ ok: boolean; frames: string[]; error?: string }> {
  try {
    const videoPath = path.join(WS_DIR, chatId, videoName);
    await fs.access(videoPath);

    const outDir = path.join(WS_DIR, chatId, `.frames_${Date.now()}`);
    await fs.mkdir(outDir, { recursive: true });

    const outPattern = path.join(outDir, "frame_%03d.png");
    const r = ffmpeg([
      "-i", videoPath,
      "-vf", `fps=1/${intervalSec}`,
      "-frames:v", String(maxFrames),
      "-q:v", "2",
      outPattern,
    ], 60000);

    if (!r.ok) {
      await fs.rm(outDir, { recursive: true, force: true }).catch(() => {});
      return { ok: false, frames: [], error: r.stderr.slice(0, 500) || "ffmpeg failed" };
    }

    const frames = (await fs.readdir(outDir))
      .filter((f) => f.endsWith(".png"))
      .sort()
      .map((f) => {
        const src = path.join(outDir, f);
        const dest = path.join(WS_DIR, chatId, f);
        fs.rename(src, dest).catch(() => {});
        return `/api/workspace/${chatId}/${f}`;
      });

    await fs.rm(outDir, { recursive: true, force: true }).catch(() => {});
    return { ok: true, frames };
  } catch (err: any) {
    return { ok: false, frames: [], error: err.message };
  }
}

/** Extract audio from video and save as WAV */
export async function extractAudio(
  chatId: string,
  videoName: string,
): Promise<{ ok: boolean; audioPath?: string; httpUrl?: string; error?: string }> {
  try {
    const videoPath = path.join(WS_DIR, chatId, videoName);
    await fs.access(videoPath);

    const audioName = videoName.replace(/\.[^.]+$/, "") + `_audio_${Date.now()}.wav`;
    const audioPath = path.join(WS_DIR, chatId, audioName);

    const r = ffmpeg([
      "-i", videoPath,
      "-vn",
      "-ar", "16000",
      "-ac", "1",
      audioPath,
    ], 60000);

    if (!r.ok) return { ok: false, error: r.stderr.slice(0, 500) || "ffmpeg failed" };

    // Check file size (if audio is empty/minimal)
    const stat = await fs.stat(audioPath);
    if (stat.size < 100) {
      await fs.unlink(audioPath).catch(() => {});
      return { ok: false, error: "Video has no audio track or audio is too short" };
    }

    return {
      ok: true,
      audioPath,
      httpUrl: `/api/workspace/${chatId}/${audioName}`,
    };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

/** Get video info (duration, dimensions, codec) */
export async function getVideoInfo(
  chatId: string,
  videoName: string,
): Promise<{ ok: boolean; info?: string; duration?: number; error?: string }> {
  try {
    const videoPath = path.join(WS_DIR, chatId, videoName);
    await fs.access(videoPath);

    const r = spawnSync(FFPROBE, [
      "-v", "quiet",
      "-print_format", "json",
      "-show_format",
      "-show_streams",
      videoPath,
    ], { timeout: 10000, encoding: "utf8" });

    if (r.status !== 0) return { ok: false, error: r.stderr.slice(0, 300) };

    const data = JSON.parse(r.stdout || "{}");
    const format = data.format;
    const stream = data.streams?.[0];

    return {
      ok: true,
      duration: format?.duration ? parseFloat(format.duration) : undefined,
      info: [
        `Duration: ${format?.duration ? parseFloat(format.duration).toFixed(1) + "s" : "?"}`,
        `Size: ${format?.size ? (parseInt(format.size) / 1024 / 1024).toFixed(1) + " MB" : "?"}`,
        `Codec: ${stream?.codec_name ?? "?"}`,
        `Resolution: ${stream?.width ?? "?"}x${stream?.height ?? "?"}`,
      ].join(", "),
    };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}