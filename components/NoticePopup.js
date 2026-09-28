export default function NoticePopup() {
  return (
    <div className="tn-overlay" id="tnOverlay">
      <div className="tn-popup">
        <div className="tn-handle" />
        <div className="tn-header">
          <div className="tn-title" id="tnTitle" />
          <div className="tn-subtitle">Service notice from CalMac</div>
        </div>
        <div className="tn-body" id="tnBody" />
      </div>
    </div>
  );
}
