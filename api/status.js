module.exports = async function handler(req, res) {
res.setHeader(‘Access-Control-Allow-Origin’, ‘*’);
res.setHeader(‘Cache-Control’, ‘s-maxage=300’);

try {
const response = await fetch(‘https://www.calmac.co.uk/service-status’, {
headers: {
‘User-Agent’: ‘Mozilla/5.0 (compatible; CalMacPredictor/1.0)’,
‘Accept’: ‘text/html,application/xhtml+xml’
}
});

```
const html = await response.text();
const routes = parseCalMacStatus(html);

res.status(200).json({ routes, fetchedAt: new Date().toISOString() });
```

} catch (err) {
res.status(500).json({ error: err.message, routes: [] });
}
};

function stripTags(str) {
return str.replace(/<[^>]+>/g, ‘’).replace(/&/g, ‘&’).replace(/ /g, ’ ’).replace(/&#\d+;/g, ‘’).trim();
}

function normaliseStatus(raw) {
const s = (raw || ‘’).toLowerCase();
if (s.includes(‘cancel’)) return ‘cancelled’;
if (s.includes(‘red’) || s.includes(‘disrupt’)) return ‘disrupted’;
if (s.includes(‘amber’)) return ‘amber’;
if (s.includes(‘normal’) || s.includes(‘green’)) return ‘normal’;
return ‘normal’;
}

function parseCalMacStatus(html) {
const routes = [];

// CalMac’s service status page has route entries with status classes
// Try multiple patterns to be resilient to page structure changes

// Pattern 1: data attributes
const dataAttrRegex = /data-route-name=”([^”]+)”[^>]*data-status=”([^”]+)”/gi;
let m;
while ((m = dataAttrRegex.exec(html)) !== null) {
routes.push({ name: m[1].trim(), status: normaliseStatus(m[2]) });
}
if (routes.length > 0) return routes;

// Pattern 2: list items with status class and route name
const liRegex = /<li[^>]*class=”([^”]*(?:normal|amber|disrupted|cancelled|red)[^”]*)”[^>]*>([\s\S]*?)</li>/gi;
while ((m = liRegex.exec(html)) !== null) {
const statusClass = m[1];
const content = stripTags(m[2]).trim();
if (content.length > 3 && content.length < 120) {
routes.push({ name: content, status: normaliseStatus(statusClass), message: ‘’ });
}
}
if (routes.length > 0) return routes;

// Pattern 3: h3/h4 inside a div that has a status class
const divRegex = /<div[^>]*class=”([^”]*(?:normal|amber|disrupted|cancelled|red|service)[^”]*)”[^>]*>([\s\S]*?)</div>/gi;
while ((m = divRegex.exec(html)) !== null) {
const statusClass = m[1];
const inner = m[2];
const nameMatch = /<h[2-5][^>]*>([\s\S]*?)</h[2-5]>/i.exec(inner);
if (nameMatch) {
const name = stripTags(nameMatch[1]).trim();
if (name.length > 3) {
routes.push({ name, status: normaliseStatus(statusClass), message: ‘’ });
}
}
}

return routes;
}
