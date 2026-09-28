"use client";

import { useSyncExternalStore } from "react";
import { getNotifThreshold, getPrefs, getServerPrefs, subscribePrefs } from "../lib/prefs";
import CardHead from "./CardHead";
import CardNotices from "./CardNotices";
import { CardWeather, WindBar } from "./CardWeather";
import SailingsSection from "./SailingsSection";

// A route card's contents. The legacy script still works out the data for
// each section; favourites and alert settings come from lib/prefs.js.
export default function RouteCard({ name, head, notices, weather, windClass, gustPct, sailings, foot }) {
  const prefs = useSyncExternalStore(subscribePrefs, getPrefs, getServerPrefs);
  const favourite = prefs.favourites.includes(name);

  return (
    <>
      <button
        className="fav-btn"
        data-route={name}
        title="Favourite this route"
        onClick={e => { e.stopPropagation(); window.toggleFav(name); }}
      >
        {favourite ? "★" : "☆"}
      </button>
      <div className="card-head"><CardHead {...head} /></div>
      <CardNotices routeName={name} notices={notices} />
      <div className={`card-weather ${windClass}`}><CardWeather {...weather} /></div>
      <div className={`wind-bar-wrap ${windClass}`}><WindBar gustPct={gustPct} /></div>
      <div className="sailings-section"><SailingsSection routeName={name} {...sailings} /></div>
      <div className="card-foot">
        <div className="conf-pips">
          {[1, 2, 3].map(n => <div key={n} className={`conf-pip ${n <= foot.pips ? "filled" : ""}`} />)}
          <span>{foot.pips === 3 ? "High" : foot.pips === 2 ? "Medium" : "Low"} confidence</span>
        </div>
        <span>Updated {foot.updated}</span>
      </div>
      <CardActions name={name} notified={prefs.notified.includes(name)} threshold={getNotifThreshold(name)} />
    </>
  );
}

function CardActions({ name, notified, threshold }) {
  const onAlert = e => {
    e.stopPropagation();
    // Turning alerts on asks for a threshold first; turning them off doesn't
    if (notified) window.toggleRouteNotification(name);
    else window.showThresholdPicker(name, e.currentTarget);
  };

  return (
    <div className="card-actions">
      <button
        className="card-action-btn share-btn"
        data-route={name}
        title="Share this route"
        onClick={e => { e.stopPropagation(); window.shareRoute(name); }}
      >
        <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
          <circle cx={18} cy={5} r={3} /><circle cx={6} cy={12} r={3} /><circle cx={18} cy={19} r={3} />
          <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" /><line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
        </svg>
        <span>Share</span>
      </button>
      <button
        className={`card-action-btn notif-btn${notified ? " notif-on" : ""}`}
        data-route={name}
        title={notified ? `Alerts on (below ${threshold}%) — tap to turn off` : "Get notified if sailing chance drops"}
        onClick={onAlert}
      >
        <span>🔔</span>
        <span>{notified ? `Alerts <${threshold}%` : "Alert me"}</span>
      </button>
    </div>
  );
}
