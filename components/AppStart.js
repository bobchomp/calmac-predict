"use client";

import { useEffect, useSyncExternalStore } from "react";
import { getAppState, getServerAppState, subscribeAppState } from "../lib/appState";
import { routeOutlook } from "../lib/card";
import { fetchData, startApp } from "../lib/data";
import { initPush, registerServiceWorker } from "../lib/push";
import { watchTabHash } from "../lib/tabs";

// Once React has hydrated: load the data, set up push and the service
// worker, and follow #tab links
let started = false;

export function AppStart() {
  useEffect(() => {
    // Effects run twice in development; start once
    if (started) return;
    started = true;
    startApp();
    initPush();
    registerServiceWorker();
    watchTabHash();
  }, []);
  return null;
}

// The Routes tab's counts by verdict (as the cards' icons, for the day in
// view), shown once there's weather data
export function SummaryCards() {
  const state = useSyncExternalStore(subscribeAppState, getAppState, getServerAppState);
  const loaded = state.routes.some(r => r.maxGustMph !== undefined);
  const verdicts = loaded ? state.routes.map(r => routeOutlook(r, { ...state, disruption: state.disruptions[r.name] }).verdict) : [];
  const count = verdict => verdicts.filter(v => v === verdict).length;
  const summary = loaded ? { total: state.routes.length, likely: count("likely"), caution: count("caution"), unlikely: count("unlikely") } : null;
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
