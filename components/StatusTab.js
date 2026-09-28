import { StatusChecks } from "./InfoTabs";

export default function StatusTab() {
  return (
    <div className="tab-page" id="tabStatus" style={{paddingBottom: 80}}>
      <div className="status-page">
        <StatusChecks />
      </div>
    </div>
  );
}
