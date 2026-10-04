'use client'

/**
 * SAAS-HARDENING (§8) — platform console · school detail · Identity Change
 * Requests tab.
 *
 * The school requests changes to its LEGAL identity (name / code /
 * affiliation) from its own settings; the platform reviews them here.
 * Approving is the ONLY path that mutates legal identity — the confirm
 * dialog says exactly that. PATCH is step-up-gated and audited
 * server-side; rejecting leaves the identity untouched.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  FileSignature,
  RefreshCw,
  ShieldAlert,
  XCircle,
} from 'lucide-react'
import { platformApi, type PlatformApiError } from '../platform-client'
import { useStepUpGate } from '../step-up-gate'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { toast } from 'sonner'

// ── Types (API contract — profile-change-requests) ────────────────────────

interface ChangeRequest {
  id: string
  field: string
  currentValue: string | null
  requestedValue: string
  reason: string
  status: string
  reviewNote: string | null
  requestedById: string | null
  reviewedById: string | null
  reviewedAt: string | null
  createdAt: string
}

interface RequestsResponse {
  school: { name: string; code: string; affiliation: string } | null
  requests: ChangeRequest[]
}

const FIELD_LABELS: Record<string, string> = {
  name: 'School name',
  code: 'School code',
  affiliation: 'Affiliation',
}

function fieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? field
}

function errText(e: unknown): string {
  const pae = e as PlatformApiError
  if (pae && typeof pae.error === 'string') return pae.error
  return e instanceof Error ? e.message : 'Something went wrong'
}

function fmtDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

const STATUS_STYLES: Record<string, string> = {
  PENDING: 'border-amber-200 bg-amber-50 text-amber-700',
  APPROVED: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  REJECTED: 'border-red-200 bg-red-50 text-red-600',
}

function StatusBadge({ status }: { status: string }) {
  return (
    <Badge variant="outline" className={`normal-case ${STATUS_STYLES[status] ?? 'border-slate-200 bg-slate-100 text-slate-600'}`}>
      {status}
    </Badge>
  )
}

/** Change display: current → requested (both honest, mono, breakable). */
function ChangeLine({ current, requested }: { current: string | null; requested: string }) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
      <span className="max-w-full break-all rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 font-mono text-xs text-slate-600">
        {current && current.trim().length > 0 ? current : <span className="text-slate-400">(empty)</span>}
      </span>
      <ArrowRight className="h-3.5 w-3.5 shrink-0 text-teal-600" aria-label="changes to" />
      <span className="max-w-full break-all rounded-lg border border-teal-200 bg-teal-50 px-2.5 py-1 font-mono text-xs font-semibold text-teal-800">
        {requested}
      </span>
    </div>
  )
}

// ── Module ────────────────────────────────────────────────────────────────

