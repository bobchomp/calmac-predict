"use client";

import { switchTab, tabStore } from "../lib/tabs";

const TABS = [
  { tab: "tabRoutes", id: "navRoutes", label: "Routes", icon: <svg width={20} height={20} viewBox="0 0 24 24" fill="none" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" /></svg> },
  { tab: "tabFavs", id: "navFavs", label: "Favourites", icon: <svg width={20} height={20} viewBox="0 0 24 24" fill="none" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg> },
  { tab: "tabStatus", id: "navStatus", label: "Status", icon: <svg width={20} height={20} viewBox="0 0 24 24" fill="none" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2" /></svg> },
  { tab: "tabAbout", id: "navAbout", label: "About", icon: <svg width={20} height={20} viewBox="0 0 24 24" fill="none" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><circle cx={12} cy={12} r={10} /><line x1={12} y1={8} x2={12} y2={12} /><line x1={12} y1={16} x2="12.01" y2={16} /></svg> },
];

export default function BottomNav() {
  const { active } = tabStore.use();
  return (
    <nav className="bottom-nav">
      {TABS.map(({ tab, id, label, icon }) => (
        <button key={tab} className={`nav-tab${active === tab ? " active" : ""}`} data-tab={tab} id={id} onClick={() => switchTab(tab)}>
          {icon}
          <span className="nav-label">{label}</span>
        </button>
      ))}
    </nav>
  );
}
