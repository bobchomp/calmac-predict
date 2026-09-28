import LegacyButton from "./LegacyButton";

export default function StatusTab() {
  return (
    <div className="tab-page" id="tabStatus" style={{paddingBottom: 80}}>
      <div className="status-page">
        <LegacyButton className="status-refresh-btn" action="runStatusCheck">
          <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" /></svg>
          Check now
        </LegacyButton>
        <div id="statusLastChecked" className="status-last-checked">Checking…</div>
        <div id="statusItems" />
      </div>
    </div>
  );
}
