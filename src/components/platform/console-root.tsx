'use client'

// The console root: session provider + shell chrome. Server layout
// (layout.tsx) renders this so every /platform/(console) page shares
// the session gate, navigation and step-up affordances.
import React from 'react'
import { PlatformSessionProvider } from '@/components/platform/platform-client'
import { ConsoleShell } from '@/components/platform/console-shell'

export function PlatformConsoleRoot({ children }: { children: React.ReactNode }) {
  return (
    <PlatformSessionProvider>
      <ConsoleShell>{children}</ConsoleShell>
    </PlatformSessionProvider>
  )
}
