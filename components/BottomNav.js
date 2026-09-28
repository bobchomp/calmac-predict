export default function BottomNav() {
  return (
    <nav className="bottom-nav">
      <button className="nav-tab active" data-tab="tabRoutes" id="navRoutes">
        <svg width={20} height={20} viewBox="0 0 24 24" fill="none" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" /></svg>
        <span className="nav-label">Routes</span>
      </button>
      <button className="nav-tab" data-tab="tabFavs" id="navFavs">
        <svg width={20} height={20} viewBox="0 0 24 24" fill="none" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg>
        <span className="nav-label">Favourites</span>
      </button>
      <button className="nav-tab" data-tab="tabStatus" id="navStatus">
        <svg width={20} height={20} viewBox="0 0 24 24" fill="none" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2" /></svg>
        <span className="nav-label">Status</span>
      </button>
      <button className="nav-tab" data-tab="tabAbout" id="navAbout">
        <svg width={20} height={20} viewBox="0 0 24 24" fill="none" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><circle cx={12} cy={12} r={10} /><line x1={12} y1={8} x2={12} y2={12} /><line x1={12} y1={16} x2="12.01" y2={16} /></svg>
        <span className="nav-label">About</span>
      </button>
    </nav>
  );
}
