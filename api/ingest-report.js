// api/ingest-report.js — Monthly CalMac performance report ingestion
// Called by cron-job.org on the 1st of each month via:
//   GET https://willitsail.rossmackenzie.co.uk/api/ingest-report?secret=<CRON_SECRET>
//
// The CalMac corporate site is JavaScript-rendered, so auto-discovery of new
// PDFs isn't reliable. Instead, pass the PDF URL directly each month:
//   GET /api/ingest-report?secret=<SECRET>&url=<PDF_URL>
//
// Workflow each month:
//   1. CalMac publish the new PDF at corporate.calmac.co.uk
//   2. Copy the PDF link
//   3. Trigger: /api/ingest-report?secret=...&url=https://corporate.calmac.co.uk/.../report.pdf
//
// The cron-job.org monthly trigger (no ?url param) will attempt auto-discovery
// as a best-effort fallback — update the cron URL when a new report is published.

const SHEET_SCRIPT_URL = process.env.SHEET_SCRIPT_URL || '';
const CRON_SECRET      = process.env.CRON_SECRET       || '';

const REPORT_INDEX_URL =
  'https://corporate.calmac.co.uk/en-gb/about-us/route-performance-reports/';

// ── Attempt to find a PDF link from the index page ───────────────────────
// CalMac's corporate site renders via JS so this may not find anything —
// that's expected. The ?url= param is the reliable path.
async function findLatestPdfUrl() {
  const resp = await fetch(REPORT_INDEX_URL, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CalMacBot/1.0)' },
    signal: AbortSignal.timeout(15000),
  });
  if (!resp.ok) throw new Error(`Index page ${resp.status}`);
  const html = await resp.text();

  // Look for PDF links in any attribute (href, src, data-url, etc.)
  const pdfPattern = /(?:href|src|data-[a-z-]+)="([^"]*corporate\.calmac[^"]*\.pdf[^"]*)"/gi;
  let matches = [...html.matchAll(pdfPattern)].map(m => m[1]);

  // Fallback: any .pdf link at all
  if (!matches.length) {
    matches = [...html.matchAll(/href="([^"]*\.pdf)"/gi)].map(m => m[1]);
  }

  if (!matches.length) {
    throw new Error(
      'CalMac corporate site is JS-rendered — no PDF links in raw HTML. ' +
      'Trigger manually with ?url=<PDF_URL> after finding the link on ' +
      'corporate.calmac.co.uk/en-gb/about-us/route-performance-reports/'
    );
  }

  const relevant = matches.filter(u => /route.performance|reliability/i.test(u));
  const url = relevant[0] || matches[0];

  if (url.startsWith('http')) return url;
  if (url.startsWith('//'))   return 'https:' + url;
  return new URL(url, REPORT_INDEX_URL).href;
}

// ── Download PDF and return buffer ───────────────────────────────────────
async function downloadPdf(url) {
  const resp = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!resp.ok) throw new Error(`PDF download ${resp.status} from ${url}`);
  const arrayBuf = await resp.arrayBuffer();
  return Buffer.from(arrayBuf);
}

