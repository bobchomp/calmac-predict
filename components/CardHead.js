"use client";

import { Fragment } from "react";

// A route card's header: verdict icon, route name, overall chance and badges.
export default function CardHead({ verdictClass, verdictIcon, name, cancelled, chanceText, chanceColor, chanceLabel, exposureLabel, badges }) {
  return (
    <>
      <div className={`verdict-badge ${verdictClass}`}>{verdictIcon}</div>
      <div className="card-head-text">
        <div className="route-name">{name}</div>
      </div>
      <div className="overall-chance">
        {cancelled
          ? <div className="chance-pct" style={{ color: "var(--red)", fontSize: "1.1rem", lineHeight: 1.2 }}>Cancelled</div>
          : <div className="chance-pct" style={{ color: chanceColor }}>{chanceText}</div>}
        <div className="chance-lbl">{chanceLabel}</div>
        <div className="exposure-lbl">{exposureLabel}</div>
        {/* Badges are inline-block, so keep a space between them */}
        {badges.map((b, i) => (
          <Fragment key={b.text}>
            {i > 0 && " "}
            <div className={`calibrated-badge${b.pulse ? " pulse-" + b.pulse : ""}`} style={b.colors ? { background: b.colors[0], color: b.colors[1], borderColor: b.colors[2] } : undefined} title={b.title ?? undefined}>
              {b.text}
            </div>
          </Fragment>
        ))}
      </div>
    </>
  );
}
