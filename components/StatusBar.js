"use client";

import { useSyncExternalStore } from "react";
import { getAppState, getServerAppState, subscribeAppState } from "../lib/appState";

export default function StatusBar() {
  const { status } = useSyncExternalStore(subscribeAppState, getAppState, getServerAppState);
  return (
    <div className={`status-bar ${status.type}`} id="statusBar">
      <div className="pulse" id="pulse" style={status.type === "loading" ? undefined : { display: "none" }} />
      <span id="statusText">{status.text}</span>
    </div>
  );
}
