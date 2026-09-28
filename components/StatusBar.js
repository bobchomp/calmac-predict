export default function StatusBar() {
  return (
    <div className="status-bar loading" id="statusBar">
      <div className="pulse" id="pulse" />
      <span id="statusText">Loading weather forecasts…</span>
    </div>
  );
}
