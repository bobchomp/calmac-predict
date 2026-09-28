"use client";

import { loadingStore } from "../lib/data";

// Covers the page during the first load (lib/data.js startApp)
export default function LoadingScreen() {
  const { progress, message, error, hidden } = loadingStore.use();
  return (
    <div id="loadingScreen" className={hidden ? "hidden" : undefined}>
      <div className="ls-icon">⛴️</div>
      <div className="ls-title">Will It Sail?</div>
      <div className="ls-sub">CalMac Sailing Predictor</div>
      <div className="ls-spinner" />
      <div className="ls-progress">
        <div
          className="ls-progress-fill"
          id="lsProgress"
          style={{ ...(progress !== null && { width: progress + "%" }), ...(error && { background: "#c8102e" }) }}
        />
      </div>
      <div className="ls-status" id="lsStatus" style={error ? { color: "#ff9090" } : undefined}>{message}</div>
    </div>
  );
}
