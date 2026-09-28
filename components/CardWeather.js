"use client";

// A route card's weather summary row.
export function CardWeather({ gust, windDir, wave, vis, desc }) {
  return (
    <>
      <div className="wx-item">💨 <strong>{gust}</strong>{windDir !== null && <> <span style={{ opacity: 0.6, fontSize: ".78rem" }}>{windDir}</span></>}</div>
      <div className="wx-item">🌊 <strong>{wave}</strong></div>
      {vis !== null && <div className="wx-item">🌫 <strong>{vis} vis</strong></div>}
      <div className="wx-item">{desc}</div>
    </>
  );
}

// The gust bar under it; its colour comes from the container's wind-* class.
export function WindBar({ gustPct }) {
  return (
    <div className="wind-bar-track"><div className="wind-bar-fill" style={{ width: `${gustPct}%` }} /></div>
  );
}
