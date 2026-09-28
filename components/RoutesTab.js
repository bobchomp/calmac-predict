export default function RoutesTab() {
  return (
    <div className="tab-page active" id="tabRoutes">
      <div className="summary-cards" id="summaryCards" style={{display: 'none'}}>
        <div className="sum-card total"><div className="num" id="sumTotal">–</div><div className="lbl">Total Routes</div></div>
        <div className="sum-card likely"><div className="num" id="sumLikely">–</div><div className="lbl">Likely Sailing</div></div>
        <div className="sum-card caution"><div className="num" id="sumCaution">–</div><div className="lbl">Use Caution</div></div>
        <div className="sum-card unlikely"><div className="num" id="sumUnlikely">–</div><div className="lbl">At Risk</div></div>
      </div>
      <div className="routes-grid" id="routesGrid" />
      <div className="disclaimer" style={{marginBottom: 80}}>
        <strong>⚠️ Unofficial tool — not affiliated with CalMac.</strong> Predictions use wind, wave height, swell, visibility, snow, tidal restrictions and seasonal factors. Timetables are approximate. Always check <a href="https://www.calmac.co.uk/service-status" target="_blank" rel="noopener">CalMac's official service status</a> before travelling.
      </div>
    </div>
  );
}
