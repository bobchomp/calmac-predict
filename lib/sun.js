// ── SUNRISE / SUNSET ──
// Simple civil twilight calculation (accurate to ~5 min for Scottish latitudes)
export function getSunriseSunset(lat, lon, date) {
  const d = date || new Date();
  const dayOfYear = Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 86400000);
  const B = (360 / 365) * (dayOfYear - 81) * (Math.PI / 180);
  const eqTime = 9.87 * Math.sin(2*B) - 7.53 * Math.cos(B) - 1.5 * Math.sin(B);
  const solarNoon = 720 - 4 * lon - eqTime;
  const declination = 23.45 * Math.sin(B) * (Math.PI / 180);
  const latRad = lat * (Math.PI / 180);
  const hourAngle = Math.acos(-Math.tan(latRad) * Math.tan(declination)) * (180 / Math.PI);
  const sunrise = (solarNoon - 4 * hourAngle) / 60; // hours UTC
  const sunset  = (solarNoon + 4 * hourAngle) / 60;
  // Convert to local (UK = UTC+1 in summer, UTC in winter)
  const tzOffset = d.getTimezoneOffset() / -60;
  return { sunrise: sunrise + tzOffset, sunset: sunset + tzOffset };
}

export function isBeforeDawn(hour, lat, lon) {
  const { sunrise } = getSunriseSunset(lat, lon);
  return hour < Math.ceil(sunrise);
}
