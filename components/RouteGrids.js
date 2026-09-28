"use client";

import { useSyncExternalStore } from "react";
import { getAppState, getServerAppState, subscribeAppState } from "../lib/appState";
import { cardData } from "../lib/card";
import { getPrefs, getServerPrefs, subscribePrefs } from "../lib/prefs";
import RouteCard from "./RouteCard";

const useAppState = () => useSyncExternalStore(subscribeAppState, getAppState, getServerAppState);

function Cards({ routes, state }) {
  return routes.map((r, i) => {
    const card = cardData(r, i, { ...state, disruption: state.disruptions[r.name] });
    return (
      <div key={r.name} className="route-card" style={{ animationDelay: `${card.delay}ms` }}>
        <RouteCard {...card} />
      </div>
    );
  });
}

function Skeletons() {
  return Array.from({ length: 6 }, (_, i) => (
    <div key={i} className="route-card">
      <div className="card-head">
        <div className="verdict-badge unknown" />
        <div style={{ flex: 1 }}>
          <div className="skeleton" style={{ height: 13, width: "70%", marginBottom: 6 }} />
          <div className="skeleton" style={{ height: 10, width: "45%" }} />
        </div>
      </div>
      <div style={{ padding: "10px 16px", background: "var(--offwhite)" }}><div className="skeleton" style={{ height: 10 }} /></div>
      <div style={{ padding: "12px 16px" }}>
        <div className="skeleton" style={{ height: 10, marginBottom: 8 }} />
        <div className="skeleton" style={{ height: 10, marginBottom: 8 }} />
        <div className="skeleton" style={{ height: 10 }} />
      </div>
    </div>
  ));
}

// The Routes tab grid, filtered by the toolbar's verdict filter and search
export function RoutesGrid() {
  const state = useAppState();
  let content = null;
  if (state.phase === "loading") content = <Skeletons />;
  else if (state.phase === "ready") {
    const search = state.search.toLowerCase();
    const shown = state.routes.filter(r =>
      (state.filter === "all" || r.verdict === state.filter) && r.name.toLowerCase().includes(search));
    content = shown.length > 0
      ? <Cards routes={shown} state={state} />
      : <div className="empty"><div className="empty-icon">🔍</div><p>No routes match your filter.</p></div>;
  }
  return <div className="routes-grid" id="routesGrid">{content}</div>;
}

// The Favourites tab: starred routes, or a prompt when there are none
export function FavouritesGrid() {
  const state = useAppState();
  const { favourites } = useSyncExternalStore(subscribePrefs, getPrefs, getServerPrefs);
  const ready = state.phase !== "idle";
  const shown = ready ? state.routes.filter(r => favourites.includes(r.name)) : [];
  return (
    <>
      <div id="favsGrid" className="routes-grid">{shown.length > 0 && <Cards routes={shown} state={state} />}</div>
      <div id="favsEmpty" className="favs-empty" style={ready && shown.length === 0 ? undefined : { display: "none" }}>
        <div className="big-icon">⭐</div>
        <p>No favourite routes yet.<br />Tap the ★ on any route to save it here.</p>
      </div>
    </>
  );
}
