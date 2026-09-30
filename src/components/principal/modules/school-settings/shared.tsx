'use client'

import { GlassCard } from '@/components/shared/ui'
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { AlertTriangle, RefreshCw, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useSchoolSettingsStore } from '@/lib/store/school-settings-store'
import { syncSchoolSettingsFromServer, resetSchoolSettingsSyncGuard } from '@/lib/store/school-settings-store/server-sync'

// Header block used by each settings tab — icon + title + description.
// Mirrors the original markup in the monolithic `school-settings.tsx`.
export function TabHeader({
  icon: Icon,
  title,
  description,
}: {
  icon: LucideIcon
  title: string
  description?: string
}) {
  return (
    <div>
      <h3 className="font-bold text-sm text-foreground flex items-center gap-2">
        <Icon className="h-4 w-4 text-emerald-600" /> {title}
      </h3>
      {description && <p className="text-xs text-muted-foreground">{description}</p>}
    </div>
  )
}

/**
 * Sync status gate for server-backed tabs: skeleton while the config is
 * syncing, an honest retry banner when the sync failed (existing data
 * stays usable via the fallback children), content otherwise.
 */
export function SyncGate({ children }: { children: ReactNode }) {
  const syncStatus = useSchoolSettingsStore((s) => s.server.syncStatus)
  const syncedAt = useSchoolSettingsStore((s) => s.server.syncedAt)

  if (syncStatus === 'syncing' && !syncedAt) {
    return (
      <GlassCard className="p-6 space-y-4" aria-busy="true" aria-live="polite">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Loading school configuration…
        </div>
        <div className="space-y-3" aria-hidden>
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="h-9 rounded-lg bg-muted/60 animate-pulse" />
          ))}
        </div>
      </GlassCard>
    )
  }

  if (syncStatus === 'error') {
    return (
      <GlassCard className="p-5 space-y-3">
        <div className="flex items-start gap-3">
          <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-foreground">School configuration could not be loaded</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              The saved settings are temporarily unavailable — nothing was lost. Retry below or keep
              editing local values (they save once the server responds).
            </p>
          </div>
        </div>
        <div>
          <Button
            size="sm"
            variant="outline"
            className="h-8 text-xs gap-1.5"
            onClick={() => {
              resetSchoolSettingsSyncGuard()
              void syncSchoolSettingsFromServer()
            }}
          >
            <RefreshCw className="h-3.5 w-3.5" /> Retry
          </Button>
        </div>
        {children}
      </GlassCard>
    )
  }

  return <>{children}</>
}

/**
 * "Synced with school record" / "Unsaved changes" state chip. Announced
 * politely to screen readers (aria-live) because it carries save-state.
 */
export function SyncChip({ dirty, saving }: { dirty: boolean; saving?: boolean }) {
  return (
    <span
      role="status"
      aria-live="polite"
      className={
        dirty
          ? 'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-500/25'
          : 'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/25'
      }
    >
      {saving ? (
        <>
          <Loader2 className="h-3 w-3 animate-spin" /> Saving…
        </>
      ) : dirty ? (
        <>
          <span className="h-1.5 w-1.5 rounded-full bg-amber-500" /> Unsaved changes
        </>
      ) : (
        <>
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Synced with school record
        </>
      )}
    </span>
  )
}

// Compact label→value row used by the account/security tab (and any future
// read-only settings surface): muted label left, semibold value right,
// hairline separators. Matches the Finance-module InfoRow rhythm.
export function SettingsInfoRow({
  label,
  value,
  mono = false,
}: {
  label: string
  value: React.ReactNode
  mono?: boolean
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <span className="text-xs text-muted-foreground shrink-0">{label}</span>
      <span
        className={`text-xs font-semibold text-foreground text-right min-w-0 break-words ${mono ? 'font-mono' : ''}`}
      >
        {value}
      </span>
    </div>
  )
}

// Compact section group used inside a SettingsTab to cluster related
// fields (Finance Settings grouping pattern): a 10px uppercase muted
// label with a hairline rule, then the field grid. Keeps long forms
// scannable without adding visual weight.
export function FieldGroup({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2.5">
        <h4 className="text-[10px] uppercase font-semibold tracking-wider text-muted-foreground">
          {label}
        </h4>
        <div className="h-px flex-1 bg-border" aria-hidden />
      </div>
      {children}
    </section>
  )
}

// Wrapper used by every settings tab. Renders a GlassCard with consistent
// padding/spacing. When `action` is provided, the header sits in a flex row
// alongside the action slot (e.g. the "Add Book to Store" button); otherwise
// just the header is rendered on its own.
export function SettingsTab({
  icon,
  title,
  description,
  action,
  children,
}: {
  icon: LucideIcon
  title: string
  description?: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <GlassCard className="p-6 space-y-6">
      {action ? (
        <div className="flex items-center justify-between">
          <TabHeader icon={icon} title={title} description={description} />
          {action}
        </div>
      ) : (
        <TabHeader icon={icon} title={title} description={description} />
      )}
      {children}
    </GlassCard>
  )
}
