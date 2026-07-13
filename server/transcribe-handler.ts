export async function handleTranscribeRequest(req: Request): Promise<Response> {
  const baseUrl = process.env.POLZAAI_BASE_URL ?? "https://api.polza.ai/v1";
  const apiKey = process.env.POLZAAI_API_KEY;
  if (!apiKey) {
    return Response.json({ error: "POLZAAI_API_KEY not configured" }, { status: 500 });
  }

  let body: { audio?: string; mimeType?: string };
  try {
    body = await req.json() as { audio?: string; mimeType?: string };
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.audio || typeof body.audio !== "string") {
    return Response.json({ error: "Missing audio field" }, { status: 400 });
  }

  const buffer = Buffer.from(body.audio, "base64");
  const mime = body.mimeType ?? "audio/webm";

  // Пробуем с оригинальным форматом
  const formData = new FormData();
  const ext = mime.includes("wav") ? "wav" : mime.includes("mp4") ? "mp4" : "webm";
  formData.append("file", new Blob([buffer], { type: mime }), `audio.${ext}`);
  formData.append("model", "whisper-1");

  let whisperRes = await fetch(`${baseUrl}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: formData,
  });

  let data = await whisperRes.json() as Record<string, unknown>;

  // Если не удалось — пробуем без codec в mime (например audio/webm без ;codecs=opus)
  if (!whisperRes.ok && mime.includes(";")) {
    const simpleMime = mime.split(";")[0];
    const form2 = new FormData();
    form2.append("file", new Blob([buffer], { type: simpleMime }), `audio.${ext}`);
    form2.append("model", "whisper-1");
    whisperRes = await fetch(`${baseUrl}/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form2,
    });
    data = await whisperRes.json() as Record<string, unknown>;
  }

  if (!whisperRes.ok) {
    const errDetail = typeof data === "object" ? JSON.stringify(data).slice(0, 200) : "Whisper API error";
    return Response.json({ error: errDetail }, { status: 502 });
  }

  const text = typeof data.text === "string" ? data.text.trim() : "";
  return Response.json({ text });
}