// ── Parse reliability figures from extracted PDF text ────────────────────
//
// CalMac PDFs typically contain tables like:
//   Ardrossan – Brodick (Arran)   420   18   4   2   96.2%
// Columns: route | scheduled | weather cancels | technical | operational | reliability%
//
// This parser is intentionally flexible — it looks for route names we know
// and extracts the numbers that follow on the same line.
function parseReportText(text) {
  const KNOWN_ROUTES = [
    'Ardrossan',  'Brodick',   'Wemyss Bay', 'Rothesay',  'Gourock',
    'Dunoon',     'Oban',      'Craignure',  'Stornoway', 'Ullapool',
    'Kennacraig', 'Islay',     'Mallaig',    'Armadale',  'Tarbert',
    'Lochmaddy',  'Largs',     'Cumbrae',    'Colintraive','Fishnish',
    'Lochaline',  'Colonsay',  'Lismore',    'Tiree',     'Coll',
    'Tobermory',  'Kilchoan',  'Claonaig',   'Lochranza', 'Troon',
    'Portavadie', 'Portavadie','Feolin',      'Jura',      'Lochboisdale',
    'Castlebay',  'Small Isles','Raasay',    'Iona',       'Gigha',
  ];

  const routePattern = new RegExp(
    `(${KNOWN_ROUTES.join('|')}[^\\n]{0,60})\\n?\\s*` +
    `(\\d+)\\s+(\\d+)\\s+(\\d+)\\s+(\\d+)\\s+([\\d.]+)%?`,
    'gi'
  );

  const rows = [];
  for (const m of text.matchAll(routePattern)) {
    const routeRaw     = m[1].trim().replace(/\s+/g, ' ');
    const scheduled    = parseInt(m[2], 10);
    const weatherCanx  = parseInt(m[3], 10);
    const technicalCanx = parseInt(m[4], 10);
    const otherCanx    = parseInt(m[5], 10);
    const reliability  = parseFloat(m[6]);
    if (scheduled > 0) {
      rows.push({ route: routeRaw, scheduled, weatherCanx, technicalCanx, otherCanx, reliability });
    }
  }

  // Fallback: look for percentage figures near route names line by line
  if (rows.length === 0) {
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!KNOWN_ROUTES.some(r => line.includes(r))) continue;
      const numbers = line.match(/\d+(\.\d+)?/g);
      if (numbers && numbers.length >= 2) {
        rows.push({
          route:          line.trim().replace(/\s+/g, ' ').substring(0, 80),
          scheduled:      parseInt(numbers[0], 10) || null,
          weatherCanx:    parseInt(numbers[1], 10) || null,
          technicalCanx:  parseInt(numbers[2], 10) || null,
          otherCanx:      parseInt(numbers[3], 10) || null,
          reliability:    parseFloat(numbers[numbers.length - 1]) || null,
        });
      }
    }
  }

  return rows;
}

// ── Derive month label from PDF URL or current date ───────────────────────
function monthLabel(pdfUrl) {
  // Try to extract month/year from URL (e.g. "may-2026" or "2026-05")
  const m = pdfUrl.match(/(\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[-_]?\d{4}\b)/i)
         || pdfUrl.match(/(\d{4}[-_](?:0[1-9]|1[0-2]))/);
  if (m) return m[1];
  // Fall back to previous month (reports are published with a month lag)
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
}

// ── Handler ───────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const secret = req.query?.secret || (req.headers['authorization'] || '').replace('Bearer ', '');
  if (CRON_SECRET && secret !== CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // 1. Find the latest PDF — accept ?url= to skip auto-discovery
    const pdfUrl = req.query?.url || await findLatestPdfUrl();

    // 2. Download it
    const pdfBuffer = await downloadPdf(pdfUrl);

    // 3. Extract text (dynamic import keeps the bundle lean)
    let text;
    try {
      const pdfParse = require('pdf-parse');
      const data = await pdfParse(pdfBuffer);
      text = data.text;
    } catch (parseErr) {
      return res.status(500).json({ error: 'PDF parse failed: ' + parseErr.message, pdfUrl });
    }

    // 4. Parse route-level figures
    const rows = parseReportText(text);
    if (rows.length === 0) {
      // Return the raw text so the Apps Script / human can inspect it
      return res.status(200).json({
        ok: false,
        reason: 'Could not extract structured rows — see rawTextSample',
        pdfUrl,
        rawTextSample: text.substring(0, 2000),
      });
    }

    const period = monthLabel(pdfUrl);

    // 5. Post to Google Apps Script
    let sheetResult = null;
    if (SHEET_SCRIPT_URL) {
      const sheetResp = await fetch(SHEET_SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'ingestReport', period, rows, pdfUrl }),
        signal: AbortSignal.timeout(15000),
      });
      sheetResult = await sheetResp.json().catch(() => null);
    }

    return res.status(200).json({ ok: true, period, pdfUrl, rowCount: rows.length, rows, sheetResult });

  } catch (err) {
    console.error('ingest-report.js error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
