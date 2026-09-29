"use client";

import { openTimetableNotice } from "../lib/overlays";

// A route card's CalMac notice banners; each opens the full notice. Ones
// announcing cancellations pulse red, ones warning of them pulse yellow.
const SEVERITY_CLASS = { cancelled: " notice-cancelled pulse-red", risk: " notice-risk pulse-amber" };

export default function CardNotices({ routeName, notices }) {
  return notices.map((n, idx) => (
    <div key={n.title} className={`timetable-notice${SEVERITY_CLASS[n.severity] || ""}`} onClick={() => openTimetableNotice(routeName, idx)}>
      <div className="timetable-notice-body">
        <div className="timetable-notice-title">{n.icon} {n.title}</div>
        {n.preview && <div className="timetable-notice-detail">{n.preview}</div>}
      </div>
      <div className="timetable-notice-chevron">›</div>
    </div>
  ));
}
