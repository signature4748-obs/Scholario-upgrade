'use client'

/**
 * RecentAdmissions — shadcn Table + shared Avatar + real admission store data.
 *
 * Redesigned (DASH-1):
 *   - Was a plain HTML <table> showing 6 Class 2-A roster rows (mislabelled
 *     as "Recent Admissions") with no row onClick.
 *   - Now uses the shared `Panel` (flat, bodyClassName="p-0" so the table sits
 *     flush to the panel edges) + shadcn `<Table>` from `@/components/ui/table`
 *     with the Academics table language:
 *       header `text-[10px] uppercase tracking-wider font-semibold py-2.5`
 *       body rows `border-b border-border/40 last:border-0 hover:bg-muted/30
 *       text-xs`
 *   - Uses the shared `<Avatar>` from `@/components/shared/avatar.tsx` for
 *     the student avatar (size="sm").
 *   - Pulls from `useAdmissionStore.applications` — the latest 5 real
 *     applications (excluding Draft status, sorted by submittedDate desc).
 *     Each row's click navigates to the admission module via `onNavigate`.
 *   - Status column shows the AdmissionStatus as a small dot+pill badge
 *     (Academics canonical) instead of the legacy `StatusBadge`.
 */

import { motion } from 'framer-motion'
import { Eye } from 'lucide-react'
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@/components/ui/table'
import { Panel } from '../shared/panel'
import { Avatar } from '@/components/shared/avatar'
import { useAdmissionStore, type AdmissionApplication, type AdmissionStatus } from '@/lib/store/admission-store'
import { cn } from '@/lib/utils'

export interface RecentAdmissionsProps {
  onNavigate?: (module: string) => void
}

const STATUS_STYLES: Record<AdmissionStatus, { dot: string; pill: string; label?: string }> = {
  Draft:           { dot: 'bg-muted-foreground', pill: 'bg-muted/40 text-muted-foreground' },
  Submitted:       { dot: 'bg-sky-500',          pill: 'bg-sky-500/10 text-sky-700 dark:text-sky-400' },
  'Under Review':  { dot: 'bg-amber-500',        pill: 'bg-amber-500/10 text-amber-700 dark:text-amber-400' },
  'Need Correction':{ dot: 'bg-orange-500',      pill: 'bg-orange-500/10 text-orange-700 dark:text-orange-400' },
  Resubmitted:     { dot: 'bg-sky-500',          pill: 'bg-sky-500/10 text-sky-700 dark:text-sky-400' },
  Approved:        { dot: 'bg-emerald-500',       pill: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' },
  Rejected:        { dot: 'bg-rose-500',          pill: 'bg-rose-500/10 text-rose-700 dark:text-rose-400' },
  Completed:       { dot: 'bg-emerald-600',       pill: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' },
  Archived:        { dot: 'bg-slate-500',         pill: 'bg-slate-500/10 text-slate-600 dark:text-slate-400' },
}

function StatusPill({ status }: { status: AdmissionStatus }) {
  const s = STATUS_STYLES[status]
  return (
    <span className={cn(
      'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold',
      s.pill,
    )}>
      <span className={cn('h-1.5 w-1.5 rounded-full', s.dot)} />
      {status}
    </span>
  )
}

function getRecentApplications(applications: AdmissionApplication[], limit = 5): AdmissionApplication[] {
  return applications
    .filter((a) => a.status !== 'Draft')
    .slice()
    .sort((a, b) => new Date(b.submittedDate).getTime() - new Date(a.submittedDate).getTime())
    .slice(0, limit)
}

export function RecentAdmissions({ onNavigate }: RecentAdmissionsProps) {
  const applications = useAdmissionStore((s) => s.applications)
  const recent = getRecentApplications(applications)

  return (
    <Panel
      title="Recent Admissions"
      subtitle="Latest admission applications"
      bodyClassName="p-0"
      action={
        <button
          onClick={() => onNavigate?.('admission')}
          className="inline-flex items-center gap-1 h-7 px-2 rounded-md text-[11px] font-medium text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-colors"
          title="Open Admissions"
        >
          View all
        </button>
      }
    >
      <Table>
        <TableHeader>
          <TableRow className="border-b border-border hover:bg-transparent">
            <TableHead className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground py-2.5 px-4">
              Student
            </TableHead>
            <TableHead className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground py-2.5 hidden sm:table-cell">
              Admission No
            </TableHead>
            <TableHead className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground py-2.5">
              Class
            </TableHead>
            <TableHead className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground py-2.5 hidden md:table-cell">
              Guardian
            </TableHead>
            <TableHead className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground py-2.5">
              Status
            </TableHead>
            <TableHead className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground py-2.5 text-right">
              Action
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {recent.map((a, i) => (
            <motion.tr
              key={a.id}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: i * 0.04 }}
              onClick={() => onNavigate?.('admission')}
              className="border-b border-border/40 last:border-0 hover:bg-muted/30 transition-colors text-xs cursor-pointer"
            >
              <TableCell className="py-2.5 px-4">
                <div className="flex items-center gap-2.5 min-w-0">
                  <Avatar name={a.applicantName} size="sm" />
                  <div className="min-w-0">
                    <p className="font-medium text-foreground truncate">{a.applicantName}</p>
                    <p className="text-[11px] text-muted-foreground truncate">
                      {a.formData.fatherName || '—'}
                    </p>
                  </div>
                </div>
              </TableCell>
              <TableCell className="py-2.5 hidden sm:table-cell font-mono text-[11px] text-muted-foreground">
                {a.admissionNo}
              </TableCell>
              <TableCell className="py-2.5">
                <span className="font-medium">{a.className}{a.section && a.section !== '—' ? `-${a.section}` : ''}</span>
              </TableCell>
              <TableCell className="py-2.5 hidden md:table-cell text-muted-foreground">
                {a.formData.fatherName || '—'}
              </TableCell>
              <TableCell className="py-2.5">
                <StatusPill status={a.status} />
              </TableCell>
              <TableCell className="py-2.5 text-right">
                <button
                  onClick={(e) => { e.stopPropagation(); onNavigate?.('admission') }}
                  className="inline-flex items-center justify-center h-7 w-7 rounded-md border border-border bg-card text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-colors"
                  title="View application"
                  aria-label="View application"
                >
                  <Eye className="h-3.5 w-3.5" />
                </button>
              </TableCell>
            </motion.tr>
          ))}
          {recent.length === 0 && (
            <TableRow>
              <TableCell colSpan={6} className="py-6 text-center text-xs text-muted-foreground">
                No admission applications yet.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </Panel>
  )
}
