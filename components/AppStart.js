"use client";

import { useEffect, useSyncExternalStore } from "react";
import * as appState from "../lib/appState";
import * as card from "../lib/card";
import * as config from "../lib/config";
import { fetchData, startApp } from "../lib/data";
import * as disruptions from "../lib/disruptions";
import * as format from "../lib/format";
import * as infoTabs from "../lib/infoTabs";
import * as modal from "../lib/modal";
import * as overlays from "../lib/overlays";
import * as prefs from "../lib/prefs";
import * as push from "../lib/push";
import * as risk from "../lib/risk";
import * as routes from "../lib/routes";
import * as sun from "../lib/sun";
import * as tabs from "../lib/tabs";
import * as timetable from "../lib/timetable";

const { getAppState, getServerAppState, subscribeAppState } = appState;

// Once React has hydrated: load the data, set up push and the service
// worker, and follow #tab links. lib/ is also put on window, which some
// components' click handlers still call through.
let started = false;

export function AppStart() {
  useEffect(() => {
    // Effects run twice in development; start once
    if (started) return;
    started = true;
    Object.assign(window, appState, card, config, disruptions, format, infoTabs, modal, overlays, prefs, push, risk, routes, sun, tabs, timetable);
    startApp();
    push.initPush();
    push.registerServiceWorker();
    tabs.watchTabHash();
  }, []);
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
