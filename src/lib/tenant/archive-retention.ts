/**
 * Archive RETENTION (SaaS-STAGE-2A) — centralized, pure logic for the
 * archived-fee-structure lifecycle:
 *
 *   Active → Archived → 30-day retention → auto purge (platform job)
 *
 * HARD BOUNDARY: the purge is a FUTURE SERVER-SIDE CLEANUP JOB (the old
 * client adapter seam in src/lib/platform/adapters.ts was removed in the
 * PIH-4c dead-code pass — the scheduling boundary now lands server-side
 * with the Resend/infrastructure phase).
 * Nothing here deletes data; there is deliberately NO client timer. The UI
 * may only DISPLAY the retention state ("purge-eligible on <date>").
 */

import type { TenantConfig } from './types'

export const DEFAULT_ARCHIVE_RETENTION_DAYS = 30

export interface ArchiveRetentionState {
  archivedAt: string
  retentionDays: number
  /** ISO date when the platform purge job becomes eligible to remove it. */
  purgeEligibleOn: string
  daysRemaining: number
  expired: boolean
}

function startOfDay(iso: string): Date {
  const d = new Date(iso)
  d.setHours(0, 0, 0, 0)
  return d
}

export function computeRetentionDeadline(archivedAt: string, retentionDays: number = DEFAULT_ARCHIVE_RETENTION_DAYS): string {
  const d = startOfDay(archivedAt)
  d.setDate(d.getDate() + retentionDays)
  return d.toISOString().split('T')[0]
}

export function getArchiveRetentionState(
  archivedAt: string | undefined | null,
  config?: Pick<TenantConfig, 'archiveRetentionDays'>,
  now: string = new Date().toISOString(),
): ArchiveRetentionState | null {
  if (!archivedAt) return null
  const retentionDays = config?.archiveRetentionDays ?? DEFAULT_ARCHIVE_RETENTION_DAYS
  const purgeEligibleOn = computeRetentionDeadline(archivedAt, retentionDays)
  const msPerDay = 86_400_000
  const daysRemaining = Math.ceil((startOfDay(purgeEligibleOn).getTime() - startOfDay(now).getTime()) / msPerDay)
  return {
    archivedAt,
    retentionDays,
    purgeEligibleOn,
    daysRemaining,
    expired: daysRemaining <= 0,
  }
}
