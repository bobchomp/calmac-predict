"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { getAppState, getServerAppState, subscribeAppState } from "../lib/appState";
import { closeModal, getModal, getServerModal, modalData, subscribeModal } from "../lib/modal";
import { openVesselTracker, shareRoute } from "../lib/overlays";
import { ROUTE_INFO } from "../lib/routes";

// The bottom sheet for a route or one of its sailings, opened by
// openModal() in lib/modal.js
export default function RouteModal() {
  const modal = useSyncExternalStore(subscribeModal, getModal, getServerModal);
  const state = useSyncExternalStore(subscribeAppState, getAppState, getServerAppState);
  const route = modal.route && state.routes.find(r => r.name === modal.route);
  const touchY = useRef(0);

  return (
    <div
      className={`modal-overlay${modal.open && route ? " open" : ""}`}
      id="modalOverlay"
      onClick={e => { if (e.target === e.currentTarget) closeModal(); }}
    >
      <div
        className="modal"
        id="modalContent"
        // Swipe down to close
        onTouchStart={e => { touchY.current = e.touches[0].clientY; }}
        onTouchEnd={e => { if (e.changedTouches[0].clientY - touchY.current > 60 && e.currentTarget.scrollTop === 0) closeModal(); }}
      >
        {route && (
          <ModalContent
            key={modal.id}
            {...modalData(route, modal.sailingTime, { ...state, disruption: state.disruptions[route.name] })}
          />
        )}
      </div>
    </div>
  );
}

function ModalContent({ routeName, sailingTime, title, subtitle, notice, chance, color, verdict, verdictText, rows, pills }) {
  // Chance ring
  const radius = 36, circ = 2 * Math.PI * radius;
  const dash = ((100 - chance) / 100) * circ;

  return (
    <>
      <div className="modal-handle" />
      <div className="modal-header">
        <div className="modal-route-name">{title}</div>
        <div className="modal-subtitle">{subtitle}</div>
      </div>
      <div className="modal-body">
        {notice && <Notice {...notice} />}

        <div className="modal-hero">
          <div className="chance-ring">
            <svg width={90} height={90} viewBox="0 0 90 90">
              <circle cx={45} cy={45} r={radius} fill="none" stroke="var(--light)" strokeWidth={8} />
              <circle
                cx={45} cy={45} r={radius} fill="none" stroke={color} strokeWidth={8}
                strokeDasharray={circ} strokeDashoffset={dash}
                strokeLinecap="round" style={{ transition: "stroke-dashoffset .6s ease" }}
              />
            </svg>
            <div className="chance-ring-num" style={{ color }}>{chance}%</div>
          </div>
          <div className="modal-verdict">
            <div className="modal-verdict-label" style={{ color }}>{verdict}</div>
            <div className="modal-verdict-desc">{verdictText}</div>
          </div>
        </div>

        <div className="breakdown-title">Conditions</div>
        {rows.map(row => (
          <div key={row.name} className="breakdown-row">
            <div className="br-icon">{row.icon}</div>
            <div className="br-info">
              <div className="br-name">{row.name}</div>
              <div className="br-reason">{row.reason}</div>
              <div className="br-bar"><div className="br-bar-fill" style={{ width: `${row.barPct}%`, background: row.barColor }} /></div>
            </div>
            <div className={`br-level ${row.cls}`}>{row.barPct}%</div>
          </div>
        ))}

        <div className="breakdown-total">
          <div>
            <div className="bt-label">Sailing chance</div>
            <div style={{ fontSize: ".72rem", opacity: 0.6, marginTop: 2 }}>Based on weather forecast</div>
          </div>
          <div className="bt-chance">{chance}%</div>
        </div>

        <div className="profile-pills">
          {pills.map(pill => <span key={pill} className="profile-pill">{pill}</span>)}
        </div>

        <RouteDetails routeName={routeName} />

        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <button
            id="modalShareBtn"
            className="modal-calmac-link"
            style={{ flex: 1, background: "var(--offwhite)", color: "var(--navy)", border: "1.5px solid var(--light)" }}
            onClick={() => shareRoute(routeName, sailingTime)}
          >
            <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
              <circle cx={18} cy={5} r={3} /><circle cx={6} cy={12} r={3} /><circle cx={18} cy={19} r={3} />
              <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" /><line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
            </svg>
            Share
          </button>
        </div>

        <a className="modal-calmac-link" href="https://www.calmac.co.uk/service-status" target="_blank" rel="noopener">
          🚢 Check CalMac&apos;s official status page
        </a>
      </div>
    </>
  );
}

