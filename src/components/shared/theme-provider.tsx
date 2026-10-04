'use client'

import { useEffect } from 'react'
import { useTheme, applyTheme } from '@/lib/store/theme-store'

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = useTheme((s) => s.theme)
  const hydrated = useTheme((s) => s.hydrated)

  useEffect(() => {
    useTheme.persist.rehydrate()
    // Asset Guard (JS-boot probe): the inline watchdog waits for this
    // flag to confirm the React application actually booted. Setting it
    // HERE (the root layout's ThemeProvider mounts on every route —
    // school portal, public website, AND the /platform control plane)
    // closes the false-watchdog window: platform routes never mounted
    // src/app/page.tsx, so their hydration flag was never set and the
    // watchdog painted the recovery screen over a healthy page after
    // the 30s grace. A genuinely dead JS bundle never runs this effect,
    // so real failures still recover correctly.
    document.documentElement.setAttribute('data-app-hydrated', '1')
  }, [])

  useEffect(() => {
    if (hydrated) applyTheme(theme)
  }, [theme, hydrated])

  return <>{children}</>
}
