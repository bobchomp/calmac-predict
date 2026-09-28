// Compass label for a wind direction in degrees
export function windDirLabel(deg) {
  if (deg === null || deg === undefined) return null;
  const dirs = ['N','NE','E','SE','S','SW','W','NW'];
  return dirs[Math.round(deg / 45) % 8];
}

export function chanceColor(pct) {
  if (pct >= 75) return 'var(--green)';
  if (pct >= 45) return 'var(--amber)';
  return 'var(--red)';
}

export function verdictEmoji(v) { return {likely:'✅',caution:'⚠️',unlikely:'❌',unknown:'❓'}[v]||'❓'; }

export function weatherDesc(code, vis) {
  if (vis !== undefined && vis < 1000) return '🌫 Fog/poor vis';
  if (code >= 95) return '⛈ Thunderstorm';
  if (code >= 80) return '🌧 Heavy showers';
  if (code >= 71) return '❄️ Snow';
  if (code >= 61) return '🌧 Rain';
  if (code >= 51) return '🌦 Drizzle';
  if (code >= 45) return '🌫 Fog';
  if (code >= 3)  return '☁️ Overcast';
  if (code >= 1)  return '⛅ Partly cloudy';
  return '☀️ Clear';
}

export function windClass(g) {
  if (g >= 45) return 'wind-danger';
  if (g >= 30) return 'wind-caution';
  return 'wind-safe';
}

export function escapeHtml(text) {
  return String(text ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export function linkifyDetail(text) {
  const seen = new Set();
  return escapeHtml(text).replace(/https?:\/\/[^\s]+/g, url => {
    if (seen.has(url)) return '';
    seen.add(url);
    const label = url.replace(/^https?:\/\/(www\.)?/, '').replace(/[/#?].*$/, '');
    return `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`;
  });
}