function Notice({ colors: [background, border, color], title, detailHtml, reason, reasonIcon }) {
  return (
    <div style={{ background, border: `1.5px solid ${border}`, borderRadius: 10, padding: "12px 14px", marginBottom: 16 }}>
      <div style={{ fontWeight: 700, color, fontSize: ".9rem", marginBottom: 4 }}>{title}</div>
      {/* linkifyDetail escapes the text and adds the links */}
      <div className="calmac-detail" style={{ fontSize: ".82rem", color, lineHeight: 1.55 }} dangerouslySetInnerHTML={{ __html: detailHtml }} />
      {reason && (
        <div style={{ fontSize: ".75rem", color, marginTop: 6, opacity: 0.85 }}>{reasonIcon} Reason: <strong>{reason}</strong></div>
      )}
    </div>
  );
}

// Live vessel lookups (/api/vessel), kept for the session
const vesselCache = {};

async function vesselFor(routeName) {
  if (vesselCache[routeName]) return vesselCache[routeName];
  try {
    const res = await fetch(`/api/vessel?route=${encodeURIComponent(routeName)}`);
    const data = await res.json();
    vesselCache[routeName] = data;
    return data;
  } catch (_) {
    return null;
  }
}

function RouteDetails({ routeName }) {
  const info = ROUTE_INFO[routeName] || {};
  const [vessel, setVessel] = useState(null);

  useEffect(() => {
    let current = true;
    vesselFor(routeName).then(data => { if (current && data?.vessel) setVessel(data.vessel); });
    return () => { current = false; };
  }, [routeName]);

  return (
    <div>
      <div className="breakdown-title" style={{ marginTop: 16 }}>Route details</div>
      <div id="modalVesselChip" style={{ marginBottom: 8 }}>
        {vessel ? <VesselChip routeName={routeName} vessel={vessel} /> : <span className="vessel-chip scheduled">🚢 {info.vessel || "Unknown"}</span>}
      </div>
      <div className="route-info-grid" id="modalRouteInfoGrid">
        {info.crossing && <div className="ri-item"><div className="ri-label">Crossing time</div><div className="ri-value">{info.crossing}</div></div>}
        {info.type && <div className="ri-item"><div className="ri-label">Service type</div><div className="ri-value">{info.type}</div></div>}
        {info.note && (
          <div className="ri-item" style={{ gridColumn: "1/-1" }}>
            <div className="ri-label">Note</div>
            <div className="ri-value" style={{ fontWeight: 400, fontSize: ".82rem", color: "var(--muted)" }}>{info.note}</div>
          </div>
        )}
      </div>
    </div>
  );
}

function VesselChip({ routeName, vessel }) {
  const isLive = !vessel.scheduled;
  const speed = isLive && vessel.speed != null && vessel.speed > 0.5 ? ` · ${vessel.speed.toFixed(1)} kn` : "";
  return (
    <span
      className="vessel-chip scheduled"
      style={{ cursor: "pointer" }}
      onClick={() => openVesselTracker(routeName, vessel.name || "Vessel", vessel.mmsi || null)}
    >
      🚢 {vessel.name} <small style={{ opacity: 0.7 }}>{isLive ? `(live${speed})` : "(scheduled)"}</small>{" "}
      <small style={{ color: "var(--blue)", marginLeft: 6 }}>📍 Track live →</small>
    </span>
  );
}
