'use client'

/**
 * StudentApplicationsModule — the STUDENT side of Applications & Forms.
 *
 * Two quiet sections, matching the student Fees module's calm (white
 * surfaces, thin borders, compact rows — no marketing cards):
 *   A) "Open for you"  — Published applications the CANONICAL student is
 *      eligible for (store helper `isEligibleForApplication`), with the
 *      contextual action per state: Apply Now / status chip + View /
 *      View & Fix (corrections) / Pay ₹X (awaiting payment).
 *   B) "My submissions" — every submission owned by the canonical student,
 *      with live payment status derived from the fee ledger, Print form
 *      (official filled copy) and Withdraw while not yet reviewed.
 *
 * MONEY RULE: payments go through fee-store recordPayment() only — this
 * module never marks anything paid itself. See apply-dialog.tsx.
 */

import { useEffect, useMemo, useState } from 'react'
import {
  Eye, FileText, Paperclip, ClipboardList, Undo2,
} from 'lucide-react'
import { CATEGORY_ICON as SHARED_CATEGORY_ICON } from '@/components/shared/application-category'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  useApplicationsStore, ensureApplicationSeedData, effectiveAppStatus,
  isEligibleForApplication, isSubmittable, combinedSubmissionStatus,
  deriveSubmissionPayment,
  type ApplicationSubmission, type SchoolApplication,
} from '@/lib/store/applications-store'
import { useFeeStore } from '@/lib/store/fee-store'
import { formatINR, formatDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { useDemoStudent, submissionStatusChipClass, daysUntil } from './student'
import { ApplyDialog } from './apply-dialog'
import { SubmissionDocumentDialog } from './print-dialog'

// ─── Category icons — the SHARED map (application-category.tsx) so every
// category shows its own icon (APPS-IA-1: tour is just one type). ────────

const CATEGORY_ICON = SHARED_CATEGORY_ICON

const FALLBACK_ICON = ClipboardList

interface ApplyDialogState {
  app: SchoolApplication
  existing: ApplicationSubmission | null
  step: 'form' | 'payment'
}

export function StudentApplicationsModule() {
  const applications = useApplicationsStore((s) => s.applications)
  const submissions = useApplicationsStore((s) => s.submissions)
  // Payment chips derive from the canonical fee ledger — subscribing keeps
  // them live when the office records a payment from another screen.
  useFeeStore((s) => s.transactions)

  const identity = useDemoStudent()
  const canonical = identity?.canonical

  const [applyState, setApplyState] = useState<ApplyDialogState | null>(null)
  const [docState, setDocState] = useState<{ app: SchoolApplication; sub: ApplicationSubmission } | null>(null)
  const [withdrawTarget, setWithdrawTarget] = useState<ApplicationSubmission | null>(null)

  // Seed hydration — safe to call repeatedly; only fills while empty so the
  // student view agrees with the Principal module even if it was never opened.
  useEffect(() => {
    ensureApplicationSeedData()
  }, [])

  /** This student's most relevant submission per application (active first). */
  const activeSubByApp = useMemo(() => {
    const m = new Map<string, ApplicationSubmission>()
    if (!canonical) return m
    for (const s of submissions) {
      if (s.studentId !== canonical.id) continue
      const prev = m.get(s.applicationId)
      // Prefer an active (non-withdrawn) submission; otherwise the latest.
      if (!prev || (prev.status === 'Withdrawn' && s.status !== 'Withdrawn')) m.set(s.applicationId, s)
    }
    return m
  }, [submissions, canonical])

  const mySubmissions = useMemo(() => {
    if (!canonical) return []
    return submissions
      .filter((s) => s.studentId === canonical.id)
      .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))
  }, [submissions, canonical])

  const openForYou = useMemo(() => {
    if (!canonical) return []
    return applications
      .filter((a) => a.status === 'Published' && isEligibleForApplication(a, canonical))
      .sort((a, b) => a.deadline.localeCompare(b.deadline))
  }, [applications, canonical])

  const appById = useMemo(() => new Map(applications.map((a) => [a.id, a])), [applications])

  const handleWithdraw = () => {
    if (!withdrawTarget || !canonical) return
    const res = useApplicationsStore.getState().withdrawSubmission(withdrawTarget.id, canonical.name)
    setWithdrawTarget(null)
    if (res.success) {
      toast.success('Submission withdrawn', {
        description: 'You can apply again while the form stays open.',
      })
    } else {
      toast.error(res.error ?? 'Could not withdraw.')
    }
  }

  const openPay = (app: SchoolApplication, sub: ApplicationSubmission | null) => {
    setApplyState({ app, existing: sub, step: 'payment' })
  }

  return (
    <div className="space-y-5">
      {/* LR-1 — compact context line, no giant module title. The section
          labels below ("Open for you", …) carry the real structure. */}
      <p className="text-xs text-muted-foreground">
        School applications, registrations & consent forms open to you — apply online, pay online or at school.
      </p>

      {!canonical || !identity ? (
        <div className="rounded-xl border border-border bg-card px-4 py-10 text-center">
          <p className="text-xs text-muted-foreground">Your student record could not be resolved — please contact the school office.</p>
        </div>
      ) : (
        <>
          {/* ── A) Open for you ── */}
          <section className="space-y-2.5">
            <div className="flex items-baseline justify-between">
              <h2 className="text-sm font-semibold tracking-tight">Open for you</h2>
              <span className="text-[10px] text-muted-foreground">{openForYou.length} form{openForYou.length === 1 ? '' : 's'}</span>
            </div>

            <div className="rounded-xl border border-border bg-card divide-y divide-border overflow-hidden">
              {openForYou.length === 0 ? (
                <EmptyLine icon={<ClipboardList className="h-5 w-5" />} text="No forms are open for your class right now — anything the school publishes for you will appear here and in your notifications." />
              ) : (
                openForYou.map((app) => {
                  const sub = activeSubByApp.get(app.id) ?? null
                  const combined = sub ? combinedSubmissionStatus(app, sub) : null
                  const open = isSubmittable(app)
                  const status = effectiveAppStatus(app)
                  return (
                    <OpenRow
                      key={app.id}
                      app={app}
                      sub={sub}
                      combined={combined}
                      open={open}
                      effStatus={status}
                      onApply={() => setApplyState({ app, existing: null, step: 'form' })}
                      onFix={() => setApplyState({ app, existing: sub, step: 'form' })}
                      onPay={() => openPay(app, sub)}
                      onView={() => sub && setDocState({ app, sub })}
                    />
                  )
                })
              )}
            </div>
          </section>

          {/* ── B) My submissions ── */}
          <section className="space-y-2.5">
            <div className="flex items-baseline justify-between">
              <h2 className="text-sm font-semibold tracking-tight">My submissions</h2>
              <span className="text-[10px] text-muted-foreground">{mySubmissions.length} record{mySubmissions.length === 1 ? '' : 's'}</span>
            </div>

            <div className="rounded-xl border border-border bg-card divide-y divide-border overflow-hidden">
              {mySubmissions.length === 0 ? (
                <EmptyLine icon={<Paperclip className="h-5 w-5" />} text="You haven't submitted any forms yet — open forms appear in the section above." />
              ) : (
                mySubmissions.map((sub) => {
                  const app = appById.get(sub.applicationId)
                  if (!app) return null
                  return (
                    <SubmissionRow
                      key={sub.id}
                      app={app}
                      sub={sub}
                      onPay={() => openPay(app, sub)}
                      onPrint={() => setDocState({ app, sub })}
                      onWithdraw={() => setWithdrawTarget(sub)}
                    />
                  )
                })
              )}
            </div>
          </section>
        </>
      )}

      {/* ── Dialogs ── */}
      <ApplyDialog
        open={!!applyState}
        onOpenChange={(o) => { if (!o) setApplyState(null) }}
        app={applyState?.app ?? null}
        identity={identity}
        existingSubmission={applyState?.existing ?? null}
        initialStep={applyState?.step ?? 'form'}
      />

      <SubmissionDocumentDialog
        open={!!docState}
        onOpenChange={(o) => { if (!o) setDocState(null) }}
        app={docState?.app ?? null}
        sub={docState?.sub ?? null}
      />

      <AlertDialog open={!!withdrawTarget} onOpenChange={(o) => { if (!o) setWithdrawTarget(null) }}>
        <AlertDialogContent className="sm:max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-base">Withdraw this submission?</AlertDialogTitle>
            <AlertDialogDescription className="text-xs">
              {withdrawTarget && appById.get(withdrawTarget.applicationId)
                ? `Your submission for "${appById.get(withdrawTarget.applicationId)!.title}" will be marked Withdrawn and sent back for review only if you apply again while the form is open.`
                : 'This submission will be marked Withdrawn.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-8 text-xs">Keep it</AlertDialogCancel>
            <AlertDialogAction
              className="h-8 text-xs bg-rose-600 text-white hover:bg-rose-700"
              onClick={(e) => { e.preventDefault(); handleWithdraw() }}
            >
              <Undo2 className="h-3.5 w-3.5" /> Withdraw
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ─── Empty state (quiet one-liner, no art) ─────────────────────────────

function EmptyLine({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="px-4 py-8 text-center">
      <div className="mx-auto flex h-9 w-9 items-center justify-center rounded-lg bg-muted/50 text-muted-foreground/60">{icon}</div>
      <p className="mx-auto mt-2 max-w-sm text-xs text-muted-foreground">{text}</p>
    </div>
  )
}

// ─── Row A — an application open to this student ───────────────────────

function OpenRow({ app, sub, combined, open, effStatus, onApply, onFix, onPay, onView }: {
  app: SchoolApplication
  sub: ApplicationSubmission | null
  combined: ReturnType<typeof combinedSubmissionStatus> | null
  open: boolean
  effStatus: ReturnType<typeof effectiveAppStatus>
  onApply: () => void
  onFix: () => void
  onPay: () => void
  onView: () => void
}) {
  const Icon = (app.category === 'Tour' || app.category === 'Trip') ? CATEGORY_ICON[app.category] : FALLBACK_ICON
  const days = daysUntil(app.deadline)
  const needsPayment = app.payment.mode !== 'None'
  const awaitingPayment = combined === 'Awaiting Payment'

  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary ring-1 ring-primary/15">
        <Icon className="h-4 w-4" />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 min-w-0">
          <p className="text-xs font-semibold truncate">{app.title}</p>
          {app.participation === 'Mandatory' && (
            <Badge variant="outline" className="text-[8px] h-3.5 px-1 shrink-0">Mandatory</Badge>
          )}
        </div>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[10px] text-muted-foreground">
          <span>{app.eventDate ? `Tour ${formatDate(app.eventDate)}` : 'Tour date TBA'}</span>
          <span>· Apply by {formatDate(app.deadline)}</span>
          {open && Number.isFinite(days) && (
            <span className={cn(days <= 2 ? 'text-rose-500 font-medium' : days <= 7 ? 'text-amber-600 font-medium' : '')}>
              · {days === 0 ? 'closes today' : `${days} day${days === 1 ? '' : 's'} left`}
            </span>
          )}
          {!open && <span>· {effStatus === 'Locked' ? 'closed — deadline passed' : effStatus.toLowerCase()}</span>}
        </p>
      </div>

      <div className="hidden sm:block shrink-0 text-right">
        <p className="text-xs font-bold tabular-nums">{needsPayment ? formatINR(app.payment.amount) : 'Free'}</p>
        {needsPayment && app.payment.mode === 'Optional' && (
          <p className="text-[9px] text-muted-foreground">optional</p>
        )}
      </div>

      <div className="shrink-0 flex items-center justify-end gap-1.5">
        {!sub || sub.status === 'Withdrawn' ? (
          open ? (
            <Button size="sm" className="h-7 text-[11px] px-2.5" onClick={onApply}>
              Apply Now
            </Button>
          ) : (
            <Button size="sm" variant="outline" className="h-7 text-[11px] px-2.5" disabled>
              Closed
            </Button>
          )
        ) : (
          <>
            <span className={cn('inline-flex items-center rounded-md border px-1.5 py-0.5 text-[9.5px] font-medium', submissionStatusChipClass(combined!))}>
              {combined}
            </span>
            {awaitingPayment && (
              <Button size="sm" className="h-7 text-[11px] px-2.5" onClick={onPay}>
                Pay {formatINR(app.payment.amount)}
              </Button>
            )}
            {combined === 'Correction Required' && open && (
              <Button size="sm" variant="outline" className="h-7 text-[11px] px-2.5" onClick={onFix}>
                View &amp; Fix
              </Button>
            )}
            {(combined !== 'Correction Required' || !open) && (
              <Button size="sm" variant="outline" className="h-7 text-[11px] px-2.5" onClick={onView}>
                <Eye className="h-3 w-3" /> View
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ─── Row B — one of the student's own submissions ──────────────────────

function SubmissionRow({ app, sub, onPay, onPrint, onWithdraw }: {
  app: SchoolApplication
  sub: ApplicationSubmission
  onPay: () => void
  onPrint: () => void
  onWithdraw: () => void
}) {
  const combined = combinedSubmissionStatus(app, sub)
  const pay = deriveSubmissionPayment(app, sub)
  const Icon = (app.category === 'Tour' || app.category === 'Trip') ? CATEGORY_ICON[app.category] : FALLBACK_ICON
  const canWithdraw = sub.status === 'Submitted' || sub.status === 'Under Review'
  const canPay = pay.status === 'Not Paid' && app.payment.mode !== 'None' && sub.status !== 'Withdrawn'
  const paymentLabel =
    pay.status === 'Paid' ? `Paid · ${pay.receiptNos.join(', ')}`
      : pay.status === 'Awaiting Verification' ? `Awaiting verification · ${pay.pendingReceiptNo ?? ''}`
        : pay.status === 'Not Paid' ? 'Not Paid'
          : null

  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted/60 text-muted-foreground">
        <Icon className="h-4 w-4" />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 min-w-0">
          <p className="text-xs font-semibold truncate">{app.title}</p>
          <span className={cn('inline-flex shrink-0 items-center rounded-md border px-1.5 py-0.5 text-[9.5px] font-medium', submissionStatusChipClass(combined))}>
            {combined}
          </span>
        </div>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[10px] text-muted-foreground">
          <span>Submitted {formatDate(sub.submittedAt)}</span>
          {paymentLabel && (
            <span className={cn(
              'font-medium',
              pay.status === 'Paid' && 'text-emerald-600 dark:text-emerald-400',
              (pay.status === 'Not Paid' || pay.status === 'Awaiting Verification') && 'text-amber-600 dark:text-amber-400',
            )}>
              · {paymentLabel}
            </span>
          )}
        </p>
      </div>

      <div className="shrink-0 flex items-center justify-end gap-1.5">
        {canPay && (
          <Button size="sm" className="h-7 text-[11px] px-2.5" onClick={onPay}>
            Pay {formatINR(app.payment.amount)}
          </Button>
        )}
        {sub.status !== 'Withdrawn' && (
          <Button size="sm" variant="outline" className="h-7 text-[11px] px-2.5" onClick={onPrint}>
            <FileText className="h-3 w-3" /> Print form
          </Button>
        )}
        {canWithdraw && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-[11px] px-2 text-rose-600 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-500/10"
            onClick={onWithdraw}
          >
            <Undo2 className="h-3 w-3" /> Withdraw
          </Button>
        )}
      </div>
    </div>
  )
}
