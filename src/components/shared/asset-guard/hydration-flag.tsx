'use client'

/**
 * HydrationFlag — route-agnostic JS-boot proof for the Asset Guard.
 *
 * The inline watchdog (injected by the root layout) arms a 30s
 * hydration grace on EVERY document: if `data-app-hydrated` is not
 * '1' by then it shows the branded recovery screen ("scripts didn't
 * finish loading"). Historically ONLY src/app/page.tsx (the school
 * SPA) set that attribute — so every OTHER route (/platform/login,
 * /platform/(console)/*, …) was falsely flagged as a dead boot
 * ~31s after load, covering a perfectly working, fully hydrated
 * page. Production symptom: the recovery screen appearing around
 * the TOTP verification flow (users spend >30s there fetching an
 * authenticator code) and over the live console.
 *
 * Root fix: the ROOT layout renders this component, so every route
 * reports "React booted" the moment its effects run. The attribute
 * still can only be set by running React code — a genuinely failed
 * script load (chunk 404, crashed hydration) never reaches this
 * effect, so the watchdog's real-failure detection is preserved.
 */
import { useEffect } from 'react'

export function HydrationFlag() {
  useEffect(() => {
    document.documentElement.setAttribute('data-app-hydrated', '1')
  }, [])
  return null
}
