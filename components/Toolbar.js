"use client";

import { useSyncExternalStore } from "react";
import { getAppState, getServerAppState, setAppState, subscribeAppState } from "../lib/appState";
import { tabStore } from "../lib/tabs";
import { RefreshButton } from "./AppStart";

const FILTERS = [["all", "All"], ["likely", "✅ Likely"], ["caution", "⚠️ Caution"], ["unlikely", "❌ Unlikely"]];

// Search, verdict filters, Today/Tomorrow and Refresh; only on the Routes tab
export default function Toolbar() {
  const { search, filter, showingTomorrow } = useSyncExternalStore(subscribeAppState, getAppState, getServerAppState);
  const { active } = tabStore.use();

  return (
    <div className="toolbar" style={active === "tabRoutes" ? undefined : { display: "none" }}>
      <div className="toolbar-inner">
        <div className="search-wrap">
          <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><circle cx={11} cy={11} r={8} /><line x1={21} y1={21} x2="16.65" y2="16.65" /></svg>
          <input id="search" type="text" placeholder="Search routes…" autoComplete="off" value={search} onChange={e => setAppState({ search: e.target.value })} />
        </div>
        <div className="filter-btns">
          {FILTERS.map(([value, label]) => (
            <button key={value} className={`filter-btn${filter === value ? " active" : ""}`} data-filter={value} onClick={() => setAppState({ filter: value })}>{label}</button>
          ))}
        </div>
        <button
          className="refresh-btn"
          id="tomorrowToggleBtn"
          onClick={() => setAppState({ showingTomorrow: !showingTomorrow })}
          style={showingTomorrow
            ? { background: "var(--blue)", color: "#fff", border: "1.5px solid var(--blue)" }
            : { background: "var(--offwhite)", color: "var(--muted)", border: "1.5px solid var(--light)" }}
        >
          <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x={3} y={4} width={18} height={18} rx={2} /><line x1={16} y1={2} x2={16} y2={6} /><line x1={8} y1={2} x2={8} y2={6} /><line x1={3} y1={10} x2={21} y2={10} /></svg>
          {showingTomorrow ? " Today" : "Tomorrow"}
        </button>
        <RefreshButton />
      </div>
    </div>
  );
}
