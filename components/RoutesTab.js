import { SummaryCards } from "./AppStart";
import { RoutesGrid } from "./RouteGrids";

export default function RoutesTab() {
  return (
    <div className="tab-page active" id="tabRoutes">
      <SummaryCards />
      <RoutesGrid />
      <div className="disclaimer" style={{marginBottom: 80}}>
        <strong>⚠️ Unofficial tool — not affiliated with CalMac.</strong> Predictions use wind, wave height, swell, visibility, snow, tidal restrictions and seasonal factors. Timetables are approximate. Always check <a href="https://www.calmac.co.uk/service-status" target="_blank" rel="noopener">CalMac's official service status</a> before travelling.
      </div>
    </div>
  );
}
