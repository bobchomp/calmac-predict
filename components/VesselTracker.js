"use client";

import { closeVesselTracker, vesselStore } from "../lib/overlays";

// Live AIS map of a route's vessel, opened from the modal's vessel chip
export default function VesselTracker() {
  const { open, vesselName, routeName, mmsi, frameSrc } = vesselStore.use();

  return (
    <div
      className={`vt-overlay${open ? " open" : ""}`}
      id="vtOverlay"
      onClick={e => { if (e.target === e.currentTarget) closeVesselTracker(); }}
    >
      <div className="vt-sheet">
        <div className="vt-handle" />
        <div className="vt-header">
          <div>
            <div className="vt-title" id="vtVesselName">{vesselName || "Vessel Tracker"}</div>
            <div className="vt-subtitle" id="vtRouteName">{routeName}</div>
          </div>
          <button className="vt-close" onClick={closeVesselTracker}>✕</button>
        </div>
        <iframe id="vtFrame" src={frameSrc} frameBorder={0} allowFullScreen style={{ width: "100%", height: 420, display: "block" }} />
        <div className="vt-footer">
          <span id="vtStatus">{vesselName ? "🟢 Live AIS via MarineTraffic" : ""}</span>
          <a
            id="vtMTLink"
            href={mmsi ? `https://www.marinetraffic.com/en/ais/details/ships/mmsi:${mmsi}` : "#"}
            target="_blank"
            rel="noopener"
            style={mmsi ? undefined : { display: "none" }}
          >
            Open full map →
          </a>
        </div>
      </div>
    </div>
  );
}
