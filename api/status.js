module.exports = async function handler(req, res) {
res.setHeader(‘Access-Control-Allow-Origin’, ‘*’);
res.setHeader(‘Cache-Control’, ‘s-maxage=300’);

try {
const response = await fetch(‘https://www.calmac.co.uk/service-status’, {
headers: {
‘User-Agent’: ‘Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36’,
‘Accept’: ‘text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8’,
‘Accept-Language’: ‘en-GB,en;q=0.9’,
}
});

```
if (!response.ok) {
  return res.status(200).json({ routes: [], debug: 'CalMac returned HTTP ' + response.status });
}

const html = await response.text();
const routes = parseCalMacStatus(html);

res.status(200).json({
  routes,
  fetchedAt: new Date().toISOString(),
  debug: 'parsed ' + routes.length + ' routes from ' + html.length + ' bytes'
});
```

} catch (err) {
// Return 200 with empty routes rather than 500 — weather still works without this
res.status(200).json({ routes: [], error: err.message, fetchedAt: new Date().toISOString() });
}
};

function stripTags(str) {
return str.replace(/<[^>]+>/g, ’ ’).replace(/\s+/g, ’ ’).replace(/&/g, ‘&’).replace(/ /g, ’ ’).replace(/&#\d+;/g, ‘’).trim();
}

function normaliseStatus(raw) {
const s = (raw || ‘’).toLowerCase();
if (s.includes(‘cancel’)) return ‘cancelled’;
if (s.includes(‘disrupt’) || s.includes(‘red’)) return ‘disrupted’;
if (s.includes(‘amber’) || s.includes(‘warning’)) return ‘amber’;
return ‘normal’;
}

function parseCalMacStatus(html) {
const routes = [];
const seen = new Set();

// Strategy 1: Look for elements with status-related classes containing route names
const patterns = [
/<(?:li|div|tr)[^>]*class=”([^”]*(?:amber|disrupted|cancelled|normal|status)[^”]*)”[^>]*>([\s\S]*?)(?=<(?:li|div|tr)[^>]*class=”[^”]*(?:amber|disrupted|cancelled|normal|status)|$)/gi,
/<(?:li|div)[^>]*data-status=”([^”]+)”[^>]*data-name=”([^”]+)”/gi,
];

// Try pattern with status in class
const re = /<(?:li|div|article)[^>]+class=”([^”]*)”[^>]*>([\s\S]{20,400}?)</(?:li|div|article)>/gi;
let m;
while ((m = re.exec(html)) !== null) {
const cls = m[1];
const inner = m[2];
if (!/amber|disrupted|cancelled|normal|status/i.test(cls)) continue;
const name = extractRouteName(inner);
if (!name || seen.has(name)) continue;
seen.add(name);
routes.push({ name, status: normaliseStatus(cls), message: stripTags(inner).slice(0, 120) });
}

// Strategy 2: Look for heading + status indicator pairs
if (routes.length === 0) {
const headings = html.matchAll(/<h[2-5][^>]*>([\s\S]*?)</h[2-5]>/gi);
for (const hm of headings) {
const name = stripTags(hm[1]).trim();
if (name.length < 5 || name.length > 80) continue;
if (!name.includes(’-’) && !name.includes(‘to’) && !name.includes(’–’)) continue;
// Look for status near this heading
const pos = hm.index;
const nearby = html.slice(Math.max(0, pos - 50), pos + 300);
const statusMatch = /class=”([^”]*(?:amber|disrupted|cancelled|normal)[^”]*)”/i.exec(nearby);
if (!seen.has(name)) {
seen.add(name);
routes.push({ name, status: normaliseStatus(statusMatch ? statusMatch[1] : ‘normal’), message: ‘’ });
}
}
}

return routes;
}

function extractRouteName(html) {
// Try h2-h5
const hm = /<h[2-5][^>]*>([\s\S]*?)</h[2-5]>/i.exec(html);
if (hm) {
const n = stripTags(hm[1]).trim();
if (n.length > 4 && n.length < 100) return n;
}
// Try anchor text
const am = /<a[^>]*>([\s\S]*?)</a>/i.exec(html);
if (am) {
const n = stripTags(am[1]).trim();
if (n.length > 4 && n.length < 100) return n;
}
// Try strong
const sm = /<strong[^>]*>([\s\S]*?)</strong>/i.exec(html);
if (sm) {
const n = stripTags(sm[1]).trim();
if (n.length > 4 && n.length < 100) return n;
}
return null;
}
