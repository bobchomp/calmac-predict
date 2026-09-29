"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { chanceColor } from "../lib/format";
import { ROUTES } from "../lib/routes";
import { tabStore } from "../lib/tabs";
import { ukDateStr } from "../lib/timetable";
import TabPage from "./TabPage";

// The Accuracy tab: how the per-sailing predictions have done, from the
// sailing log (api/sailings.js, written by api/track-sailings.js)

const PERIODS = [[1, "Today"], [7, "7 days"], [30, "30 days"], [90, "90 days"]];
const VERDICT_LABELS = { likely: "Likely (75%+)", caution: "Caution (45–74%)", unlikely: "At risk (under 45%)" };
const shortDate = date => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const plural = (n, word) => `${n.toLocaleString()} ${word}${n === 1 ? "" : "s"}`;

export default function AccuracyTab() {
  const { active } = tabStore.use();
  const [days, setDays] = useState(30);
  const [route, setRoute] = useState("");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const shown = active === "tabAccuracy";

  // Load when the tab opens and whenever the filters change; the last
  // figures stay on screen (faded) while new ones load
  useEffect(() => {
    if (!shown) return;
    let current = true;
    setLoading(true);
    fetch(`/api/sailings?days=${days}${route ? `&route=${encodeURIComponent(route)}` : ""}`, { signal: AbortSignal.timeout(15000) })
      .then(r => r.json())
      .then(json => { if (!current) return; if (json.ok) { setData(json); setError(null); } else setError(json.note || json.error || "No data"); })
      .catch(() => current && setError("Couldn't load the accuracy figures — check your connection"))
      .finally(() => current && setLoading(false));
    return () => { current = false; };
  }, [shown, days, route]);

  return (
    <TabPage id="tabAccuracy" style={{ paddingBottom: 80 }}>
      <div className="accp-page">
        <div className="accp-intro">
          <h2>Prediction accuracy</h2>
          <p>Every CalMac sailing is logged with the chance this site gave it before it left, then checked against whether CalMac ran it. A prediction of 50% or more counts as saying it would sail; a sailing counts as sailed unless CalMac cancelled it.</p>
        </div>

        <div className="accp-filters">
          <div className="accp-chips" role="group" aria-label="Period">
            {PERIODS.map(([n, label]) => (
              <button key={n} className={`accp-chip${days === n ? " active" : ""}`} aria-pressed={days === n} onClick={() => setDays(n)}>{label}</button>
            ))}
          </div>
          <select className="accp-select" value={route} onChange={e => setRoute(e.target.value)} aria-label="Route">
            <option value="">All routes</option>
            {ROUTES.map(r => <option key={r.name} value={r.name}>{r.name}</option>)}
          </select>
        </div>

        {error && !data && <div className="accp-card accp-empty">{error}</div>}
        {data && (
          <div className="accp-results" style={loading ? { opacity: 0.5 } : undefined}>
            <TrackerNote tracker={data.tracker} />
            <Headline data={data} />
            {data.resolved > 0 ? (
              <>
                <CalibrationCard calibration={data.calibration} bands={data.bands} />
                {data.byDay.length > 1 && <DailyCard byDay={data.byDay} />}
                {!route && <RouteCard byRoute={data.byRoute} />}
              </>
            ) : (
              <div className="accp-card accp-empty">No sailings have departed yet in this period. Each sailing is checked 10–25 minutes after it leaves.</div>
            )}
          </div>
        )}
        <SailingsCard route={route} shown={shown} />
      </div>
    </TabPage>
  );
}

