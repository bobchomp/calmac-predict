// ============================================================
// CalMac Historical Data - Apps Script
// Handles: reliability data ingestion, threshold calculation,
//          user feedback writes, and data serving to the site
// ============================================================

const SHEET_ID = SpreadsheetApp.getActiveSpreadsheet().getId();
const RELIABILITY_TAB  = 'route_reliability';
const THRESHOLDS_TAB   = 'route_thresholds';
const REPORTS_TAB      = 'user_reports';
const SAILING_TAB      = 'SailingRecords';   // NEW: 30-min cron data

// Season definitions (months)
const WINTER   = [11, 12, 1, 2];   // Nov–Feb
const SUMMER   = [5, 6, 7, 8, 9];  // May–Sep
// shoulder = everything else (Mar, Apr, Oct)

// ── CalMac reliability PDF URLs ──────────────────────────────
// These are the per-route monthly reliability PDFs from CalMac.
// The hash in the URL is stable — these don't move.
const RELIABILITY_PDFS = {
  'Ullapool - Stornoway (Lewis)':          'https://assets.calmac.co.uk/media/c3uaxeng/ullapool-stornoway.pdf',
  'Kennacraig - Port Ellen / Port Askaig (Islay)': 'https://assets.calmac.co.uk/media/awbo0nn5/kennacraig-islay.pdf',
  'Tobermory - Kilchoan':                  'https://assets.calmac.co.uk/media/mkjectk4/stt-table-14-tob-kic.pdf',
  'Wemyss Bay - Rothesay (Bute)':          'https://assets.calmac.co.uk/media/jdyayuiq/wemyss-bay-rothesay.pdf',
  'Gourock - Dunoon':                      'https://assets.calmac.co.uk/media/fw5fovvc/gourock-dunoon.pdf',
  'Tarbert - Portavadie':                  'https://assets.calmac.co.uk/media/ocpluysp/tarbert-portavadie.pdf',
  'Ardrossan - Brodick (Arran)':           'https://assets.calmac.co.uk/media/4mgokoan/stt-05-ardrossan-brodick.pdf',
};

// ── Manually entered data (PDFs we can't auto-parse) ─────────
// Format: { route_key: [ [year, month, scheduled, operated, cancelled, reliability_pct], ... ] }
const MANUAL_DATA = {
  'Ullapool - Stornoway (Lewis)': [
    [2024,  2, 158, 150, 10, 93.7],
    [2024,  3, 168, 156, 12, 92.9],
    [2024,  4, 172, 164,  8, 95.3],
    [2024,  5, 178, 178,  0, 100.0],
    [2024,  6, 170, 170,  0, 100.0],
    [2024,  7, 178, 178,  0, 100.0],
    [2024,  8, 177, 175,  2, 98.9],
    [2024,  9, 171, 167,  4, 97.7],
    [2024, 10, 191, 176, 20, 89.5],
    [2024, 11, 180, 146, 34, 81.1],
    [2024, 12, 156, 128, 28, 82.1],
    [2025,  1, 163, 139, 24, 85.3],
  ],
  'Kennacraig - Port Ellen / Port Askaig (Islay)': [
    [2024,  6, 249, 250, 37, 85.1],
    [2024,  7, 270, 277, 52, 80.7],
    [2024,  8, 269, 262, 19, 92.9],
    [2024,  9, 270, 270, 17, 93.7],
    [2024, 10, 230, 218, 26, 88.7],
    [2024, 11, 151, 145,  7, 95.4],
    [2024, 12, 147, 139, 15, 89.8],
    [2025,  1, 156, 148,  9, 94.2],
    [2025,  2, 144, 140,  9, 93.8],
    [2025,  3, 160, 162,  0, 100.0],
    [2025,  4, 264, 267,  6, 97.7],
    [2025,  5, 292, 299, 10, 96.6],
  ],
  'Tobermory - Kilchoan': [
    [2024,  7, 418, 410,  8, 98.1],
    [2024,  8, 418, 400, 30, 92.8],
    [2024,  9, 400, 380, 20, 95.0],
    [2024, 10, 336, 320, 16, 95.2],
    [2024, 11, 172, 166,  6, 96.5],
    [2024, 12, 164, 146, 18, 89.0],
    [2025,  1, 170, 158, 12, 92.9],
    [2025,  2, 160, 140, 22, 86.3],
    [2025,  3, 206, 196, 10, 95.1],
    [2025,  4, 404, 390, 14, 96.5],
    [2025,  5, 418, 416,  4, 99.0],
    [2025,  6, 400, 400,  0, 100.0],
  ],
};

