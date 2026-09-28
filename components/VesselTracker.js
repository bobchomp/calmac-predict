import LegacyButton from "./LegacyButton";

export default function VesselTracker() {
  return (
    <div className="vt-overlay" id="vtOverlay">
      <div className="vt-sheet">
        <div className="vt-handle" />
        <div className="vt-header">
          <div>
            <div className="vt-title" id="vtVesselName">Vessel Tracker</div>
            <div className="vt-subtitle" id="vtRouteName" />
          </div>
          <LegacyButton className="vt-close" action="closeVesselTracker">✕</LegacyButton>
        </div>
        <iframe id="vtFrame" src="about:blank" frameBorder={0} allowFullScreen style={{width: '100%', height: 420, display: 'block'}} />
        <div className="vt-footer">
          <span id="vtStatus" />
          <a id="vtMTLink" href="#" target="_blank" rel="noopener" style={{display: 'none'}}>Open full map →</a>
        </div>
      </div>
    </div>
  );
}
