async function main() {
  const r = await fetch('https://lite.duckduckgo.com/lite/?q=' + encodeURIComponent('hello world'), { headers: { 'User-Agent': 'Mozilla/5.0' } });
  const html = await r.text();
  const idx = html.indexOf('class="result');
  console.log('Sample around result:');
  console.log(html.substring(Math.max(0, idx - 300), idx + 1000));
  console.log('---');
  // Also search for links with results
  const linkIdx = html.indexOf('nofollow');
  console.log('Sample around nofollow:');
  console.log(html.substring(Math.max(0, linkIdx - 300), linkIdx + 1000));
}
main();
