async function main() {
  const r = await fetch('https://html.duckduckgo.com/html/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Mozilla/5.0' },
    body: 'q=' + encodeURIComponent('hello world'),
  });
  const html = await r.text();
  // Find snippets
  const snippetIdx = html.indexOf('result__snippet');
  console.log('Snippet sample:');
  console.log(html.substring(Math.max(0, snippetIdx - 200), snippetIdx + 500));
  // Also show full result_article structure
  const articleIdx = html.indexOf('result__article');
  console.log('Article sample:');
  console.log(html.substring(Math.max(0, articleIdx - 100), articleIdx + 1500));
}
main();
