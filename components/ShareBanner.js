"use client";

export default function ShareBanner() {
  return (
    <div id="shareBanner" style={{display: 'none', background: 'var(--navy)', color: '#fff', padding: '10px 16px', fontSize: '.85rem', alignItems: 'center', gap: 10, justifyContent: 'center'}}>
      <span id="shareBannerText" />
      <button onClick={() => { document.getElementById('shareBanner').style.display = 'none'; }} style={{background: 'rgba(255,255,255,.15)', border: 'none', color: '#fff', borderRadius: 12, padding: '3px 10px', fontSize: '.78rem', cursor: 'pointer', fontFamily: 'inherit'}}>✕ Dismiss</button>
    </div>
  );
}
