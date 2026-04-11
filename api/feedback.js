// Stores “did it sail?” reports in a simple append-only log via Google Sheets
// Uses a public Google Apps Script Web App as the backend (no auth needed for writes)
// The Apps Script URL is set via FEEDBACK_SHEET_URL environment variable in Vercel

module.exports = async function handler(req, res) {
res.setHeader(‘Access-Control-Allow-Origin’, ‘*’);
res.setHeader(‘Access-Control-Allow-Methods’, ‘POST, OPTIONS’);
res.setHeader(‘Access-Control-Allow-Headers’, ‘Content-Type’);

if (req.method === ‘OPTIONS’) {
return res.status(200).end();
}

if (req.method !== ‘POST’) {
return res.status(405).json({ error: ‘Method not allowed’ });
}

const { route, sailed, predictedChance, gustMph, waveM } = req.body || {};

if (!route || sailed === undefined) {
return res.status(400).json({ error: ‘Missing required fields: route, sailed’ });
}

const row = {
timestamp:       new Date().toISOString(),
route,
sailed:          sailed ? ‘YES’ : ‘NO’,
predictedChance: predictedChance ?? ‘’,
gustMph:         gustMph ?? ‘’,
waveM:           waveM ?? ‘’,
};

// If a Google Sheets Apps Script URL is configured, forward the data there
const sheetUrl = process.env.FEEDBACK_SHEET_URL;
if (sheetUrl) {
try {
await fetch(sheetUrl, {
method: ‘POST’,
headers: { ‘Content-Type’: ‘application/json’ },
body: JSON.stringify(row),
});
} catch (err) {
console.error(‘Sheet write failed:’, err.message);
// Don’t fail the request — just log it
}
} else {
// Log to Vercel function logs as fallback (visible in dashboard)
console.log(‘FEEDBACK:’, JSON.stringify(row));
}

res.status(200).json({ ok: true });
};