// ── doGet: serve data to the site ────────────────────────────
function doGet(e) {
  const action = e.parameter.action;
  let result;

  try {
    if (action === 'getThresholds') {
      result = getThresholds();
    } else if (action === 'getReliability') {
      result = getReliabilityData(e.parameter.route);
    } else if (action === 'getStats') {
      result = getStats();
    } else {
      result = { error: 'Unknown action' };
    }
  } catch (err) {
    result = { error: err.toString() };
  }

  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── doPost: receive data from the site and cron jobs ─────────
function doPost(e) {
  let result;
  try {
    const data = JSON.parse(e.postData.contents);

    if (data.action === 'submitReport') {
      result = writeUserReport(data);
    } else if (data.action === 'seedData') {
      result = seedAllData();
    } else if (data.action === 'recalculate') {
      result = recalculateThresholds();
    } else if (data.action === 'recordStatus') {   // ← NEW
      result = recordStatus(data);
    } else if (data.action === 'ingestReport') {   // ← NEW
      result = ingestReport(data);
    } else {
      result = { error: 'Unknown action' };
    }
  } catch (err) {
    result = { error: err.toString() };
  }

  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── getThresholds: return calculated thresholds for all routes
function getThresholds() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName(THRESHOLDS_TAB);
  const data = sheet.getDataRange().getValues();

  const thresholds = {};
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row[0]) continue;
    thresholds[row[0]] = {
      base:     parseFloat(row[1]) || null,
      winter:   parseFloat(row[2]) || null,
      summer:   parseFloat(row[3]) || null,
      shoulder: parseFloat(row[4]) || null,
      samples:  parseInt(row[5])   || 0,
      updated:  row[6] || '',
    };
  }
  return { thresholds, generated: new Date().toISOString() };
}

// ── getReliabilityData: monthly breakdown for a route ────────
function getReliabilityData(routeKey) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName(RELIABILITY_TAB);
  const data = sheet.getDataRange().getValues();

  const rows = [];
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === routeKey) {
      rows.push({
        year:         data[i][1],
        month:        data[i][2],
        scheduled:    data[i][3],
        operated:     data[i][4],
        cancelled:    data[i][5],
        diverted:     data[i][6],
        reliability:  data[i][7],
      });
    }
  }
  return { route: routeKey, data: rows };
}

// ── getStats: summary stats for About tab ────────────────────
function getStats() {
  const ss = SpreadsheetApp.openById(SHEET_ID);

  const relSheet = ss.getSheetByName(RELIABILITY_TAB);
  const relRows  = relSheet.getLastRow() - 1;

  const repSheet = ss.getSheetByName(REPORTS_TAB);
  const repRows  = repSheet.getLastRow() - 1;

  const thrSheet = ss.getSheetByName(THRESHOLDS_TAB);
  const thrRows  = thrSheet.getLastRow() - 1;

  // Count real-time sailing records collected so far
  var sailSheet  = ss.getSheetByName(SAILING_TAB);
  var sailRows   = sailSheet ? sailSheet.getLastRow() - 1 : 0;

  return {
    reliability_months: relRows,
    user_reports:       repRows,
    routes_calibrated:  thrRows,
    sailing_records:    sailRows,
    last_updated:       new Date().toISOString(),
  };
}

// ── writeUserReport: log a "did it sail" submission ──────────
function writeUserReport(data) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName(REPORTS_TAB);

  sheet.appendRow([
    new Date().toISOString(),
    data.route    || '',
    data.sailed   ? 'YES' : 'NO',
    data.wind_mph || '',
    data.wave_m   || '',
    data.notes    || '',
  ]);

  return { success: true, message: 'Report logged' };
}

// ── seedAllData: write all manual data to the reliability tab
function seedAllData() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName(RELIABILITY_TAB);

  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.deleteRows(2, lastRow - 1);
  }

  const rows = [];
  for (const [routeKey, dataPoints] of Object.entries(MANUAL_DATA)) {
    for (const [year, month, scheduled, operated, cancelled, reliability] of dataPoints) {
      rows.push([routeKey, year, month, scheduled, operated, cancelled, 0, reliability]);
    }
  }

  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, 8).setValues(rows);
  }

  recalculateThresholds();

  return { success: true, rows_written: rows.length };
}

