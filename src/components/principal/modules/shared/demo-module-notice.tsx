'use client'

/**
 * DemoModuleNotice — the honest-labeling banner for the OPTIONAL/FUTURE
 * secondary modules (Library, Transport, Inventory, Certificates,
 * Applications & Forms).
 *
 * Those modules' principal-plane UIs run on client-side demo state
 * (localStorage-backed stores); their mutations are NOT production
 * persistence. Phase 7-I decision: do NOT rebuild them, do NOT wire new
 * APIs — label them honestly instead. This banner is mounted ONCE per
 * module root (never per tab) at the top of the module surface.
 *
 * Variants:
 *   · 'demo'    (default) — module has no server backing at all
 *                (Inventory, Certificates, Applications & Forms).
 *   · 'preview' — real read-only GET APIs exist but the UI runs demo
 *                writes (Library, Transport): "showing demo data;
 *                server integration is planned".
 *
 * Visual language: subtle amber (matches the established LiveChip /
 * fee-alert restraint — amber = caution, never red), shadcn Alert with
 * role="note" (static informational content must not be an assertive
 * role="alert" live region). Responsive: the Alert grid stacks the icon
 * and wraps the description naturally on narrow screens.
 */

import { FlaskConical } from 'lucide-react'
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert'
import { cn } from '@/lib/utils'

export type DemoModuleNoticeVariant = 'demo' | 'preview'

const DEMO_BODY =
  'This module is a preview — changes here are not saved to the database. Full functionality is planned for a future release.'

const PREVIEW_BODY =
  'Preview — showing demo data; server integration is planned. Changes here are not saved to the database.'

export function DemoModuleNotice({
  /** Module display name (matches the sidebar label, e.g. 'Library'). */
  moduleName,
  /** 'preview' = the module has real read-only APIs but demo writes. */
  variant = 'demo',
  className,
}: {
  moduleName: string
  variant?: DemoModuleNoticeVariant
  className?: string
}) {
  return (
    <Alert
      role="note"
      className={cn(
        'border-amber-500/30 bg-amber-500/[0.05] text-amber-900 dark:text-amber-200',
        className,
      )}
    >
      <FlaskConical aria-hidden="true" />
      <AlertTitle className="text-amber-900 dark:text-amber-100">
        Demo preview
        <span className="font-normal text-amber-700/80 dark:text-amber-300/80"> · {moduleName}</span>
      </AlertTitle>
      <AlertDescription className="text-amber-800/90 dark:text-amber-200/80">
        {variant === 'preview' ? PREVIEW_BODY : DEMO_BODY}
      </AlertDescription>
    </Alert>
  )
}
