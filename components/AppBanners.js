"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { getAppState, getServerAppState, subscribeAppState } from "../lib/appState";

const DISMISSED_KEY = "pwaInstallDismissed";

function storageGet(key) {
  try { return localStorage.getItem(key); } catch (_) { return null; }
}

function storageSet(key, value) {
  try { localStorage.setItem(key, value); } catch (_) {}
}

// Shown while the device is offline, with how old the forecast on screen is
export function OfflineBanner() {
  const [offline, setOffline] = useState(false);
  const { lastFetched } = useSyncExternalStore(subscribeAppState, getAppState, getServerAppState);

  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  if (!offline) return null;
  const since = lastFetched ? " — showing the forecast from " + lastFetched.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
  return (
    <div
      id="offlineBanner"
      style={{
        position: "fixed", top: 0, left: 0, right: 0, zIndex: 9998, background: "#1a2c4e", color: "#fff", textAlign: "center",
        padding: "10px 16px", fontSize: ".82rem", fontWeight: 600, paddingTop: "calc(10px + env(safe-area-inset-top))",
      }}
    >
      📵 You&apos;re offline{since}
    </div>
  );
}

// "Add to Home Screen", when the browser offers installing the app and it
// hasn't been installed or dismissed before
export function InstallBanner() {
  const [prompt, setPrompt] = useState(null);

  useEffect(() => {
    const onPrompt = e => {
      e.preventDefault();
      if (!storageGet(DISMISSED_KEY)) setPrompt(e);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  if (!prompt) return null;

  const install = async () => {
    prompt.prompt();
    const { outcome } = await prompt.userChoice;
    if (outcome === "accepted") storageSet(DISMISSED_KEY, "1");
    setPrompt(null);
  };
  const dismiss = () => {
    storageSet(DISMISSED_KEY, "1");
    setPrompt(null);
  };

  return (
    <div
      id="installBanner"
      style={{
        position: "fixed", bottom: "calc(72px + env(safe-area-inset-bottom))", left: 12, right: 12, zIndex: 800,
        background: "var(--navy)", color: "#fff", borderRadius: 14,
        padding: "14px 16px", boxShadow: "0 8px 32px rgba(0,48,135,.25)",
        display: "flex", alignItems: "center", gap: 12,
        animation: "fadeUp .3s ease",
      }}
    >
      <div style={{ fontSize: "1.4rem" }}>📱</div>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 700, fontSize: ".88rem" }}>Add to Home Screen</div>
        <div style={{ fontSize: ".75rem", opacity: 0.8, marginTop: 2 }}>Get faster access and offline support</div>
      </div>
      <button onClick={install} style={{ padding: "8px 14px", borderRadius: 10, background: "var(--sky)", border: "none", color: "var(--navy)", fontFamily: "inherit", fontSize: ".8rem", fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}>Install</button>
      <button onClick={dismiss} style={{ background: "none", border: "none", color: "rgba(255,255,255,.6)", fontSize: "1.2rem", cursor: "pointer", padding: 4, lineHeight: 1 }}>✕</button>
    </div>
  );
}
