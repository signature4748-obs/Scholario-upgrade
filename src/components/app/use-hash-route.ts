"use client";

import { useCallback, useSyncExternalStore } from "react";

/** Client-side hash router — everything lives on `/`. #/students etc. */
export function useHashRoute(defaultModule: string): [string, (m: string) => void] {
  const subscribe = useCallback((onChange: () => void) => {
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  const getSnapshot = useCallback(() => {
    const h = window.location.hash.replace(/^#\/?/, "").split("?")[0];
    return h || defaultModule;
  }, [defaultModule]);

  const active = useSyncExternalStore(subscribe, getSnapshot, () => defaultModule);

  const go = useCallback((m: string) => {
    window.location.hash = `#/${m}`;
    document.getElementById("module-scroll")?.scrollTo({ top: 0 });
  }, []);

  return [active, go];
}
