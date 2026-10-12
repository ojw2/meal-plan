"use client";

import { useEffect } from "react";

/** Registers `/sw.js`, which makes the app installable. */
export function ServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => {
      // Not installable without it, but the app works fine.
    });
  }, []);
  return null;
}
