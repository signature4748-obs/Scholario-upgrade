'use client'

/**
 * DemoModuleNotice — the STUDENT-plane twin of the Principal module's
 * honest-labeling banner (principal/modules/shared/demo-module-notice.tsx,
 * Phase 7-I). Deliberately a local copy, NOT a cross-plane import: the
 * student shell never imports from @/components/principal (verified —
 * zero such imports in the tree), and this keeps each plane's demo
 * labeling self-contained.
 *
 * Used for student-side surfaces that run on client-side demo state
 * (localStorage-backed stores) whose mutations are NOT production
 * persistence — e.g. the Applications module's demo apply/pay flow
 * (fabricated UPI reference, client-minted receipt — 7-M hygiene note c).
 * Server-backed student surfaces must NOT carry this banner.
 *
 * Visual language: identical to the principal twin — subtle amber
 * (amber = caution, never red), shadcn Alert with role="note".
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
  /** Module display name (matches the sidebar label, e.g. 'Applications'). */
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
