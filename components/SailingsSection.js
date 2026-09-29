"use client";

import { openModal } from "../lib/modal";

// A route card's sailing list; lib/card.js works out each row's data
// (chance, status, next sailing).
export default function SailingsSection({ routeName, title, rows, emptyText }) {
  return (
    <>
      <div className="sailings-title">{title}</div>
      {rows.length > 0 ? (
        <div className="sailings-list">
          {rows.map((row, i) => <SailingRow key={`${row.time}|${row.from}|${i}`} routeName={routeName} {...row} />)}
        </div>
      ) : (
        <div style={{ padding: "10px 0", fontSize: ".8rem", color: "var(--muted)", textAlign: "center" }}>
          {emptyText} — <a href="https://www.calmac.co.uk/timetables" target="_blank" style={{ color: "var(--blue)", fontWeight: 600 }}>check calmac.co.uk</a>
        </div>
      )}
    </>
  );
}

function ReasonLine({ icon, label, color }) {
  if (!label) return null;
  return <div style={{ fontSize: ".65rem", color, opacity: 0.8, whiteSpace: "nowrap" }}>{icon} {label}</div>;
}

function Bar({ width, color }) {
  return (
    <div className="sailing-bar-wrap">
      <div className="sailing-bar-track">
        <div className="sailing-bar-fill" style={{ width: `${width}%`, background: color }} />
      </div>
    </div>
  );
}

function SailingRow({ routeName, time, from, to, pct, color, isPast, isNext, nextLabel, status, statusTitle, reasonIcon, reasonLabel }) {
  const open = () => openModal(routeName, time);
  const pctText = pct !== null ? `${pct}%` : "–";

  if (status === "cancelled") {
    return (
      <div className={`sailing-row${isPast ? " sailing-past" : ""}`} style={{ background: "#fceaed", border: "1px solid #ffcdd2", cursor: "pointer" }} title={statusTitle}>
        <div className="sailing-time" style={{ color: "#c62828" }}>{time}</div>
        <div className="sailing-direction" style={{ color: "#c62828", textDecoration: "line-through", flex: 1 }}>{from} → {to}</div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2, flexShrink: 0 }}>
          <div style={{ fontSize: ".75rem", fontWeight: 700, color: "#c62828", whiteSpace: "nowrap" }}>🚨 Cancelled</div>
          <ReasonLine icon={reasonIcon} label={reasonLabel} color="#c62828" />
        </div>
      </div>
    );
  }

  if (status === "disrupted") {
    return (
      <div className={`sailing-row${isPast ? " sailing-past" : ""}`} style={{ background: "#fff8e1", border: "1px solid #ffe082", cursor: "pointer" }} onClick={open}>
        <div className="sailing-time" style={{ color: "#e65100" }}>{time}</div>
        <div className="sailing-direction" style={{ color: "#e65100", flex: 1 }}>{from} → {to}</div>
        <Bar width={pct ?? 0} color={color} />
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2, flexShrink: 0 }}>
          <div style={{ fontSize: ".72rem", fontWeight: 700, color: "#e65100", whiteSpace: "nowrap" }}>{pctText} ⚠️</div>
          <ReasonLine icon={reasonIcon} label={reasonLabel} color="#e65100" />
        </div>
      </div>
    );
  }

  return (
    <div
      className={`sailing-row${isPast ? " sailing-past" : ""}${isNext ? " sailing-next" : ""}`}
      style={isNext ? { cursor: "pointer", border: "1.5px solid var(--blue)", background: "var(--offwhite)" } : { cursor: "pointer" }}
      onClick={open}
    >
      <div className="sailing-time">{time}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="sailing-direction">{from} → {to}</div>
        {isNext && (
          <div style={{ fontSize: ".6rem", fontWeight: 700, color: "var(--blue)", textTransform: "uppercase", letterSpacing: ".05em", marginTop: 1 }}>{nextLabel}</div>
        )}
      </div>
      <Bar width={pct ?? 0} color={color} />
      <div className="sailing-pct-label" style={{ color }}>{pctText}</div>
    </div>
  );
}
