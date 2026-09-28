export default function LoadingScreen() {
  return (
    <div id="loadingScreen">
      <div className="ls-icon">⛴️</div>
      <div className="ls-title">Will It Sail?</div>
      <div className="ls-sub">CalMac Sailing Predictor</div>
      <div className="ls-spinner" />
      <div className="ls-progress"><div className="ls-progress-fill" id="lsProgress" /></div>
      <div className="ls-status" id="lsStatus">Fetching weather data…</div>
    </div>
  );
}