// A warning when the tracker has failed or stopped (it runs every 15 minutes)
function TrackerNote({ tracker }) {
  if (tracker && tracker.ok && Date.now() - Date.parse(tracker.at) < 45 * 60 * 1000) return null;
  const when = tracker && new Date(tracker.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const text = !tracker ? "The sailing tracker hasn't run yet, so nothing has been logged."
    : !tracker.ok ? `The sailing tracker's last run failed at ${when}: ${tracker.error}`
    : `The sailing tracker hasn't run since ${when}, so recent sailings may be missing.`;
  return <div className="accp-card accp-warning">⚠️ {text}</div>;
}

// ── Headline figures ──
function Headline({ data }) {
  const tiles = [
    { label: "Cancellations predicted", value: data.cancelled ? `${data.cancelledPredicted} of ${data.cancelled}` : "–", note: data.cancelled ? "we said under 50%" : "no cancellations yet" },
    { label: "False alarms", value: data.falseAlarms.toLocaleString(), note: "said under 50%, but it sailed" },
    { label: "Day-before calls", value: data.firstAccuracy !== null ? `${data.firstAccuracy}%` : "–", note: "right with the first prediction" },
    { label: "Still to sail", value: data.pending.toLocaleString(), note: "logged, not departed yet" },
  ];
  return (
    <div className="accp-headline">
      <div className="accp-card accp-hero">
        <div className="accp-tile-label">Called right</div>
        <div className="accp-hero-value">{data.accuracy !== null ? `${data.accuracy}%` : "–"}</div>
        <div className="accp-tile-note">{data.resolved ? `${data.correct.toLocaleString()} of ${plural(data.resolved, "sailing")}` : "waiting for the first departures"}</div>
      </div>
      <div className="accp-tiles">
        {tiles.map(t => (
          <div key={t.label} className="accp-card accp-tile">
            <div className="accp-tile-label">{t.label}</div>
            <div className="accp-tile-value">{t.value}</div>
            <div className="accp-tile-note">{t.note}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Charts ──
function useWidth() {
  const ref = useRef(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

// Column heights 0-100%. items: { key, label, value (null = no column),
// ref (optional reference mark), tip: [strong, ...lines] }. X labels are
// thinned out to keep them minLabelGap px apart.
function ColumnChart({ items, height = 200, minLabelGap = 46, ariaLabel }) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState(null);
  const m = { top: 10, right: 6, bottom: 26, left: 34 };
  const plotW = Math.max(0, width - m.left - m.right), plotH = height - m.top - m.bottom;
  const slot = items.length ? plotW / items.length : 0;
  const barW = Math.min(24, slot * 0.6);
  const labelEvery = slot ? Math.ceil(minLabelGap / slot) : 1;
  const y = v => m.top + plotH * (1 - v / 100);
  const column = (x, top, w, r = 4) => {
    const base = y(0);
    // A value of 0 still gets a sliver, so it doesn't read as no data
    top = Math.min(top, base - 2);
    const h = base - top;
    const rr = Math.min(r, h, w / 2);
    return `M${x},${base}V${top + rr}Q${x},${top} ${x + rr},${top}H${x + w - rr}Q${x + w},${top} ${x + w},${top + rr}V${base}Z`;
  };
  const tip = hover !== null ? items[hover] : null;
  return (
    <div className="accp-chart" ref={ref} style={{ height }} onPointerLeave={() => setHover(null)}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={ariaLabel}>
          {[0, 25, 50, 75, 100].map(v => (
            <g key={v}>
              <line x1={m.left} x2={width - m.right} y1={y(v)} y2={y(v)} className="accp-grid" />
              <text x={m.left - 6} y={y(v)} className="accp-tick" textAnchor="end" dominantBaseline="middle">{v}%</text>
            </g>
          ))}
          {items.map((it, i) => {
            const x = m.left + i * slot + (slot - barW) / 2;
            return (
              <g key={it.key}>
                {it.value !== null && <path d={column(x, y(it.value), barW)} className={`accp-col${hover === i ? " hover" : ""}`} />}
                {it.ref != null && <line x1={x - 3} x2={x + barW + 3} y1={y(it.ref)} y2={y(it.ref)} className="accp-ref" />}
                {i % labelEvery === 0 && <text x={m.left + i * slot + slot / 2} y={height - 8} className="accp-tick" textAnchor="middle">{it.label}</text>}
                {/* The whole slot is the hover / focus target */}
                <rect x={m.left + i * slot} y={m.top} width={slot} height={plotH} fill="transparent" tabIndex={it.value !== null ? 0 : -1}
                  onPointerEnter={() => setHover(i)} onFocus={() => setHover(i)} onBlur={() => setHover(null)} aria-label={it.tip.join(", ")} />
              </g>
            );
          })}
        </svg>
      )}
      {tip && tip.value !== null && (
        <div className="accp-tooltip" style={{ left: Math.min(Math.max(m.left + hover * slot + slot / 2, 70), width - 70), top: Math.max(0, y(tip.value) - 8) }}>
          <strong>{tip.tip[0]}</strong>
          {tip.tip.slice(1).map(line => <div key={line}>{line}</div>)}
        </div>
      )}
    </div>
  );
}

function CalibrationCard({ calibration, bands }) {
  const items = calibration.map(c => ({
    key: c.from, label: `${c.from}–${c.to}`, value: c.count ? c.sailedPct : null, ref: (c.from + c.to) / 2,
    tip: c.count ? [`${c.sailedPct}% sailed`, `We said ${c.from}–${c.to}%`, plural(c.count, "sailing")] : [`We said ${c.from}–${c.to}%`, "No sailings"],
  }));
  return (
    <div className="accp-card">
      <h3>When we said…, how often did it sail?</h3>
      <p className="accp-sub">Each column is the share of sailings that ran, grouped by the chance we gave them. On a well-judged forecast the columns reach the grey marks.</p>
      <div className="accp-legend">
        <span><i className="accp-key-col" /> Share that sailed</span>
        <span><i className="accp-key-ref" /> What we said (middle of the band)</span>
      </div>
      <ColumnChart items={items} ariaLabel="Share of sailings that sailed, by the chance we gave them" />
      <div className="accp-bands">
        {bands.filter(b => b.count).map(b => (
          <div key={b.verdict}><strong>{b.sailedPct}%</strong> of sailings we called {VERDICT_LABELS[b.verdict]} sailed <span>({plural(b.count, "sailing")})</span></div>
        ))}
      </div>
      <details className="accp-table-toggle">
        <summary>View as table</summary>
        <table className="accp-table">
          <thead><tr><th>We said</th><th>Sailings</th><th>Sailed</th></tr></thead>
          <tbody>{calibration.map(c => <tr key={c.from}><td>{c.from}–{c.to}%</td><td>{c.count}</td><td>{c.count ? `${c.sailedPct}%` : "–"}</td></tr>)}</tbody>
        </table>
      </details>
    </div>
  );
}

function DailyCard({ byDay }) {
  const withResults = byDay.filter(d => d.resolved);
  const items = byDay.map(d => ({
    key: d.date, label: new Date(`${d.date}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }),
    value: d.resolved ? d.accuracy : null,
    tip: d.resolved ? [`${d.accuracy}% called right`, shortDate(d.date), `${d.correct} of ${plural(d.resolved, "sailing")}`, d.cancelled ? `${d.cancelledPredicted} of ${plural(d.cancelled, "cancellation")} predicted` : "No cancellations"] : [shortDate(d.date), "No sailings checked yet"],
  }));
  return (
    <div className="accp-card">
      <h3>Called right each day</h3>
      <p className="accp-sub">Share of each day's departed sailings we called right.</p>
      {withResults.length ? <ColumnChart items={items} ariaLabel="Share of sailings called right each day" /> : null}
      <details className="accp-table-toggle">
        <summary>View as table</summary>
        <table className="accp-table">
          <thead><tr><th>Day</th><th>Checked</th><th>Called right</th><th>Cancellations predicted</th></tr></thead>
          <tbody>{[...byDay].reverse().map(d => <tr key={d.date}><td>{shortDate(d.date)}</td><td>{d.resolved}</td><td>{d.accuracy !== null ? `${d.accuracy}%` : "–"}</td><td>{d.cancelled ? `${d.cancelledPredicted} of ${d.cancelled}` : "–"}</td></tr>)}</tbody>
        </table>
      </details>
    </div>
  );
}

function RouteCard({ byRoute }) {
  const rows = byRoute.filter(r => r.resolved);
  if (!rows.length) return null;
  return (
    <div className="accp-card">
      <h3>By route</h3>
      <div className="accp-table-wrap">
        <table className="accp-table accp-route-table">
          <thead><tr><th>Route</th><th>Checked</th><th>Called right</th><th>Cancellations predicted</th><th>False alarms</th></tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.route}>
                <td>{r.route}</td><td>{r.resolved}</td><td>{r.accuracy}%</td>
                <td>{r.cancelled ? `${r.cancelledPredicted} of ${r.cancelled}` : "–"}</td><td>{r.falseAlarms}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── One day's sailings ──
const SAILING_FILTERS = [
  ["all", "All", () => true],
  ["wrong", "Wrong calls", r => r.correct === false],
  ["cancelled", "Cancelled", r => r.outcome?.sailed === false],
  ["pending", "Still to go", r => !r.outcome],
];

function SailingsCard({ route, shown }) {
  const [date, setDate] = useState(() => ukDateStr(0));
  const [log, setLog] = useState(null);
  const [filter, setFilter] = useState("all");
  const [limit, setLimit] = useState(60);

  useEffect(() => {
    if (!shown) return;
    let current = true;
    fetch(`/api/sailings?date=${date}`, { signal: AbortSignal.timeout(15000) })
      .then(r => r.json())
      .then(json => current && setLog(json.ok ? json.records : []))
      .catch(() => current && setLog([]));
    return () => { current = false; };
  }, [date, shown]);
  useEffect(() => setLimit(60), [date, filter, route]);

  const records = (log || []).filter(r => !route || r.route === route);
  const test = SAILING_FILTERS.find(f => f[0] === filter)[2];
  const rows = records.filter(test);
  return (
    <div className="accp-card">
      <h3>Sailings</h3>
      <div className="accp-day-controls">
        <input type="date" className="accp-select" value={date} max={ukDateStr(1)} onChange={e => e.target.value && setDate(e.target.value)} aria-label="Day" />
        <a className="accp-download" href={`/api/sailings?date=${date}&format=csv`} download>Download as spreadsheet (CSV)</a>
      </div>
      <div className="accp-chips" role="group" aria-label="Show">
        {SAILING_FILTERS.map(([key, label, f]) => (
          <button key={key} className={`accp-chip${filter === key ? " active" : ""}`} aria-pressed={filter === key} onClick={() => setFilter(key)}>
            {label} <span className="accp-chip-count">{records.filter(f).length}</span>
          </button>
        ))}
      </div>
      {log === null ? <div className="accp-empty">Loading…</div>
        : !rows.length ? <div className="accp-empty">{records.length ? "No sailings match." : "Nothing logged for this day."}</div>
        : (
          <div className="accp-sailings">
            {rows.slice(0, limit).map(r => <SailingRow key={`${r.route}|${r.time}|${r.from}`} r={r} showRoute={!route} />)}
            {rows.length > limit && <button className="accp-more" onClick={() => setLimit(limit + 100)}>Show more ({rows.length - limit} to go)</button>}
          </div>
        )}
    </div>
  );
}

function SailingRow({ r, showRoute }) {
  const chance = r.last?.chance;
  const outcome = !r.outcome ? { cls: "pending", text: "Still to go" }
    : r.outcome.sailed === null ? { cls: "unknown", text: "Couldn't tell" }
    : r.outcome.sailed ? { cls: "sailed", text: "Sailed" } : { cls: "cancelled", text: "Cancelled", reason: r.outcome.reason };
  const verdict = r.correct === true ? { cls: "right", text: "✓ Right" } : r.correct === false ? { cls: "wrong", text: "✗ Wrong" } : null;
  return (
    <div className="accp-sailing">
      <div className="accp-sailing-time">{r.time}</div>
      <div className="accp-sailing-info">
        {showRoute && <div className="accp-sailing-route">{r.route}</div>}
        <div className="accp-sailing-dir">{r.from} → {r.to}</div>
      </div>
      <div className="accp-sailing-chance" title={r.first && r.first.chance !== chance ? `First said ${r.first.chance}%` : undefined}>
        <i style={{ background: chanceColor(chance) }} />{chance}%
      </div>
      <div className="accp-sailing-result">
        {verdict && <span className={`accp-badge ${verdict.cls}`}>{verdict.text}</span>}
        <span className={`accp-outcome ${outcome.cls}`} title={outcome.reason || undefined}>
          {outcome.text}{outcome.reason && <span className="accp-reason"> · {outcome.reason}</span>}
        </span>
      </div>
    </div>
  );
}
