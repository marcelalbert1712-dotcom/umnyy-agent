async function test(model, body) {
  const start = Date.now();
  const res = await fetch('https://api.polza.ai/v1/images/generations', {
    method: 'POST',
    headers: { Authorization: 'Bearer pza_KISnJy9mK8eyJWtDYmLp13DYncHw7UV1', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const d = await res.json();
  console.log(`${model}: ${res.status} (${Date.now()-start}ms)`);
  // Check if it returns data inline
  if (d.data?.[0]?.url) { console.log('SYNC URL:', d.data[0].url?.substring(0,100)); return true; }
  if (d.data?.[0]?.b64_json) { console.log('SYNC b64'); return true; }
  if (d.requestId) {
    // Quick poll for 15s
    for (let i = 0; i < 7; i++) {
      await new Promise(r => setTimeout(r, 2000));
      const r2 = await fetch('https://api.polza.ai/v1/media/' + d.requestId, {
        headers: { Authorization: 'Bearer pza_KISnJy9mK8eyJWtDYmLp13DYncHw7UV1' }
      });
      const s = await r2.json();
      if (s.status === 'completed') { console.log(`COMPLETED after ${Date.now()-start}ms:`, JSON.stringify(s).substring(0,300)); return true; }
      if (s.status === 'failed') { console.log('FAILED:', JSON.stringify(s)); return false; }
    }
    console.log(`Still pending after ${Date.now()-start}ms`);
  }
  return false;
}

console.log('Testing models for sync response...');
await test('openai/gpt-image-1.5', { model: 'openai/gpt-image-1.5', prompt: 'cat', n: 1, aspect_ratio: '1:1', quality: 'medium' });
await test('qwen/image', { model: 'qwen/image', prompt: 'cat', n: 1, aspect_ratio: '1:1' });
await test('bytedance/seedream', { model: 'bytedance/seedream', prompt: 'cat', n: 1, size: '1:1' });
