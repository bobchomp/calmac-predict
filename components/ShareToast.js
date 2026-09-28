"use client";

import { toastStore } from "../lib/overlays";

export default function ShareToast() {
  const { text, show } = toastStore.use();
  return (
    <div className={`share-toast${show ? " show" : ""}`} id="shareToast">{text}</div>
  );
}
