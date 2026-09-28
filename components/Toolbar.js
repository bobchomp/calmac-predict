import LegacyButton from "./LegacyButton";

export default function Toolbar() {
  return (
    <div className="toolbar">
      <div className="toolbar-inner">
        <div className="search-wrap">
          <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><circle cx={11} cy={11} r={8} /><line x1={21} y1={21} x2="16.65" y2="16.65" /></svg>
          <input id="search" type="text" placeholder="Search routes…" autoComplete="off" />
        </div>
        <div className="filter-btns">
          <button className="filter-btn active" data-filter="all">All</button>
          <button className="filter-btn" data-filter="likely">✅ Likely</button>
          <button className="filter-btn" data-filter="caution">⚠️ Caution</button>
          <button className="filter-btn" data-filter="unlikely">❌ Unlikely</button>
        </div>
        <LegacyButton className="refresh-btn" id="tomorrowToggleBtn" action="toggleTomorrowGlobal" style={{background: 'var(--offwhite)', color: 'var(--muted)', border: '1.5px solid var(--light)'}}>
          <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x={3} y={4} width={18} height={18} rx={2} /><line x1={16} y1={2} x2={16} y2={6} /><line x1={8} y1={2} x2={8} y2={6} /><line x1={3} y1={10} x2={21} y2={10} /></svg>
          Tomorrow
        </LegacyButton>
        <button className="refresh-btn" id="refreshBtn">
          <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" /></svg>
          Refresh
        </button>
      </div>
    </div>
  );
}
