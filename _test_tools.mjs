async function main() {
  // Тест webSearch
  const r = await fetch('https://lite.duckduckgo.com/lite/?q=' + encodeURIComponent('кот Матроскин'), { headers: { 'User-Agent': 'Mozilla/5.0' } });
  const html = await r.text();
  console.log('HTML length:', html.length);
  console.log('First 2000 chars:', html.substring(0, 2000));

  // Тест generateImage
  const res = await fetch('https://api.polza.ai/v1/images/generations', {
    method: 'POST',
    headers: { Authorization: 'Bearer pza_KISnJy9mK8eyJWtDYmLp13DYncHw7UV1', 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'flux-schnell', prompt: 'test cat', n: 1, size: '1024x1024' }),
  });
  console.log('Image API status:', res.status);
  const text = await res.text();
  console.log('Image API response:', text.substring(0, 500));
}
main();
