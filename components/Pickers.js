"use client";

import { useEffect, useRef, useState } from "react";
import { getNotifThreshold, setNotifThreshold } from "../lib/prefs";
import {
  closeSharePicker, closeThresholdPicker, sharePickerStore, showToast, thresholdStore,
} from "../lib/overlays";

// Close when tapping outside the picker (or its opening button). Starts
// listening a moment after opening so the opening tap doesn't count.
function useOutsideTap(ref, active, onOutside, anchor) {
  useEffect(() => {
    if (!active) return;
    const onClick = e => {
      if (!ref.current?.contains(e.target) && !anchor?.contains(e.target)) onOutside();
    };
    const timer = setTimeout(() => document.addEventListener("click", onClick), 100);
    return () => { clearTimeout(timer); document.removeEventListener("click", onClick); };
  }, [ref, active, onOutside, anchor]);
}

const cancelStyle = { flex: 1, borderRadius: 10, border: "1.5px solid var(--light)", background: "var(--white)", fontFamily: "inherit", fontSize: ".85rem", fontWeight: 600, cursor: "pointer" };
const confirmStyle = { flex: 1, borderRadius: 10, border: "none", background: "var(--blue)", color: "#fff", fontFamily: "inherit", fontSize: ".85rem", fontWeight: 600, cursor: "pointer" };

// ── Alert threshold picker ──
export function ThresholdPicker() {
  const { routeName, anchor, id } = thresholdStore.use();
  return routeName ? <ThresholdPickerSheet key={id} routeName={routeName} anchor={anchor} /> : null;
}

function ThresholdPickerSheet({ routeName, anchor }) {
  const ref = useRef(null);
  const [value, setValue] = useState(() => getNotifThreshold(routeName));
  useOutsideTap(ref, true, closeThresholdPicker, anchor);

  const confirm = () => {
    setNotifThreshold(routeName, value);
    closeThresholdPicker();
    window.enableRouteAlerts(routeName);
  };

  return (
    <div
      ref={ref}
      className="threshold-picker"
      style={{
        position: "fixed", bottom: "calc(80px + env(safe-area-inset-bottom) + 8px)", left: "50%", transform: "translateX(-50%)",
        background: "var(--white)", borderRadius: 16, boxShadow: "0 8px 40px rgba(0,48,135,0.18)",
        padding: "18px 20px", zIndex: 900, width: "min(320px,90vw)",
      }}
    >
      <div style={{ fontWeight: 700, fontSize: ".9rem", color: "var(--navy)", marginBottom: 4 }}>Alert threshold for</div>
      <div style={{ fontSize: ".8rem", color: "var(--muted)", marginBottom: 14 }}>{routeName}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
        <span style={{ fontSize: ".8rem", color: "var(--muted)" }}>Always</span>
        <input
          type="range" min={30} max={90} step={5} value={value} id="threshSlider"
          style={{ flex: 1, accentColor: "var(--blue)" }}
          onChange={e => setValue(parseInt(e.target.value))}
        />
        <span style={{ fontSize: ".8rem", color: "var(--muted)" }}>Never</span>
      </div>
      <div style={{ textAlign: "center", fontFamily: "'Syne',sans-serif", fontSize: "1.4rem", fontWeight: 800, color: "var(--blue)", marginBottom: 16 }} id="threshVal">
        Below <span id="threshNum">{value}</span>%
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={closeThresholdPicker} style={{ ...cancelStyle, padding: 10 }}>Cancel</button>
        <button id="threshConfirm" onClick={confirm} style={{ ...confirmStyle, padding: 10 }}>Enable alerts</button>
      </div>
    </div>
  );
}

// ── Share name picker ──
export function SharePicker() {
  const { routeName, sailing, id } = sharePickerStore.use();
  return routeName ? <SharePickerSheet key={id} routeName={routeName} sailing={sailing} /> : null;
}

function copyLink(url) {
  navigator.clipboard.writeText(url)
    .then(() => showToast("✅ Link copied!", 2500))
    // Last resort: show the start of the link
    .catch(() => showToast("📋 Copy: " + url.slice(0, 40) + "…", 4000));
}

function SharePickerSheet({ routeName, sailing }) {
  const ref = useRef(null);
  const [name, setName] = useState("");
  useOutsideTap(ref, true, closeSharePicker, null);

  const share = () => {
    const from = name.trim();
    closeSharePicker();
    const params = new URLSearchParams({ route: routeName });
    if (sailing) params.set("sailing", sailing);
    if (from)    params.set("from", from);
    const url   = `${location.origin}${location.pathname}?${params}`;
    const title = `Will It Sail? — ${routeName}`;
    const text  = from ? `${from} shared a CalMac route with you` : "Check this CalMac route on Will It Sail?";
    if (navigator.share) navigator.share({ title, text, url }).catch(() => copyLink(url));
    else copyLink(url);
  };

  return (
    <div
      ref={ref}
      id="shareNamePicker"
      style={{
        position: "fixed", bottom: "calc(80px + env(safe-area-inset-bottom))", left: 12, right: 12,
        zIndex: 1000, background: "var(--white)", borderRadius: 16, padding: 16,
        boxShadow: "0 8px 40px rgba(0,48,135,0.2)",
      }}
    >
      <div style={{ fontSize: ".85rem", fontWeight: 700, color: "var(--navy)", marginBottom: 10 }}>Share this route</div>
      <input
        id="shareNameInput" type="text" placeholder="Your name (optional)" autoFocus
        value={name} onChange={e => setName(e.target.value)}
        style={{
          width: "100%", padding: "9px 12px", border: "1.5px solid var(--light)", borderRadius: 10,
          fontFamily: "inherit", fontSize: ".88rem", boxSizing: "border-box", marginBottom: 10, outline: "none",
        }}
      />
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={closeSharePicker} style={{ ...cancelStyle, padding: 9 }}>Cancel</button>
        <button id="shareConfirmBtn" onClick={share} style={{ ...confirmStyle, padding: 9 }}>Share</button>
      </div>
    </div>
  );
}
