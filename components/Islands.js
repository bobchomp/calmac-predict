"use client";

import { useEffect, useState } from "react";
import { createPortal, flushSync } from "react-dom";
import RouteCard from "./RouteCard";

const COMPONENTS = { card: RouteCard };

// HTML built by the legacy script can contain island placeholders:
//   <div data-island="card" data-props="{…json…}"></div>
// Each is rendered into by the matching React component through a portal.
// Placeholders are picked up as soon as the legacy script inserts them, in
// the same task, so nothing flashes empty.
export default function Islands() {
  const [islands, setIslands] = useState([]);

  useEffect(() => {
    const keys = new WeakMap();
    let nextKey = 0;
    let current = [];

    const scan = sync => {
      const found = [...document.querySelectorAll("[data-island]")].map(el => ({ el, type: el.dataset.island, json: el.dataset.props }));
      const unchanged = found.length === current.length && found.every((f, i) => f.el === current[i].el && f.json === current[i].json);
      if (unchanged) return;
      current = found;
      for (const f of found) if (!keys.has(f.el)) keys.set(f.el, nextKey++);
      const next = found.map(f => ({ ...f, key: keys.get(f.el), props: JSON.parse(f.json || "{}") }));
      if (sync) flushSync(() => setIslands(next));
      else setIslands(next);
    };

    scan(false);
    const observer = new MutationObserver(() => scan(true));
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  return islands.map(({ el, type, key, props }) => {
    const Component = COMPONENTS[type];
    return Component ? createPortal(<Component {...props} />, el, key) : null;
  });
}
