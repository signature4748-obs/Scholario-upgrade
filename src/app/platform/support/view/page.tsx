'use client'

// PHASE 6 — /platform/support/view: the READ-ONLY school oversight
// surface for an active support session (standalone layout: amber
// support banner instead of the console chrome). Authenticated by the
// SUPPORT token space only.
import { SupportOversightView } from '@/components/platform/modules/support-oversight'

export default function Page() {
  return <SupportOversightView />
}
