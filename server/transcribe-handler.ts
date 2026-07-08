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
  const formData = new FormData();
  formData.append("file", new Blob([buffer], { type: body.mimeType ?? "audio/webm" }), "audio.webm");
  formData.append("model", "whisper-1");
  formData.append("language", "ru");

  const whisperRes = await fetch(`${baseUrl}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: formData,
  });

  const data = await whisperRes.json() as Record<string, unknown>;

  if (!whisperRes.ok) {
    const msg = (data.error as { message?: string })?.message ?? "Whisper API error";
    return Response.json({ error: msg }, { status: 502 });
  }

  const text = typeof data.text === "string" ? data.text : "";
  return Response.json({ text });
}
