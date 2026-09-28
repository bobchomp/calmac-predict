import { StatusChecks } from "./InfoTabs";
import TabPage from "./TabPage";

export default function StatusTab() {
  return (
    <TabPage id="tabStatus" style={{paddingBottom: 80}}>
      <div className="status-page">
        <StatusChecks />
      </div>
    </TabPage>
  );
}
