"use client";

import { tabStore } from "../lib/tabs";

// One of the bottom nav's pages, shown while its tab is active
export default function TabPage({ id, style, children }) {
  const { active } = tabStore.use();
  return <div className={`tab-page${active === id ? " active" : ""}`} id={id} style={style}>{children}</div>;
}