export function SchoolIdentityRequestsTab({
  schoolId,
  onChanged,
}: {
  schoolId: string
  /** Fired after an approval mutates the school's identity (parent reload). */
  onChanged?: () => void
}) {
  const { gate, node: stepUpNode } = useStepUpGate()
  const [data, setData] = useState<RequestsResponse | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<{ action: 'approve' | 'reject'; request: ChangeRequest } | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoadError(null)
    try {
      setData(
        await platformApi<RequestsResponse>(
          `/api/platform/schools/${schoolId}/profile-change-requests`,
        ),
      )
    } catch (e) {
      setLoadError(errText(e))
    }
  }, [schoolId])

  useEffect(() => {
    void load()
  }, [load])

  // Pending first (review queue), then newest — the API returns status asc,
  // but the review workflow wants open items on top.
  const requests = useMemo(() => {
    const rank = (r: ChangeRequest) => (r.status === 'PENDING' ? 0 : 1)
    return (data?.requests ?? [])
      .slice()
      .sort((a, b) => {
        if (rank(a) !== rank(b)) return rank(a) - rank(b)
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      })
  }, [data])

  const pendingCount = requests.filter((r) => r.status === 'PENDING').length

  const submitReview = async (action: 'approve' | 'reject', request: ChangeRequest) => {
    const reviewNote = (notes[request.id] ?? '').trim()
    setBusy(request.id)
    setActionError(null)
    try {
      const res = await gate(() =>
        platformApi<{ ok: true; status: string; applied?: { field: string; value: string } }>(
          `/api/platform/schools/${schoolId}/profile-change-requests/${request.id}`,
          {
            method: 'PATCH',
            body: JSON.stringify({
              action,
              ...(reviewNote ? { reviewNote } : {}),
            }),
          },
        ),
      )
      if (!res) return // cancelled at the step-up prompt
      if (action === 'approve') {
        toast.success(
          `Identity change applied — ${fieldLabel(request.field)} is now “${res.applied?.value ?? request.requestedValue}”`,
        )
        onChanged?.() // the school header/name just changed
      } else {
        toast.success('Request rejected — the school’s legal identity is unchanged')
      }
      setNotes((n) => {
        const next = { ...n }
        delete next[request.id]
        return next
      })
      setConfirm(null)
      await load()
    } catch (e) {
      setActionError(errText(e))
      setConfirm(null)
    } finally {
      setBusy(null)
    }
  }

  const current = data?.school

  return (
    <div className="space-y-4">
      {stepUpNode}

      {/* ── Current legal identity (context for the review) ─────────── */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-4 py-3.5 sm:px-5">
          <h2 className="font-display text-sm font-bold text-slate-900 flex items-center gap-2">
            <FileSignature className="h-4 w-4 text-teal-600" aria-hidden="true" />
            Legal identity change requests
            {pendingCount > 0 && (
              <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700 normal-case">
                {pendingCount} pending review
              </Badge>
            )}
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            The school requests name / code / affiliation changes from its own settings; approving
            here is the only path that ever mutates its legal identity. Every review is step-up
            gated and audited.
          </p>
        </div>

        <dl className="grid grid-cols-1 gap-x-6 gap-y-3.5 p-4 sm:grid-cols-3 sm:px-5">
          <div>
            <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Current name</dt>
            <dd className="mt-1 break-words text-sm text-slate-700">{current?.name ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Current code</dt>
            <dd className="mt-1 break-words font-mono text-sm text-slate-700">{current?.code ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Current affiliation</dt>
            <dd className="mt-1 break-words text-sm text-slate-700">{current?.affiliation ?? '—'}</dd>
          </div>
        </dl>
      </div>

      {loadError && (
        <div
          role="alert"
          className="flex flex-col gap-3 rounded-xl border border-red-200 bg-red-50 p-4 sm:flex-row sm:items-center sm:justify-between"
        >
          <p className="flex items-start gap-2.5 text-sm text-red-600">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {loadError}
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void load()}
            className="h-9 border-slate-300 bg-transparent text-slate-700 hover:bg-slate-100 focus-ring"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            Retry
          </Button>
        </div>
      )}

      {data === null && loadError === null && (
        <div className="space-y-3" aria-busy="true" aria-label="Loading identity change requests">
          <Skeleton className="h-24 w-full rounded-xl bg-slate-100" />
          <Skeleton className="h-24 w-full rounded-xl bg-slate-100" />
        </div>
      )}

      {data && actionError && (
        <div role="alert" className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 p-3.5 text-sm text-red-600">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          {actionError}
        </div>
      )}

      {data && requests.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-xl border border-slate-200 bg-white shadow-sm px-4 py-10 text-center">
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-slate-500 ring-1 ring-slate-200">
            <FileSignature className="h-5 w-5" aria-hidden="true" />
          </div>
          <p className="mt-3 text-sm font-semibold text-slate-900">No identity change requests</p>
          <p className="mt-1 max-w-xs text-xs leading-snug text-slate-500">
            The school hasn&apos;t requested any changes to its legal identity (name, code,
            affiliation). Requests it submits from its own settings appear here for review.
          </p>
        </div>
      )}

      {data && requests.length > 0 && (
        <ul className="space-y-4" aria-label="Identity change requests">
          {requests.map((r) => {
            const pending = r.status === 'PENDING'
            const note = notes[r.id] ?? ''
            return (
              <li
                key={r.id}
                className={`rounded-xl border bg-white shadow-sm ${
                  pending ? 'border-amber-200' : 'border-slate-200'
                }`}
              >
                <div className="border-b border-slate-200 px-4 py-3.5 sm:px-5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold text-slate-900">
                      {fieldLabel(r.field)}
                      <span className="ml-2 text-[11px] font-normal text-slate-500">
                        requested {fmtDate(r.createdAt)}
                      </span>
                    </h3>
                    <StatusBadge status={r.status} />
                  </div>
                  <ChangeLine current={r.currentValue} requested={r.requestedValue} />
                </div>

                <div className="space-y-3.5 p-4 sm:px-5">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                      Reason given by the school
                    </p>
                    <p className="mt-1 break-words rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-600">
                      {r.reason}
                    </p>
                  </div>

                  {!pending && (
                    <div className="flex flex-col gap-1.5 text-xs text-slate-500 sm:flex-row sm:items-center sm:gap-3">
                      <span className="flex items-center gap-1.5">
                        {r.status === 'APPROVED' ? (
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
                        ) : (
                          <XCircle className="h-3.5 w-3.5 text-red-500" aria-hidden="true" />
                        )}
                        {r.status === 'APPROVED'
                          ? `Approved and applied to the school’s legal identity${r.reviewedAt ? ` · ${fmtDate(r.reviewedAt)}` : ''}`
                          : `Rejected — the school’s identity was left unchanged${r.reviewedAt ? ` · ${fmtDate(r.reviewedAt)}` : ''}`}
                      </span>
                      {r.reviewNote && (
                        <span className="break-words italic">
                          “{r.reviewNote}”
                        </span>
                      )}
                    </div>
                  )}

                  {pending && (
                    <div className="space-y-3 rounded-xl border border-amber-100 bg-amber-50/50 p-3.5">
                      <div className="space-y-1.5">
                        <Label htmlFor={`review-note-${r.id}`} className="text-xs font-semibold text-slate-700">
                          Review note (optional — shown on the request trail)
                        </Label>
                        <Textarea
                          id={`review-note-${r.id}`}
                          value={note}
                          onChange={(e) => setNotes((n) => ({ ...n, [r.id]: e.target.value }))}
                          placeholder="e.g. Affidavit and board circular verified against the gazette copy…"
                          rows={2}
                          maxLength={400}
                          className="bg-white border-slate-200 text-slate-900 placeholder:text-slate-400 focus-visible:ring-teal-500/40 min-h-[64px]"
                        />
                        <p className="text-[10px] text-slate-400 tabular-nums">{note.trim().length}/400</p>
                      </div>
                      <div className="flex flex-wrap gap-2.5">
                        <Button
                          onClick={() => setConfirm({ action: 'approve', request: r })}
                          disabled={busy === r.id}
                          className="h-11 bg-teal-600 hover:bg-teal-700 text-white font-semibold focus-ring"
                        >
                          <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                          {busy === r.id ? 'Applying…' : 'Approve & apply'}
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => setConfirm({ action: 'reject', request: r })}
                          disabled={busy === r.id}
                          className="h-11 border-red-200 bg-red-50 text-red-600 hover:bg-red-100 hover:text-red-700 font-semibold focus-ring"
                        >
                          <XCircle className="h-4 w-4" aria-hidden="true" />
                          Reject
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {/* ── Approve / Reject confirmation ────────────────────────────── */}
      <AlertDialog
        open={confirm !== null}
        onOpenChange={(v) => {
          if (!v) setConfirm(null)
        }}
      >
        <AlertDialogContent className="bg-white border-slate-200 text-slate-900 sm:max-w-md">
          {confirm && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle className="font-display flex items-center gap-2 text-slate-900">
                  {confirm.action === 'approve' ? (
                    <>
                      <ShieldAlert className="h-4 w-4 text-amber-600" aria-hidden="true" />
                      Approve identity change?
                    </>
                  ) : (
                    <>
                      <XCircle className="h-4 w-4 text-red-600" aria-hidden="true" />
                      Reject this request?
                    </>
                  )}
                </AlertDialogTitle>
                <AlertDialogDescription asChild>
                  <div className="space-y-3 text-slate-500">
                    {confirm.action === 'approve' ? (
                      <>
                        <p>
                          <strong className="text-slate-700">
                            Approving applies this change to the school&apos;s legal identity
                          </strong>{' '}
                          — <span className="font-semibold text-slate-700">{fieldLabel(confirm.request.field)}</span>{' '}
                          becomes{' '}
                          <span className="break-all font-mono text-xs font-semibold text-teal-800">
                            {confirm.request.requestedValue}
                          </span>{' '}
                          immediately, everywhere the school is identified (documents, receipts,
                          directory). This is the only path that mutates legal identity; the
                          action is step-up gated and audited.
                        </p>
                        <p>
                          Current value:{' '}
                          <span className="break-all font-mono text-xs text-slate-600">
                            {confirm.request.currentValue ?? '(empty)'}
                          </span>
                        </p>
                      </>
                    ) : (
                      <p>
                        The request is marked rejected with your review note; the school&apos;s
                        legal identity stays unchanged. The school can submit a corrected request
                        from its settings.
                      </p>
                    )}
                    {(notes[confirm.request.id] ?? '').trim().length > 0 && (
                      <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs italic text-slate-600">
                        “{(notes[confirm.request.id] ?? '').trim()}”
                      </p>
                    )}
                  </div>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter className="gap-2">
                <Button
                  variant="outline"
                  onClick={() => setConfirm(null)}
                  disabled={busy === confirm.request.id}
                  className="h-11 border-slate-300 bg-transparent text-slate-700 hover:bg-slate-100 focus-ring"
                >
                  Cancel
                </Button>
                <Button
                  onClick={() => void submitReview(confirm.action, confirm.request)}
                  disabled={busy === confirm.request.id}
                  className={
                    confirm.action === 'approve'
                      ? 'h-11 bg-teal-600 hover:bg-teal-700 text-white font-semibold focus-ring'
                      : 'h-11 bg-red-600 hover:bg-red-500 text-white font-semibold focus-ring'
                  }
                >
                  {busy === confirm.request.id
                    ? 'Applying…'
                    : confirm.action === 'approve'
                      ? 'Approve & apply'
                      : 'Reject request'}
                </Button>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
