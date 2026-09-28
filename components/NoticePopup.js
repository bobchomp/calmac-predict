"use client";

import { useRef } from "react";
import { linkifyDetail } from "../lib/format";
import { closeTimetableNotice, noticeStore } from "../lib/overlays";

// A CalMac service notice in full, opened from a card's notice banner
export default function NoticePopup() {
  const { open, title, detail } = noticeStore.use();
  const touchY = useRef(0);

  return (
    <div
      className={`tn-overlay${open ? " open" : ""}`}
      id="tnOverlay"
      onClick={e => { if (e.target === e.currentTarget) closeTimetableNotice(); }}
    >
      <div
        className="tn-popup"
        // Swipe down to close
        onTouchStart={e => { touchY.current = e.touches[0].clientY; }}
        onTouchEnd={e => { if (e.changedTouches[0].clientY - touchY.current > 60 && e.currentTarget.scrollTop === 0) closeTimetableNotice(); }}
      >
        <div className="tn-handle" />
        <div className="tn-header">
          <div className="tn-title" id="tnTitle">{title}</div>
          <div className="tn-subtitle">Service notice from CalMac</div>
        </div>
        {/* linkifyDetail escapes the text and adds the links */}
        <div
          className="tn-body"
          id="tnBody"
          dangerouslySetInnerHTML={{ __html: linkifyDetail(detail) || '<em style="opacity:.6">No further detail provided.</em>' }}
        />
      </div>
    </div>
  );
}
