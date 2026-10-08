'use client'

import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { formatRelativeTime, formatDate } from '@/lib/format'
import type { AuditLogItem } from '@/lib/store/teachers-store'

interface Props {
  auditLogs: AuditLogItem[]
}

/**
 * Audit Logs — concise activity feed.
 *
 * HONESTY (7-POLISH): these entries are WORKSPACE-RECORDED (client store
 * actions taken in this browser workspace) — they are not the platform's
 * server audit trail. The muted note below makes that explicit so a
 * Principal can never mistake this tab for the authoritative log.
 *
 * Layout per row:
 *   [Status Badge]  Teacher Name              [Time]
 *                   Action details (wraps naturally)
 *                   — by Actor (Role)
 *
 * Action details are NEVER truncated — they wrap into 2–3 lines when
 * needed so important context (full position title, salary, dates) is
 * always readable. Teacher name + time stay anchored on the top row
 * for quick scanning.
 */
export function AuditLogsTab({ auditLogs }: Props) {
  return (
    <div className="space-y-2">
      <p className="text-[11px] text-muted-foreground">
        Workspace-recorded activity — the authoritative server audit trail is maintained by the platform.
      </p>
      {auditLogs.length === 0 ? (
        <div className="py-10 text-center">
          <p className="text-sm text-muted-foreground">No activity yet</p>
        </div>
      ) : (
        <div className="rounded-lg border border-border/60 overflow-hidden divide-y divide-border/40">
          {auditLogs.map((log) => {
            const isEmergency = log.isEmergencyOverride
            return (
              <div
                key={log.id}
                className="px-4 py-3 bg-card hover:bg-muted/30 transition-colors"
              >
                {/* Top row: badge + teacher name + time */}
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge
                    variant="outline"
                    className={cn(
                      'text-[10px] font-semibold shrink-0',
                      isEmergency
                        ? 'border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300'
                        : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                    )}
                  >
                    {log.category}
                  </Badge>
                  <span className="font-semibold text-sm text-foreground truncate flex-1 min-w-0">
                    {log.targetTeacherName}
                  </span>
                  <span
                    className="text-[11px] text-muted-foreground font-mono shrink-0"
                    title={formatDate(log.timestamp)}
                  >
                    {formatRelativeTime(log.timestamp)}
                  </span>
                </div>

                {/* Action details — wraps naturally, never truncated */}
                <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed break-words">
                  {log.details}
                </p>

                {/* Actor — subtle attribution */}
                <p className="text-[11px] text-muted-foreground/80 mt-1">
                  — by <span className="font-medium text-muted-foreground">{log.actorName}</span>
                  {log.actorRole && <span className="text-muted-foreground/60"> · {log.actorRole}</span>}
                </p>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
