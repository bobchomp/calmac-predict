"use client";

import { useEffect, useSyncExternalStore } from "react";
import { getAppState, getServerAppState, subscribeAppState } from "../lib/appState";
import { fetchData, startApp } from "../lib/data";

// Starts loading the page's data once React has hydrated
export function AppStart() {
  useEffect(() => { startApp(); }, []);
  return null;
}

// The Routes tab's counts by verdict, shown after a successful load
export function SummaryCards() {
  const { summary } = useSyncExternalStore(subscribeAppState, getAppState, getServerAppState);
  return (
    <div className="summary-cards" id="summaryCards" style={summary ? undefined : { display: "none" }}>
      <div className="sum-card total"><div className="num" id="sumTotal">{summary?.total ?? "–"}</div><div className="lbl">Total Routes</div></div>
      <div className="sum-card likely"><div className="num" id="sumLikely">{summary?.likely ?? "–"}</div><div className="lbl">Likely Sailing</div></div>
      <div className="sum-card caution"><div className="num" id="sumCaution">{summary?.caution ?? "–"}</div><div className="lbl">Use Caution</div></div>
      <div className="sum-card unlikely"><div className="num" id="sumUnlikely">{summary?.unlikely ?? "–"}</div><div className="lbl">At Risk</div></div>
    </div>
  );
}

export function RefreshButton() {
  const { refreshing } = useSyncExternalStore(subscribeAppState, getAppState, getServerAppState);
  return (
    <button className={`refresh-btn${refreshing ? " spinning" : ""}`} id="refreshBtn" onClick={() => fetchData().catch(() => {})}>
      <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" /></svg>
      Refresh
    </button>
  );
}
