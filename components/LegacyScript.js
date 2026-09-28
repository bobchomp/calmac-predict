"use client";

import { useEffect } from "react";
import * as appState from "../lib/appState";
import * as card from "../lib/card";
import * as config from "../lib/config";
import * as disruptions from "../lib/disruptions";
import * as format from "../lib/format";
import * as prefs from "../lib/prefs";
import * as risk from "../lib/risk";
import * as routes from "../lib/routes";
import * as sun from "../lib/sun";
import * as timetable from "../lib/timetable";

// Loads the not-yet-converted app script once React has hydrated the page,
// so the script's DOM changes can't collide with hydration. Modules it now
// depends on are exposed as globals first.
export default function LegacyScript({ src }) {
  useEffect(() => {
    if (document.querySelector(`script[src="${src}"]`)) return;
    Object.assign(window, appState, card, config, disruptions, format, prefs, risk, routes, sun, timetable);
    const script = document.createElement("script");
    script.src = src;
    document.body.appendChild(script);
  }, [src]);
  return null;
}
