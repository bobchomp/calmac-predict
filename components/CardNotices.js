"use client";

// A route card's CalMac notice banners; each opens the full notice.
export default function CardNotices({ routeName, notices }) {
  return notices.map((n, idx) => (
    <div key={n.title} className="timetable-notice" onClick={() => window.openTimetableNotice(routeName, idx)}>
      <div className="timetable-notice-body">
        <div className="timetable-notice-title">{n.icon} {n.title}</div>
        {n.preview && <div className="timetable-notice-detail">{n.preview}</div>}
      </div>
      <div className="timetable-notice-chevron">›</div>
    </div>
  ));
}
