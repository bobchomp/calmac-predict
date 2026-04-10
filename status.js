export const config = { runtime: ‘edge’ };

export default async function handler(req) {
try {
const res = await fetch(‘https://www.calmac.co.uk/service-status’, {
headers: {
‘User-Agent’: ‘Mozilla/5.0 (compatible; CalMacPredictor/1.0)’,
‘Accept’: ‘text/html’
}
});

```
const html = await res.text();

// Parse route status from CalMac's service status page
const routes = parseCalMacStatus(html);

return new Response(JSON.stringify({ routes, fetchedAt: new Date().toISOString() }), {
  headers: {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 's-maxage=300' // cache 5 mins
  }
});
```

} catch (err) {
return new Response(JSON.stringify({ error: err.message, routes: [] }), {
status: 500,
headers: { ‘Content-Type’: ‘application/json’, ‘Access-Control-Allow-Origin’: ‘*’ }
});
}
}

function parseCalMacStatus(html) {
const routes = [];

// CalMac service status page uses a list of routes with status indicators
// Match route entries - they use classes like “status-normal”, “status-amber”, “status-disrupted”
const routeBlockRegex = /<div[^>]*class=”[^”]*service-status[^”]*”[^>]*>([\s\S]*?)</div>/gi;
const nameRegex = /<h[23][^>]*>([\s\S]*?)</h[23]>/i;
const statusRegex = /status-(normal|amber|disrupted|cancelled|red)/i;
const messageRegex = /<p[^>]*>([\s\S]*?)</p>/i;

// Try to extract route rows from a table or list structure
// CalMac uses a definition-list style layout
const rowRegex = /<(?:li|tr|div)[^>]*class=”[^”]*(?:route|service)[^”]*”[^>]*>([\s\S]*?)(?=<(?:li|tr|div)[^>]*class=”[^”]*(?:route|service)|$)/gi;

let match;
while ((match = rowRegex.exec(html)) !== null) {
const block = match[1];
const nameMatch = nameRegex.exec(block) || /<a[^>]*>([\s\S]*?)</a>/i.exec(block);
const statusMatch = statusRegex.exec(block) || statusRegex.exec(match[0]);
const msgMatch = messageRegex.exec(block);

```
if (nameMatch) {
  const name = stripTags(nameMatch[1]).trim();
  if (name.length > 2) {
    routes.push({
      name,
      status: normaliseStatus(statusMatch ? statusMatch[1] : 'normal'),
      message: msgMatch ? stripTags(msgMatch[1]).trim() : ''
    });
  }
}
```

}

// Fallback: try a broader pattern if nothing found
if (routes.length === 0) {
const altRegex = /data-route=”([^”]+)”[^>]*data-status=”([^”]+)”/gi;
while ((match = altRegex.exec(html)) !== null) {
routes.push({
name: match[1],
status: normaliseStatus(match[2]),
message: ‘’
});
}
}

return routes;
}

function normaliseStatus(raw) {
const s = (raw || ‘’).toLowerCase();
if (s.includes(‘cancel’)) return ‘cancelled’;
if (s.includes(‘red’) || s.includes(‘disrupt’)) return ‘disrupted’;
if (s.includes(‘amber’)) return ‘amber’;
return ‘normal’;
}

function stripTags(str) {
return str.replace(/<[^>]+>/g, ‘’).replace(/&/g, ‘&’).replace(/ /g, ’ ’).replace(/&#\d+;/g, ‘’).trim();
}
