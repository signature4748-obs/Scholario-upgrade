'use client'

/**
 * RecentAdmissions + RecentInquiries — the principal dashboard's
 * admissions panels.
 *
 * PHASE 7-H (admissions honesty):
 *   - "Recent Admissions" reads the LOCAL admission workspace (the
 *     zustand admission store persisted to this browser) — its subtitle
 *     says exactly that. It shows the applications the principal's
 *     office is working on, not a server registry.
 *   - "Recent Inquiries (live)" is REAL server data: GET
 *     /api/admissions/inquiries returns the school's ActivityLog
 *     ADMISSION_INQUIRY rows written by the public website's admission
 *     form (POST /api/admissions/public). Loading / error / empty
 *     states are honest — no fabricated rows.
 *
 * Original design (DASH-1): shadcn Table inside the shared `Panel`
 * (bodyClassName="p-0"), shared `<Avatar>`, Academics table language
 * (header text-[10px] uppercase tracking-wider, body rows
 * border-b border-border/40 text-xs), motion row fade-in.
 */

import { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Eye, RefreshCw, Wifi } from 'lucide-react'
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

// ── Live inquiries (server truth — GET /api/admissions/inquiries) ────

interface InquiryRow {
  id: string
  studentName: string
  class: string
  parentName: string
  phone: string
  email: string
  createdAt: string
}

function formatInquiryDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) +
    ' · ' + d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
}

function RecentInquiries({ onNavigate }: { onNavigate?: (module: string) => void }) {
  const [inquiries, setInquiries] = useState<InquiryRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admissions/inquiries', {
        credentials: 'same-origin',
        cache: 'no-store',
      })
      const json = (await res.json().catch(() => null)) as
        | { ok?: boolean; data?: InquiryRow[]; error?: string }
        | null
      if (!res.ok || !json?.ok || !Array.isArray(json.data)) {
        throw new Error(json?.error || `HTTP ${res.status}`)
      }
      setInquiries(json.data)
    } catch {
      setInquiries([])
      setError('Could not load inquiries from the server.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const rows = inquiries ?? []

  return (
    <Panel
      title="Recent Inquiries (live)"
      subtitle="Public admission form · recorded on the server"
      bodyClassName="p-0"
      action={
        <button
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex items-center gap-1 h-7 px-2 rounded-md text-[11px] font-medium text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-colors disabled:opacity-50"
          title="Refresh inquiries"
          aria-label="Refresh inquiries"
        >
          <RefreshCw className={cn('h-3 w-3', loading && 'animate-spin')} aria-hidden="true" />
          Refresh
        </button>
      }
    >
      <Table>
        <TableHeader>
          <TableRow className="border-b border-border hover:bg-transparent">
            <TableHead className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground py-2.5 px-4">
              Student
            </TableHead>
            <TableHead className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground py-2.5">
              Class
            </TableHead>
            <TableHead className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground py-2.5">
              Parent
            </TableHead>
            <TableHead className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground py-2.5 hidden sm:table-cell">
              Contact
            </TableHead>
            <TableHead className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground py-2.5 text-right">
              Received
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((q, i) => (
            <motion.tr
              key={q.id}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: i * 0.04 }}
              onClick={() => onNavigate?.('admission')}
              className="border-b border-border/40 last:border-0 hover:bg-muted/30 transition-colors text-xs cursor-pointer"
            >
              <TableCell className="py-2.5 px-4">
                <div className="flex items-center gap-2.5 min-w-0">
                  <Avatar name={q.studentName || '?'} size="sm" />
                  <p className="font-medium text-foreground truncate">{q.studentName || '—'}</p>
                </div>
              </TableCell>
              <TableCell className="py-2.5">
                <span className="font-medium">{q.class || '—'}</span>
              </TableCell>
              <TableCell className="py-2.5 text-muted-foreground">
                <span className="block truncate">{q.parentName || '—'}</span>
              </TableCell>
              <TableCell className="py-2.5 hidden sm:table-cell text-muted-foreground font-mono text-[11px]">
                <span className="block truncate">{q.phone || q.email || '—'}</span>
              </TableCell>
              <TableCell className="py-2.5 text-right text-muted-foreground">
                <span className="text-[11px]">{formatInquiryDate(q.createdAt)}</span>
              </TableCell>
            </motion.tr>
          ))}
          {error && (
            <TableRow>
              <TableCell colSpan={5} className="py-6 text-center text-xs text-rose-600 dark:text-rose-400">
                {error}
                <button
                  onClick={() => void load()}
                  className="ml-2 inline-flex items-center gap-1 underline underline-offset-2 hover:text-foreground"
                >
                  <RefreshCw className="h-3 w-3" aria-hidden="true" /> Retry
                </button>
              </TableCell>
            </TableRow>
          )}
          {!error && !loading && rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={5} className="py-6 text-center text-xs text-muted-foreground">
                No inquiries yet.
              </TableCell>
            </TableRow>
          )}
          {!error && loading && rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={5} className="py-6 text-center text-xs text-muted-foreground">
                Loading inquiries…
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      <div className="flex items-center gap-1.5 px-4 py-2 border-t border-border/40 text-[10px] text-muted-foreground">
        <Wifi className="h-3 w-3 shrink-0" aria-hidden="true" />
        Live from the school website&apos;s admission form — full application processing is coming
        soon.
      </div>
    </Panel>
  )
}

export function RecentAdmissions({ onNavigate }: RecentAdmissionsProps) {
  const applications = useAdmissionStore((s) => s.applications)
  const recent = getRecentApplications(applications)

  return (
    <div className="space-y-4">
      <Panel
        title="Recent Admissions"
        subtitle="Applications in this workspace (local)"
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

      <RecentInquiries onNavigate={onNavigate} />
    </div>
  )
}
