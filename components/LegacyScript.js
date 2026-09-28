"use client";

import { useEffect } from "react";

// Loads the not-yet-converted app script once React has hydrated the page,
// so the script's DOM changes can't collide with hydration.
export default function LegacyScript({ src }) {
  useEffect(() => {
    if (document.querySelector(`script[src="${src}"]`)) return;
    const script = document.createElement("script");
    script.src = src;
    document.body.appendChild(script);
  }, [src]);
  return null;
}
