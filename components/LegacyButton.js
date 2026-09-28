"use client";

// Calls a global function defined by public/legacy/app.js.
export default function LegacyButton({ action, ...props }) {
  return <button {...props} onClick={() => window[action]?.()} />;
}
