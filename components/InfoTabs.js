"use client";

import { useState } from "react";
import { aboutStatsStore, runStatusCheck, statusStore } from "../lib/infoTabs";

// The Status tab: system checks, run when the tab opens or on Check now
export function StatusChecks() {
  const { items, lastChecked } = statusStore.use();
  return (
    <>
      <button className="status-refresh-btn" onClick={runStatusCheck}>
        <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" /></svg>
        Check now
      </button>
      <div id="statusLastChecked" className="status-last-checked">
        {lastChecked ? `Last checked: ${lastChecked.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}` : "Checking…"}
      </div>
      <div id="statusItems">
        {items.map(item => (
          <div key={item.name} className="status-item">
            <div className={`status-dot ${item.dot}`} />
            <div className="status-info">
              <div className="status-name">{item.icon ? `${item.icon} ${item.name}` : item.name}</div>
              <div className="status-detail">
                {item.detail}
                {item.link && <> · <a href={item.link.href}>{item.link.text}</a></>}
              </div>
            </div>
            <div className={`status-badge ${item.badge}`}>{item.badgeText}</div>
          </div>
        ))}
      </div>
    </>
  );
}

// One of the About tab's database figures from the Google Sheet
export function AboutStat({ field, id }) {
  const stats = aboutStatsStore.use();
  return <div style={{ fontSize: "1.6rem", fontWeight: 800, color: "var(--navy)" }} id={id}>{stats[field]}</div>;
}

// "Send a test notification" on the About tab
export function TestNotification() {
  const [status, setStatus] = useState(null); // { msg, color }
  const [busy, setBusy] = useState(false);
  const show = (msg, color = "var(--muted)") => setStatus({ msg, color });

  const send = async () => {
    if (!("Notification" in window)) return show("❌ This browser does not support notifications.", "var(--red)");
    if (!("serviceWorker" in navigator)) return show("❌ Service workers not supported — try adding the app to your home screen on iOS.", "var(--red)");

    setBusy(true);
    show("Requesting permission…");
    try {
      if (Notification.permission === "denied") {
        return show("❌ Notifications are blocked. Open your browser settings and allow notifications for this site, then try again.", "var(--red)");
      }
      if (Notification.permission !== "granted" && await Notification.requestPermission() !== "granted") {
        return show("❌ Permission denied — notifications won't work until you allow them.", "var(--red)");
      }

      show("Sending test notification…");
      try {
        // Through the service worker: direct Notification() doesn't work on iOS
        const reg = await navigator.serviceWorker.ready;
        await reg.showNotification("🚢 Will It Sail? — Test", {
          body: "Notifications are working! You'll receive alerts like this when a starred route drops below 70%.",
          icon: "/icon-120.png",
          badge: "/icon-120.png",
          tag: "test-notification",
          data: { url: location.href },
          actions: [{ action: "view", title: "View app" }],
        });
        show("✅ Test notification sent! Check your notifications.", "var(--green)");
      } catch (_) {
        try {
          new Notification("🚢 Will It Sail? — Test", {
            body: "Notifications are working! You'll receive alerts when a starred route drops below 70%.",
            icon: "/icon-120.png",
          });
          show("✅ Test notification sent!", "var(--green)");
        } catch (err) {
          show(`❌ Failed: ${err.message}. On iOS, make sure the app is added to your home screen.`, "var(--red)");
        }
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div id="testNotifWrap" style={{ marginTop: 12 }}>
      <button
        id="testNotifBtn"
        onClick={send}
        disabled={busy}
        style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "9px 16px", borderRadius: 10, border: "1.5px solid var(--light)", background: "var(--white)", fontFamily: "inherit", fontSize: ".85rem", fontWeight: 600, color: "var(--text)", cursor: "pointer", transition: "all .18s", ...(busy && { opacity: 0.6 }) }}
      >
        <span>🔔</span> Send a test notification
      </button>
      <div id="testNotifStatus" style={{ marginTop: 8, fontSize: ".78rem", color: status?.color || "var(--muted)", display: status ? "block" : "none" }}>{status?.msg}</div>
    </div>
  );
}
