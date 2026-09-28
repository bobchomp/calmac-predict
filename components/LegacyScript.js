"use client";

import { useEffect } from "react";
import * as risk from "../lib/risk";

// Loads the not-yet-converted app script once React has hydrated the page,
// so the script's DOM changes can't collide with hydration. Modules it now
// depends on are exposed as globals first.
export default function LegacyScript({ src }) {
  useEffect(() => {
    if (document.querySelector(`script[src="${src}"]`)) return;
    Object.assign(window, risk);
    const script = document.createElement("script");
    script.src = src;
    document.body.appendChild(script);
  }, [src]);
  return null;
}
