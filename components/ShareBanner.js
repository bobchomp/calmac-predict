"use client";

import { shareBannerStore, showShareBanner } from "../lib/overlays";

// "Sam shared … with you", shown when the page is opened from a share link
export default function ShareBanner() {
  const { text } = shareBannerStore.use();
  return (
    <div id="shareBanner" style={{display: text ? 'flex' : 'none', background: 'var(--navy)', color: '#fff', padding: '10px 16px', fontSize: '.85rem', alignItems: 'center', gap: 10, justifyContent: 'center'}}>
      <span id="shareBannerText">{text}</span>
      <button onClick={() => showShareBanner(null)} style={{background: 'rgba(255,255,255,.15)', border: 'none', color: '#fff', borderRadius: 12, padding: '3px 10px', fontSize: '.78rem', cursor: 'pointer', fontFamily: 'inherit'}}>✕ Dismiss</button>
    </div>
  );
}
