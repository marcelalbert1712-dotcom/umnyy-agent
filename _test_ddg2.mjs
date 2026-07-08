async function main() {
  // Try the HTML version of DDG (POST-based)
  const r = await fetch('https://html.duckduckgo.com/html/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Mozilla/5.0' },
    body: 'q=' + encodeURIComponent('hello world'),
  });
  const html = await r.text();
  console.log('HTML length:', html.length);
  // Look for result links
  const matches = [...html.matchAll(/<a[^>]+class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi)];
  console.log('Result links found:', matches.length);
  if (matches.length > 0) {
    for (const m of matches.slice(0, 3)) {
      console.log('Link:', m[1].substring(0, 100));
      console.log('Text:', m[2].replace(/<[^>]*>/g, '').substring(0, 80));
    }
  } else {
    // Try other patterns
    const patterns = ['result__a', 'result__title', 'result-link', 'result-link__item', 'result_url', 'result-title'];
    for (const p of patterns) {
      const idx = html.indexOf(p);
      if (idx > -1) console.log(`Found "${p}" at position ${idx}:`, html.substring(idx, idx + 200));
    }
    if (html.indexOf('result') === -1) {
      console.log('No results found. Sample:', html.substring(0, 3000));
    }
  }
}
main();