// ── recalculateThresholds: derive per-season reliability ─────
function recalculateThresholds() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const relSheet = ss.getSheetByName(RELIABILITY_TAB);
  const thrSheet = ss.getSheetByName(THRESHOLDS_TAB);

  const data = relSheet.getDataRange().getValues();

  const byRoute = {};
  for (let i = 1; i < data.length; i++) {
    const [route, year, month, scheduled, operated, cancelled, diverted, reliability] = data[i];
    if (!route) continue;

    if (!byRoute[route]) byRoute[route] = { all: [], winter: [], summer: [], shoulder: [] };

    const rel = parseFloat(reliability);
    byRoute[route].all.push(rel);

    if (WINTER.includes(parseInt(month)))       byRoute[route].winter.push(rel);
    else if (SUMMER.includes(parseInt(month)))  byRoute[route].summer.push(rel);
    else                                         byRoute[route].shoulder.push(rel);
  }

  const repSheet = ss.getSheetByName(REPORTS_TAB);
  const reports  = repSheet.getDataRange().getValues();
  for (let i = 1; i < reports.length; i++) {
    const [timestamp, route, sailed] = reports[i];
    if (!route || !byRoute[route]) continue;
    const val   = sailed === 'YES' ? 100 : 0;
    const month = new Date(timestamp).getMonth() + 1;
    byRoute[route].all.push(val);
    if (WINTER.includes(month))       byRoute[route].winter.push(val);
    else if (SUMMER.includes(month))  byRoute[route].summer.push(val);
    else                               byRoute[route].shoulder.push(val);
  }

  const avg = arr => arr.length ? (arr.reduce((a,b)=>a+b,0)/arr.length).toFixed(1) : '';

  const thrLastRow = thrSheet.getLastRow();
  if (thrLastRow > 1) thrSheet.deleteRows(2, thrLastRow - 1);

  const rows = [];
  for (const [route, d] of Object.entries(byRoute)) {
    rows.push([
      route,
      avg(d.all),
      avg(d.winter),
      avg(d.summer),
      avg(d.shoulder),
      d.all.length,
      new Date().toISOString(),
    ]);
  }

  if (rows.length > 0) {
    thrSheet.getRange(2, 1, rows.length, 7).setValues(rows);
  }

  return { success: true, routes_calculated: rows.length };
}

// ── Trigger: auto-recalculate thresholds daily ───────────────
function createDailyTrigger() {
  ScriptApp.newTrigger('recalculateThresholds')
    .timeBased()
    .everyDays(1)
    .atHour(3)
    .create();
}


// ════════════════════════════════════════════════════════════
// NEW: recordStatus — called by api/record.js every 30 minutes
// Appends live route status + weather to SailingRecords sheet.
// Creates the sheet and headers automatically on first run.
// ════════════════════════════════════════════════════════════
function recordStatus(payload) {
  const ss    = SpreadsheetApp.openById(SHEET_ID);
  let   sheet = ss.getSheetByName(SAILING_TAB);

  if (!sheet) {
    sheet = ss.insertSheet(SAILING_TAB);
    const headers = [
      'Timestamp', 'Route', 'Status', 'DisruptionReason',
      'Gust_ms', 'Wind_ms', 'Wave_m', 'WeatherCode'
    ];
    sheet.appendRow(headers);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  }

  const records = payload.records || [];
  if (records.length === 0) return { ok: true, appended: 0 };

  const rows = records.map(function(r) {
    return [
      r.timestamp    || new Date().toISOString(),
      r.route        || '',
      r.status       || 'unknown',
      r.reason       || '',
      r.gust_ms      != null ? r.gust_ms      : '',
      r.wind_ms      != null ? r.wind_ms      : '',
      r.wave_m       != null ? r.wave_m       : '',
      r.weather_code != null ? r.weather_code : '',
    ];
  });

  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, 8).setValues(rows);
  return { ok: true, appended: rows.length };
}


// ════════════════════════════════════════════════════════════
// NEW: ingestReport — called by api/ingest-report.js monthly
// Each row already carries routeKey, year, month, scheduled,
// operated, cancelled, diverted, reliability.
// Deduplicates by routeKey+year+month so re-runs are safe.
// ════════════════════════════════════════════════════════════
function ingestReport(payload) {
  const rows = payload.rows || [];
  if (rows.length === 0) return { ok: false, reason: 'No rows received' };

  const ss       = SpreadsheetApp.openById(SHEET_ID);
  const relSheet = ss.getSheetByName(RELIABILITY_TAB);

  // Build a set of existing routeKey|year|month keys to avoid duplicates
  const existing     = relSheet.getDataRange().getValues();
  const existingKeys = new Set();
  for (let i = 1; i < existing.length; i++) {
    if (existing[i][0]) {
      existingKeys.add(existing[i][0] + '|' + existing[i][1] + '|' + existing[i][2]);
    }
  }

  // Filter duplicates, map to sheet row format:
  //   [routeKey, year, month, scheduled, operated, cancelled, diverted, reliability]
  const newRows = rows
    .filter(function(r) {
      return r.routeKey && r.year && r.month && r.scheduled > 0
        && !existingKeys.has(r.routeKey + '|' + r.year + '|' + r.month);
    })
    .map(function(r) {
      return [
        r.routeKey,
        r.year,
        r.month,
        r.scheduled,
        r.operated   || 0,
        r.cancelled  || 0,
        r.diverted   || 0,
        r.reliability,
      ];
    });

  if (newRows.length > 0) {
    relSheet.getRange(relSheet.getLastRow() + 1, 1, newRows.length, 8).setValues(newRows);
  }

  // Immediately recalculate thresholds so the site picks up the new data
  const calcResult = recalculateThresholds();

  return {
    ok:                 true,
    received:           rows.length,
    inserted:           newRows.length,
    skipped_duplicates: rows.length - newRows.length,
    thresholds_updated: calcResult.routes_calculated,
  };
  
}
