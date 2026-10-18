'use client'

// ============================================================
// SchoolDetailModule — /platform/schools/[id] (PHASE 6 · §7 IA)
// ------------------------------------------------------------
// Full tenant dossier: stats, profile, metadata editor (PATCH),
// plan & module feature flags, the danger zone (activate/suspend/
// reactivate + typed-confirmation cascade delete) and the
// "Access School" support-session launcher. Every destructive call
// is wrapped in useStepUpGate; the server re-authorizes anyway.
//
// §7 (operator IA) — the former 12-tab workspace is consolidated
// into 6 operator groups: Overview · Configuration · Access & users
// · Subscription · Support & audit · Advanced. PURE REGROUPING: every
// capability, permission check, step-up gate and audit hook survives;
// merged children render as titled sub-sections (headings + anchors,
// never tab-in-tab). Every pre-§7 deep link still resolves —
// LEGACY_TAB_REDIRECT maps the old ?tab= keys (and the child modules'
// own cross-tab calls, which still use their legacy keys) onto the
// new groups, landing on the exact sub-section.
//
// PHASE 10 (two-project topology) — the Access & users group leads
// with the ACCESS card: the tenant's canonical doors (login URL /
// public URL from SCHOOL_APP_BASE_URL — never guessed, copy resolves
// relative URLs against the current origin), the founding principal's
// credential/last-sign-in truth, and the tenant-domain status summary
// (Configuration → Custom domains stays the management surface).
// ============================================================

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { motion } from 'framer-motion'
import {
  ArrowLeft,
  ExternalLink,
  RefreshCw,
  AlertTriangle,
  LifeBuoy,
  Users,
  GraduationCap,
  BookOpen,
  LayoutGrid,
  ClipboardList,
  IndianRupee,
  MonitorSmartphone,
  Globe,
  MapPin,
  CalendarDays,
  History,
  Trash2,
  Ban,
  Power,
  Palette,
  ShieldAlert,
  Info,
  Copy,
  Check,
  ChevronRight,
  LogIn,
  User,
} from 'lucide-react'
import { usePlatformSession, platformApi, type PlatformApiError } from '../platform-client'
import { useStepUpGate } from '../step-up-gate'
import { SchoolDomainsTab } from './school-domains'
import { SchoolSetupTab } from './school-setup'
import { SchoolSubscriptionTab } from './school-subscription'
import { SchoolIdentityRequestsTab } from './school-identity-requests'
import { SchoolPaymentGatewayTab } from './school-payment-gateway'
import { SchoolUsersTab } from './school-users'
import { SchoolSupportTab } from './school-support'
import { SchoolAuditTab } from './school-audit'
import { SubscriptionPendingBanner, isSubscriptionSchemaPending } from './pending-banner'
import { saveSupportToken } from '@/lib/platform-session-token'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { toast } from 'sonner'

// ── Types (API contract, worklog Task 6-1) ────────────────────────────────

interface SchoolRecord {
  id: string
  name: string
  slug: string
  code: string
  domain: string | null
  address: string | null
  city: string | null
  phone: string | null
  email: string | null
  board: string
  plan: string
  status: string
  academicYear: string | null
  themeColor: string
  accentColor: string
  isDemo: boolean
  featureFlags: Record<string, boolean>
  createdAt: string
  updatedAt: string
}

interface SchoolDetailData {
  school: SchoolRecord
  counts: { users: number; students: number; teachers: number; classes: number; exams: number; fees: number }
  activeSchoolSessions: number
  activeSupportSessions: number
  // TWO-PROJECT TOPOLOGY (PHASE 10) — the access truth: canonical
  // doors (may be RELATIVE when SCHOOL_APP_BASE_URL is unset — the
  // unified deployment serves both planes), the founding principal's
  // credential state, and the tenant-domain status summary.
  access: {
    loginUrl: string
    publicUrl: string
    principal: {
      id: string
      email: string
      name: string | null
      status: string
      credentialState: 'BOOTSTRAP_PENDING' | 'OWNED' | 'UNKNOWN'
      lastLoginAt: string | null
      // Phase 3 — invite-email delivery state (honest: SENT | QUEUED |
      // FAILED | PENDING | NONE).
      invitation?: { state: string; transport?: string; errorClass?: string; at?: string }
    } | null
  }
  // Phase 3 — derived provisioning lifecycle state + the readiness
  // summary that backs it.
  provisioning?: {
    state: string
    readiness: {
      requiredDone: number
      requiredTotal: number
      requiredComplete: boolean
      usable: boolean
    } | null
  }
  domains: Array<{ hostname: string; status: string; isPrimary: boolean }>
  recentActivity: Array<{ id: string; action: string; detail: string | null; at: string }>
  // Honest schema-pending degradation (worklog Tasks 3/4): the hardened
  // schools GET family may flag the pending subscription migration.
  // When THIS response carries the flag, the Subscription group leads
  // with the shared SubscriptionPendingBanner (compact).
  subscriptionSchemaPending?: boolean
}

interface AccessResponse {
  supportSession: { schoolId: string; schoolName: string; reason: string; expiresAt: string }
  supportToken?: string
}

const FLAGGABLE_MODULES = ['exams', 'fees', 'homework', 'library', 'transport'] as const

// Admissions server-issuance control (Batch 1 / WS-C) — the API contract
// of GET/PATCH /api/platform/schools/[id]/admissions-issuance.
interface AdmissionsReadiness {
  academicYear: string | null
  academicYearSet: boolean
  publishedFeeStructures: number
  ready: boolean
}

interface AdmissionsIssuanceState {
  enabled: boolean
  source: 'school' | 'platform' | 'default'
  readiness: AdmissionsReadiness
}

interface AdmissionsIssuancePatchResponse extends AdmissionsIssuanceState {
  ok: true
  previous: boolean
}
const SCHOOL_BOARDS = ['CBSE', 'UP_BOARD', 'ICSE', 'STATE', 'CUSTOM'] as const
const DURATION_OPTIONS = [5, 15, 30, 45, 60] as const

type GateFn = <T>(action: () => Promise<T>) => Promise<T | undefined>

const num = new Intl.NumberFormat('en-IN')

// ── Small local helpers ───────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(ms)) return '—'
  const s = Math.floor(ms / 1000)
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d}d ago`
  return new Date(iso).toLocaleDateString()
}

const STATUS_STYLES: Record<string, string> = {
  ACTIVE: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  SUSPENDED: 'border-red-200 bg-red-50 text-red-600',
  PENDING: 'border-amber-200 bg-amber-50 text-amber-700',
  TRIAL: 'border-slate-200 bg-slate-100 text-slate-600',
}

// Phase 3 — the derived provisioning lifecycle state (the mission's
// PENDING / READY / REQUIRES_ATTENTION vocabulary, adapted to the
// existing status + readiness + invite-delivery facts).
const PROVISIONING_META: Record<
  string,
  { label: string; className: string; hint: string }
> = {
  PENDING_ACTIVATION: {
    label: 'Provisioning complete — awaiting activation',
    className: 'border-amber-200 bg-amber-50 text-amber-700',
    hint: 'The tenant is fully provisioned; sign-in stays blocked until you Activate it (audited action).',
  },
  REQUIRES_ATTENTION: {
    label: 'Needs attention — credential delivery',
    className: 'border-amber-200 bg-amber-50 text-amber-700',
    hint: 'The principal\'s one-time credential has not been delivered (invite email failed or none on record) and has not been replaced yet — confirm delivery or re-issue the credential below.',
  },
  READY: {
    label: 'Ready',
    className: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    hint: 'Active and every required setup section is complete.',
  },
  NEEDS_SETUP: {
    label: 'Usable — setup incomplete',
    className: 'border-sky-200 bg-sky-50 text-sky-700',
    hint: 'The school is active; required onboarding sections are still incomplete (see the Setup tab).',
  },
  SUSPENDED: {
    label: 'Suspended',
    className: 'border-red-200 bg-red-50 text-red-600',
    hint: 'Locked out — sessions revoked and business APIs locked.',
  },
}

function StatusBadge({ status }: { status: string }) {
  return (
    <Badge variant="outline" className={`normal-case ${STATUS_STYLES[status] ?? STATUS_STYLES['TRIAL']}`}>
      {status}
    </Badge>
  )
}

// ── Access card (PHASE 10 — two-project topology truth) ───────────────────

/** Resolve a possibly-relative plane URL to an absolute one (click-time only — window exists). */
function absoluteUrl(url: string): string {
  return url.startsWith('/') ? `${window.location.origin}${url}` : url
}

/** Copy icon button with inline "Copied" feedback (icon swaps to Check for ~1.5s). */
function CopyIconButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={(e) => {
        e.stopPropagation()
        void navigator.clipboard.writeText(absoluteUrl(value)).then(
          () => {
            setCopied(true)
            if (timer.current) clearTimeout(timer.current)
            timer.current = setTimeout(() => setCopied(false), 1500)
          },
          () => {
            /* clipboard unavailable — no success feedback (honest failure) */
          },
        )
      }}
      className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40"
    >
      {copied ? (
        <Check className="h-4 w-4 text-emerald-600" aria-hidden="true" />
      ) : (
        <Copy className="h-4 w-4" aria-hidden="true" />
      )}
    </button>
  )
}

/** One canonical door row: mono URL (truncating) + copy + open-in-new-tab. */
function AccessUrlRow({
  icon,
  label,
  url,
  openLabel,
}: {
  icon: React.ReactNode
  label: string
  url: string
  openLabel: string
}) {
  return (
    <div className="min-w-0 space-y-1.5">
      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
        <span className="text-slate-400" aria-hidden="true">
          {icon}
        </span>
        {label}
      </p>
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        <code
          className="min-w-0 flex-1 truncate rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 font-mono text-xs text-slate-700"
          title={url}
        >
          {url}
        </code>
        <CopyIconButton value={url} label={`Copy ${label.toLowerCase()}`} />
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-100 focus-ring"
        >
          <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          {openLabel}
        </a>
      </div>
    </div>
  )
}

const CREDENTIAL_META: Record<string, { label: string; className: string }> = {
  BOOTSTRAP_PENDING: {
    label: 'First password change pending',
    className: 'border-amber-200 bg-amber-50 text-amber-700',
  },
  OWNED: {
    label: 'Owns password',
    className: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  },
  UNKNOWN: {
    label: 'Credential state unknown',
    className: 'border-slate-200 bg-slate-100 text-slate-600',
  },
}

const INVITE_META: Record<string, { label: string; className: string }> = {
  SENT: { label: 'Invite sent', className: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  QUEUED: { label: 'Invite queued', className: 'border-sky-200 bg-sky-50 text-sky-700' },
  PENDING: { label: 'Invite pending', className: 'border-sky-200 bg-sky-50 text-sky-700' },
  FAILED: { label: 'Invite failed', className: 'border-red-200 bg-red-50 text-red-600' },
  NONE: { label: 'No invite on record', className: 'border-slate-200 bg-slate-100 text-slate-600' },
}

/** The founding principal's access truth: identity, status, credential state, invite delivery, last sign-in. */
function PrincipalAccessBlock({
  principal,
  canManage,
  onReissue,
  reissueBusy,
}: {
  principal: SchoolDetailData['access']['principal']
  canManage: boolean
  onReissue: () => void
  reissueBusy: boolean
}) {
  if (!principal) {
    return (
      <div className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-sm text-amber-800 lg:col-span-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <p>
          <span className="font-semibold">No principal account.</span> This school has no PRINCIPAL user —
          provisioning or support tooling must create the founding account before anyone can administer the
          tenant.
        </p>
      </div>
    )
  }

  const cred = CREDENTIAL_META[principal.credentialState] ?? CREDENTIAL_META.UNKNOWN
  const invite = principal.invitation ? (INVITE_META[principal.invitation.state] ?? INVITE_META.NONE) : null
  const reissuable = principal.credentialState === 'BOOTSTRAP_PENDING'
  return (
    <div className="min-w-0 space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3.5 lg:col-span-2">
      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
        <span className="text-slate-400" aria-hidden="true">
          <User className="h-3.5 w-3.5" />
        </span>
        Founding principal
      </p>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
        <p className="text-sm font-semibold text-slate-900">{principal.name ?? '—'}</p>
        <p className="min-w-0 truncate font-mono text-xs text-slate-600" title={principal.email}>
          {principal.email}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusBadge status={principal.status} />
          <Badge variant="outline" className={`normal-case ${cred.className}`}>
            {cred.label}
          </Badge>
          {invite ? (
            <Badge
              variant="outline"
              className={`normal-case ${invite.className}`}
              title={principal.invitation?.errorClass ?? undefined}
            >
              {invite.label}
            </Badge>
          ) : null}
        </div>
        <p className="text-[11px] text-slate-500" title={principal.lastLoginAt ?? undefined}>
          {principal.lastLoginAt ? `Last sign-in ${timeAgo(principal.lastLoginAt)}` : 'Never signed in'}
        </p>
      </div>
      {principal.credentialState === 'BOOTSTRAP_PENDING' && (
        <p className="text-[11px] leading-snug text-amber-700">
          The bootstrap password is still active — the principal must set their own password at first
          sign-in (server-enforced).
        </p>
      )}
      {/* Phase 3 — credential re-issue: the recovery path for a lost
          one-time password / failed invite delivery. Only offered while
          the bootstrap credential is still PENDING (never against an
          owned credential) and only to schools.manage holders; the
          server re-authorizes both conditions anyway. */}
      {reissuable && canManage ? (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button
            variant="outline"
            size="sm"
            onClick={onReissue}
            disabled={reissueBusy}
            className="h-8 border-amber-300 bg-white text-amber-700 hover:bg-amber-50 focus-ring"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${reissueBusy ? 'animate-spin' : ''}`} aria-hidden="true" />
            {reissueBusy ? 'Re-issuing…' : 'Re-issue one-time credential'}
          </Button>
          <span className="text-[11px] text-slate-500">
            Generates a fresh one-time password (the old one stops working), re-sends the invite email and
            revokes the principal&rsquo;s live sessions. Audited.
          </span>
        </div>
      ) : null}
    </div>
  )
}

/** The Access card: canonical doors + principal credential truth + domain status summary. */
function AccessCard({
  access,
  domains,
  canManage,
  onReissue,
  reissueBusy,
}: {
  access: SchoolDetailData['access']
  domains: SchoolDetailData['domains']
  canManage: boolean
  onReissue: () => void
  reissueBusy: boolean
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 px-4 py-3.5 sm:px-5">
        <h2 className="font-display text-sm font-bold text-slate-900">Access</h2>
        <p className="mt-0.5 text-xs text-slate-500">
          The canonical doors this tenant is reached through — copied links always resolve to an absolute
          address.
        </p>
      </div>
      <div className="grid gap-4 p-4 sm:px-5 lg:grid-cols-2 lg:gap-x-6">
        <AccessUrlRow
          icon={<LogIn className="h-3.5 w-3.5" />}
          label="School login URL"
          url={access.loginUrl}
          openLabel="Open School"
        />
        <AccessUrlRow
          icon={<Globe className="h-3.5 w-3.5" />}
          label="Public URL"
          url={access.publicUrl}
          openLabel="Open website"
        />
        <PrincipalAccessBlock
          principal={access.principal}
          canManage={canManage}
          onReissue={onReissue}
          reissueBusy={reissueBusy}
        />
      </div>
      {/* Tenant-domain status summary — the Domains tab remains the
          management surface (verify / add / remove); this is the
          at-a-glance truth from the school dossier. */}
      <div className="border-t border-slate-200 px-4 py-3.5 sm:px-5">
        <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
          <span className="text-slate-400" aria-hidden="true">
            <Globe className="h-3.5 w-3.5" />
          </span>
          Custom domains
        </p>
        {domains.length > 0 ? (
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {domains.map((d) => (
              <li
                key={d.hostname}
                className="flex min-w-0 flex-wrap items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5"
              >
                <span className="min-w-0 truncate font-mono text-xs text-slate-700" title={d.hostname}>
                  {d.hostname}
                </span>
                {d.isPrimary && (
                  <Badge variant="outline" className="border-teal-200 bg-teal-50 text-teal-700 normal-case">
                    primary
                  </Badge>
                )}
                <Badge
                  variant="outline"
                  className={`normal-case ${
                    d.status === 'VERIFIED'
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                      : d.status === 'PENDING'
                        ? 'border-amber-200 bg-amber-50 text-amber-700'
                        : 'border-slate-200 bg-slate-100 text-slate-600'
                  }`}
                >
                  {d.status}
                </Badge>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1.5 text-xs text-slate-500">
            No custom domains mapped — the doors above are this tenant&apos;s addresses.
          </p>
        )}
      </div>
    </div>
  )
}

// ── Access School (support session) dialog ────────────────────────────────

function AccessDialog({
  open,
  onOpenChange,
  schoolId,
  schoolName,
  gate,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  schoolId: string
  schoolName: string
  gate: GateFn
}) {
  const router = useRouter()
  const [reason, setReason] = useState('')
  const [duration, setDuration] = useState<string>('15')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setReason('')
      setDuration('15')
      setError(null)
    }
  }, [open])

  const submit = async () => {
    if (reason.trim().length < 10) {
      setError('A reason of at least 10 characters is required — the school can see it')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await gate(() =>
        platformApi<AccessResponse>(`/api/platform/schools/${schoolId}/access`, {
          method: 'POST',
          body: JSON.stringify({ reason: reason.trim(), durationMinutes: Number(duration) }),
        }),
      )
      if (!res) return // cancelled at the step-up prompt
      if (res.supportToken) saveSupportToken(res.supportToken)
      toast.success('Support session opened')
      onOpenChange(false)
      router.push('/platform/support/view')
    } catch (e) {
      const err = e as PlatformApiError
      setError(err.error || 'Could not open the support session')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-white border-slate-200 text-slate-900 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-display text-slate-900">
            <LifeBuoy className="h-4 w-4 text-amber-600" aria-hidden="true" />
            Open Support Session — {schoolName} (read-only)
          </DialogTitle>
          <DialogDescription className="text-slate-500">
            Opens a time-boxed, audited oversight session. No school identity is assumed and no school data
            can be modified — the school sees a record of this visit.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div role="alert" className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-600">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {error}
          </div>
        )}

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="access-reason" className="text-xs font-semibold text-slate-700">
              Reason (required, visible to the school) *
            </Label>
            <Textarea
              id="access-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Principal reported fee ledger mismatch after the February gateway batch…"
              rows={3}
              maxLength={400}
              className="bg-white border-slate-200 text-slate-900 placeholder:text-slate-400 focus-visible:ring-teal-500/40 min-h-[88px]"
            />
            <p className="text-[10px] text-slate-400 tabular-nums">{reason.trim().length}/400 · minimum 10</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="access-duration" className="text-xs font-semibold text-slate-700">
              Duration
            </Label>
            <Select value={duration} onValueChange={setDuration}>
              <SelectTrigger
                id="access-duration"
                className="h-11 w-full bg-white border-slate-200 text-slate-900 focus-visible:ring-teal-500/40"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-white border-slate-200 text-slate-900">
                {DURATION_OPTIONS.map((m) => (
                  <SelectItem key={m} value={String(m)} className="focus:bg-slate-100">
                    {m} minutes
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[10px] text-slate-400">Capped by the platform&apos;s maximum support duration</p>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="h-11 border-slate-300 bg-transparent text-slate-700 hover:bg-slate-100 focus-ring"
          >
            Cancel
          </Button>
          <Button
            onClick={() => void submit()}
            disabled={busy}
            className="h-11 bg-amber-500 hover:bg-amber-600 text-slate-900 font-semibold focus-ring"
          >
            {busy ? 'Opening…' : 'Open support session'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Suspend dialog (required reason ≥ 10 chars) ──────────────────────────

function SuspendDialog({
  open,
  onOpenChange,
  schoolId,
  schoolName,
  gate,
  onSuspended,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  schoolId: string
  schoolName: string
  gate: GateFn
  onSuspended: () => void
}) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setReason('')
      setError(null)
    }
  }, [open])

  const submit = async () => {
    if (reason.trim().length < 10) {
      setError('A reason of at least 10 characters is required — it goes into the platform audit trail')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await gate(() =>
        platformApi<{ ok: true; status: string; revokedSessions: number }>(
          `/api/platform/schools/${schoolId}/suspend`,
          { method: 'POST', body: JSON.stringify({ reason: reason.trim() }) },
        ),
      )
      if (!res) return
      toast.success(
        `School suspended — ${res.revokedSessions} live session${res.revokedSessions === 1 ? '' : 's'} revoked`,
      )
      onOpenChange(false)
      onSuspended()
    } catch (e) {
      const err = e as PlatformApiError
      setError(err.error || 'Suspension failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-white border-slate-200 text-slate-900 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-display text-slate-900">
            <Ban className="h-4 w-4 text-red-600" aria-hidden="true" />
            Suspend {schoolName}
          </DialogTitle>
          <DialogDescription className="text-slate-500">
            Every user of this school is signed out immediately. Sign-in stays available, but the workspace remains locked
            (business modules disabled) until it is explicitly reactivated. This action requires step-up verification and
            is audited with your reason.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div role="alert" className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-600">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {error}
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="suspend-reason" className="text-xs font-semibold text-slate-700">
            Reason (required) *
          </Label>
          <Textarea
            id="suspend-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Repeated fee reconciliation failures pending the Q1 audit review…"
            rows={3}
            maxLength={400}
            className="bg-white border-slate-200 text-slate-900 placeholder:text-slate-400 focus-visible:ring-red-500/40 min-h-[88px]"
          />
          <p className="text-[10px] text-slate-400 tabular-nums">{reason.trim().length}/400 · minimum 10</p>
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="h-11 border-slate-300 bg-transparent text-slate-700 hover:bg-slate-100 focus-ring"
          >
            Cancel
          </Button>
          <Button
            onClick={() => void submit()}
            disabled={busy}
            className="h-11 bg-red-600 hover:bg-red-500 text-white font-semibold focus-ring"
          >
            {busy ? 'Suspending…' : 'Suspend school'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Metadata form type + helpers ──────────────────────────────────────────

interface MetaForm {
  name: string
  domain: string
  address: string
  city: string
  phone: string
  email: string
  board: string
  academicYear: string
  themeColor: string
  accentColor: string
}

function metaFromSchool(s: SchoolRecord): MetaForm {
  return {
    name: s.name,
    domain: s.domain ?? '',
    address: s.address ?? '',
    city: s.city ?? '',
    phone: s.phone ?? '',
    email: s.email ?? '',
    board: s.board,
    academicYear: s.academicYear ?? '',
    themeColor: s.themeColor,
    accentColor: s.accentColor,
  }
}

/** Only genuinely changed fields are PATCHed (server audits field-by-field). */
function diffMeta(form: MetaForm, school: SchoolRecord): Partial<MetaForm> {
  const out: Partial<MetaForm> = {}
  if (form.name.trim() !== school.name) out.name = form.name.trim()
  if (form.domain.trim() !== (school.domain ?? '')) out.domain = form.domain.trim()
  if (form.address.trim() !== (school.address ?? '')) out.address = form.address.trim()
  if (form.city.trim() !== (school.city ?? '')) out.city = form.city.trim()
  if (form.phone.trim() !== (school.phone ?? '')) out.phone = form.phone.trim()
  if (form.email.trim() !== (school.email ?? '')) out.email = form.email.trim()
  if (form.board !== school.board) out.board = form.board
  if (form.academicYear.trim() !== (school.academicYear ?? '')) out.academicYear = form.academicYear.trim()
  if (form.themeColor !== school.themeColor) out.themeColor = form.themeColor
  if (form.accentColor !== school.accentColor) out.accentColor = form.accentColor
  return out
}

function ColorField({
  id,
  label,
  value,
  onChange,
}: {
  id: string
  label: string
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label htmlFor={id} className="text-xs font-semibold text-slate-700">
          {label}
        </Label>
        <span className="font-mono text-[10px] text-slate-500">{value}</span>
      </div>
      <div className="flex items-center gap-2">
        <input
          id={id}
          type="color"
          value={/^#[0-9A-Fa-f]{6}$/.test(value) ? value : '#000000'}
          onChange={(e) => onChange(e.target.value)}
          aria-label={`${label} color picker`}
          className="h-11 w-14 shrink-0 cursor-pointer rounded-xl border border-slate-200 bg-white p-1 focus-ring"
        />
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="#0f766e"
          aria-label={`${label} hex value`}
          className="h-11 flex-1 bg-white border-slate-200 text-slate-900 font-mono focus-visible:ring-teal-500/40"
        />
      </div>
    </div>
  )
}

// ── Stat card ─────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  icon,
  tone,
}: {
  label: string
  value: string | number
  icon: React.ReactNode
  tone?: 'default' | 'amber'
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 flex-1 truncate text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">{label}</p>
        <span
          className={`flex h-7 w-7 items-center justify-center rounded-lg ${
            tone === 'amber' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500'
          }`}
          aria-hidden="true"
        >
          {icon}
        </span>
      </div>
      <p className="mt-2 font-display text-2xl font-bold text-slate-900 tabular-nums">{value}</p>
    </div>
  )
}

// ── Module ────────────────────────────────────────────────────────────────

// ── §7 operator groups + legacy tab redirect map ───────────────────────────
// The 12-tab IA consolidated into 6 operator groups. LEGACY_TAB_REDIRECT
// keeps every pre-§7 deep link alive: bookmarks and shared URLs carrying
// an old ?tab= value, plus the child modules' own cross-tab calls
// (school-subscription → 'gateway'; school-setup → 'metadata' | 'users' |
// 'identity' | 'plan' | 'domains'). Each entry resolves to its §7 group
// plus the sub-section anchor to land on.

interface TabTarget {
  group: string
  anchor?: string
}

const SUBSECTION_IDS = {
  setup: 'section-setup',
  metadata: 'section-metadata',
  identity: 'section-identity',
  modules: 'section-modules',
  domains: 'section-domains',
  access: 'section-access',
  users: 'section-users',
  subscription: 'section-subscription',
  gateway: 'section-gateway',
  support: 'section-support',
  audit: 'section-audit',
  danger: 'section-danger',
} as const

// Old 12-tab keys → { group, anchor }. The three genuinely-new group
// keys ('configuration', 'access', 'advanced') resolve to themselves;
// 'overview', 'subscription' and 'support' already existed and map to
// themselves (no anchor — they land at the group top).
const LEGACY_TAB_REDIRECT: Record<string, TabTarget> = {
  overview: { group: 'overview' },
  setup: { group: 'configuration', anchor: SUBSECTION_IDS.setup },
  metadata: { group: 'configuration', anchor: SUBSECTION_IDS.metadata },
  identity: { group: 'configuration', anchor: SUBSECTION_IDS.identity },
  plan: { group: 'configuration', anchor: SUBSECTION_IDS.modules },
  domains: { group: 'configuration', anchor: SUBSECTION_IDS.domains },
  users: { group: 'access', anchor: SUBSECTION_IDS.users },
  subscription: { group: 'subscription' },
  gateway: { group: 'subscription', anchor: SUBSECTION_IDS.gateway },
  support: { group: 'support', anchor: SUBSECTION_IDS.support },
  audit: { group: 'support', anchor: SUBSECTION_IDS.audit },
  danger: { group: 'advanced', anchor: SUBSECTION_IDS.danger },
  configuration: { group: 'configuration' },
  access: { group: 'access' },
  advanced: { group: 'advanced' },
}

/** Resolve any ?tab= / onNavigateTab value — a legacy 12-tab key or a
 * §7 group key. Unknown values return null (callers fail safe to
 * Overview, exactly as the pre-§7 workspace did). */
function resolveTabValue(raw: string | null): TabTarget | null {
  if (!raw) return null
  return LEGACY_TAB_REDIRECT[raw] ?? null
}

/** A titled sub-section inside a merged group (§7: section headings +
 * whitespace — never tab-in-tab). The `id` doubles as the deep-link
 * anchor for legacy ?tab= values that pointed at this section. */
function GroupSection({
  id,
  title,
  description,
  children,
}: {
  id: string
  title: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className="scroll-mt-24">
      <div className="border-b border-slate-200 pb-2">
        <h3 id={`${id}-heading`} className="font-display text-sm font-bold text-slate-900">
          {title}
        </h3>
        {description ? <p className="mt-0.5 text-xs text-slate-500">{description}</p> : null}
      </div>
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  )
}

/** Overview → next actions (§7): the derived provisioning lifecycle
 * drives a short list of deep-links into the group that can act — the
 * actions themselves keep their single home (Advanced, Access & users,
 * Configuration); this card only routes the operator there. */
function NextActionsCard({
  provisioning,
  canManage,
  onNavigate,
}: {
  provisioning: SchoolDetailData['provisioning']
  canManage: boolean
  onNavigate: (tab: string) => void
}) {
  // No provisioning facts → render nothing (never fabricate an
  // all-clear state the API did not assert).
  if (!provisioning) return null

  const state = provisioning.state
  const actions: Array<{
    key: string
    label: string
    detail: string
    tab: string
    icon: React.ReactNode
    iconClass: string
  }> = []

  if (state === 'PENDING_ACTIVATION' && canManage) {
    actions.push({
      key: 'activate',
      label: 'Activate this school',
      detail: 'Provisioning is complete — sign-in stays blocked until activation (Advanced).',
      tab: 'advanced',
      icon: <Power className="h-4 w-4" aria-hidden="true" />,
      iconClass: 'bg-teal-50 text-teal-700',
    })
  }
  if (state === 'SUSPENDED' && canManage) {
    actions.push({
      key: 'reactivate',
      label: 'Reactivate this school',
      detail: 'The workspace stays locked for every user until reactivation (Advanced).',
      tab: 'advanced',
      icon: <Power className="h-4 w-4" aria-hidden="true" />,
      iconClass: 'bg-teal-50 text-teal-700',
    })
  }
  if (state === 'REQUIRES_ATTENTION') {
    actions.push({
      key: 'credential',
      label: 'Confirm the principal credential',
      detail: 'The one-time credential was not delivered or replaced — re-issue it from Access & users.',
      tab: 'access',
      icon: <User className="h-4 w-4" aria-hidden="true" />,
      iconClass: 'bg-amber-50 text-amber-700',
    })
  }
  if (state === 'NEEDS_SETUP') {
    actions.push({
      key: 'setup',
      label: 'Complete the required setup',
      detail: 'Required onboarding sections are incomplete (Configuration → Setup & readiness).',
      tab: 'setup',
      icon: <ClipboardList className="h-4 w-4" aria-hidden="true" />,
      iconClass: 'bg-amber-50 text-amber-700',
    })
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 px-4 py-3.5 sm:px-5">
        <h2 className="font-display text-sm font-bold text-slate-900">Next actions</h2>
        <p className="mt-0.5 text-xs text-slate-500">
          Derived from status, setup readiness and credential delivery — each link routes to the section
          that can act.
        </p>
      </div>
      {actions.length > 0 ? (
        <ul className="divide-y divide-slate-200">
          {actions.map((a) => (
            <li key={a.key} className="px-2 py-1.5 sm:px-3">
              <button
                type="button"
                onClick={() => onNavigate(a.tab)}
                aria-label={`Go to the section that can act on: ${a.label}`}
                className="flex min-h-[56px] w-full items-center gap-3 rounded-lg px-2 text-left transition-colors hover:bg-slate-50 focus:outline-none focus-visible:bg-slate-100 focus-visible:ring-2 focus-visible:ring-teal-500/40"
              >
                <span
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${a.iconClass}`}
                  aria-hidden="true"
                >
                  {a.icon}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-slate-900">{a.label}</span>
                  <span className="mt-0.5 block text-xs leading-snug text-slate-500">{a.detail}</span>
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="flex items-center gap-2.5 px-4 py-4 sm:px-5">
          <Check className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
          <p className="text-sm text-slate-600">
            Nothing pending — this school is ready, delivered and fully set up.
          </p>
        </div>
      )}
    </div>
  )
}

/** Access & users → live session truth: school-side sign-ins and the
 * platform's open read-only oversight sessions, side by side. */
function SessionsCard({
  activeSchoolSessions,
  activeSupportSessions,
}: {
  activeSchoolSessions: number
  activeSupportSessions: number
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 px-4 py-3.5 sm:px-5">
        <h2 className="font-display text-sm font-bold text-slate-900">Live sessions</h2>
        <p className="mt-0.5 text-xs text-slate-500">
          Sign-ins into this tenant and open platform oversight sessions, right now.
        </p>
      </div>
      <dl className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2 sm:px-5">
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5">
          <dt className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            <MonitorSmartphone className="h-3.5 w-3.5" aria-hidden="true" />
            School sessions
          </dt>
          <dd className="mt-1.5 font-display text-2xl font-bold text-slate-900 tabular-nums">
            {num.format(activeSchoolSessions)}
          </dd>
          <p className="mt-1 text-xs text-slate-500">
            Users currently signed in — suspending the school revokes all of them.
          </p>
        </div>
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3.5">
          <dt className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-amber-700">
            <LifeBuoy className="h-3.5 w-3.5" aria-hidden="true" />
            Support sessions
          </dt>
          <dd className="mt-1.5 font-display text-2xl font-bold text-amber-800 tabular-nums">
            {num.format(activeSupportSessions)}
          </dd>
          <p className="mt-1 text-xs text-amber-700">
            Read-only oversight sessions platform staff hold — the school can see every one.
          </p>
        </div>
      </dl>
    </div>
  )
}

export function SchoolDetailModule() {
  const { can } = usePlatformSession()
  // Permission constants (stable across the render; the server
  // re-authorizes every action regardless of what the UI shows).
  const canManage = can('schools.manage')
  const canBill = can('billing.manage')
  const canSupport = can('support.access')
  const canAudit = can('audit.read')
  const router = useRouter()
  const params = useParams()
  const rawId: unknown = params.id
  const id =
    typeof rawId === 'string'
      ? rawId
      : Array.isArray(rawId) && typeof rawId[0] === 'string'
        ? rawId[0]
        : undefined
  const { gate, node: stepUpNode } = useStepUpGate()
  const searchParams = useSearchParams()

  // ── §7 operator groups + legacy deep-link compatibility (mission §3B
  // preserved): ?tab=<group> is the single source of truth for the
  // active workspace section — navigation, refresh and browser
  // back/forward all keep it. The 6 group keys are canonical; every
  // pre-§7 12-tab key still resolves through LEGACY_TAB_REDIRECT
  // (bookmarks, shared URLs, and the child modules' own deep-links —
  // school-subscription → 'gateway', school-setup → 'metadata' /
  // 'users' / 'identity' / 'plan' / 'domains'). Unknown or
  // permission-withheld values fall back to Overview (fail-safe, the
  // server still authorizes every route). ──
  const availableGroups = React.useMemo(() => {
    const groups = ['overview', 'configuration', 'access']
    if (canBill) groups.push('subscription')
    if (canSupport || canAudit) groups.push('support')
    if (canManage) groups.push('advanced')
    return groups
  }, [canManage, canBill, canSupport, canAudit])

  const urlTab = searchParams.get('tab')
  const [activeGroup, setActiveGroup] = useState<string>(() => {
    if (!urlTab) return 'overview'
    const resolved = resolveTabValue(urlTab)
    return resolved && availableGroups.includes(resolved.group) ? resolved.group : 'overview'
  })
  // Legacy deep-links may land on a specific sub-section (e.g.
  // ?tab=domains → Configuration → Custom domains); the anchor is
  // resolved after the target group's content has mounted.
  const [pendingAnchor, setPendingAnchor] = useState<string | null>(null)
  // The last canonical tab key THIS component wrote to the URL. Lets
  // the URL→state effect below distinguish its own writes
  // (navigateToTab / legacy-URL normalization) from real external
  // navigation (initial load, refresh, back/forward) — otherwise the
  // searchParams echo of our own push/replace would clobber a pending
  // sub-section anchor before the scroll lands.
  const lastWrittenTab = useRef<string | null>(null)

  // §7 tab bar — after a plain group switch the operator must land back
  // at the TOP of the new tab content. Keeping the previous scroll
  // position leaves the tab bar hidden under the sticky console header
  // (h-16, z-30) — the row becomes unclickable until the user scrolls
  // manually (reproduced: clicking "Advanced" while scrolled into the
  // Support & audit content hit the header instead). scroll-mt-20 on the
  // TabsList makes scrollIntoView account for that header.
  const tabsBarRef = useRef<HTMLDivElement | null>(null)

  // URL → state (initial load, refresh, browser back/forward). A
  // legacy ?tab= value selects its mapped group AND normalizes the
  // URL to the canonical §7 group key (replace — no history entry),
  // so old links heal into the new keys over time.
  useEffect(() => {
    const raw = searchParams.get('tab')
    // Echo of our own write — state (and any pending anchor) is
    // already correct.
    if (raw && raw === lastWrittenTab.current) return
    const resolved = raw ? resolveTabValue(raw) : null
    setActiveGroup(resolved && availableGroups.includes(resolved.group) ? resolved.group : 'overview')
    setPendingAnchor(resolved?.anchor ?? null)
    if (raw && resolved && raw !== resolved.group) {
      const next = new URLSearchParams(searchParams.toString())
      next.set('tab', resolved.group)
      lastWrittenTab.current = resolved.group
      router.replace(`?${next.toString()}`, { scroll: false })
    }
  }, [searchParams, availableGroups, router])

  // Sub-section anchor: once the target group's content has mounted,
  // bring the requested section into view (§7 — headings + anchors,
  // never tab-in-tab). The content may mount late (a legacy deep link
  // lands while the dossier is still loading), so the lookup retries
  // briefly instead of giving up on the first frame.
  useEffect(() => {
    if (!pendingAnchor) return
    let attempts = 0
    let timer: number | undefined
    const tryScroll = () => {
      const el = document.getElementById(pendingAnchor)
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' })
        setPendingAnchor(null)
        return
      }
      if (++attempts < 40) {
        timer = window.setTimeout(tryScroll, 100)
      } else {
        // Section not rendered within ~4s (permission-withheld
        // sub-section) — the group selection still applied; drop the
        // anchor quietly.
        setPendingAnchor(null)
      }
    }
    timer = window.setTimeout(tryScroll, 90)
    return () => {
      if (timer) window.clearTimeout(timer)
    }
  }, [pendingAnchor, activeGroup])

  const navigateToTab = useCallback(
    (tab: string) => {
      // Accepts BOTH a §7 group key and any legacy 12-tab key — the
      // child modules still call this with their old keys
      // (school-subscription → 'gateway', school-setup → 'metadata').
      const resolved = resolveTabValue(tab)
      if (!resolved || !availableGroups.includes(resolved.group)) return
      setActiveGroup(resolved.group)
      setPendingAnchor(resolved.anchor ?? null)
      lastWrittenTab.current = resolved.group
      const next = new URLSearchParams(searchParams.toString())
      if (resolved.group === 'overview') next.delete('tab')
      else next.set('tab', resolved.group)
      const qs = next.toString()
      router.push(qs ? `?${qs}` : '?', { scroll: false })
      // Plain group switch (no sub-section anchor): bring the operator
      // back to the tab bar — the top of the newly-mounted content.
      if (!resolved.anchor) {
        window.setTimeout(() => {
          tabsBarRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        }, 60)
      }
    },
    [router, searchParams, availableGroups],
  )

  const [data, setData] = useState<SchoolDetailData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notFound, setNotFound] = useState(false)

  const [accessOpen, setAccessOpen] = useState(false)
  const [suspendOpen, setSuspendOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteTyped, setDeleteTyped] = useState('')
  const [deleteBusy, setDeleteBusy] = useState(false)

  const [meta, setMeta] = useState<MetaForm | null>(null)
  const [metaBusy, setMetaBusy] = useState(false)
  const [metaSavedFields, setMetaSavedFields] = useState<string[] | null>(null)

  const [flags, setFlags] = useState<Record<string, boolean>>({})
  const [flagBusy, setFlagBusy] = useState<string | null>(null)

  const [admissions, setAdmissions] = useState<AdmissionsIssuanceState | null>(null)
  const [admissionsBusy, setAdmissionsBusy] = useState(false)
  const [admissionsConfirmNext, setAdmissionsConfirmNext] = useState(false)

  const [statusBusy, setStatusBusy] = useState<string | null>(null)

  // Phase 3 — credential re-issue flow state: confirmation dialog +
  // the one-time result (new tempPassword shown EXACTLY once).
  const [reissueOpen, setReissueOpen] = useState(false)
  const [reissueBusy, setReissueBusy] = useState(false)
  const [reissueResult, setReissueResult] = useState<{
    tempPassword: string
    revokedSessions: number
    invitation?: { state: string; errorClass?: string }
    principalEmail: string
  } | null>(null)

  const reload = useCallback(async () => {
    if (!id) return
    setLoading(true)
    setError(null)
    setNotFound(false)
    try {
      setData(await platformApi<SchoolDetailData>(`/api/platform/schools/${id}`))
    } catch (e) {
      const err = e as PlatformApiError
      if (err.code === 'RESOURCE_NOT_FOUND') {
        setNotFound(true)
      } else {
        setError(err.error || 'Failed to load the school')
      }
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    void reload()
  }, [reload])

  // Admissions-issuance control state (fails soft to null — the toggle
  // remains usable; the readiness panel shows "unavailable").
  const reloadAdmissions = useCallback(async () => {
    if (!id) return
    try {
      setAdmissions(
        await platformApi<AdmissionsIssuanceState>(
          `/api/platform/schools/${id}/admissions-issuance`,
        ),
      )
    } catch {
      setAdmissions(null)
    }
  }, [id])

  useEffect(() => {
    void reloadAdmissions()
  }, [reloadAdmissions])

  // Sync local editors whenever fresh data lands.
  useEffect(() => {
    if (data) {
      setMeta(metaFromSchool(data.school))
      setFlags(data.school.featureFlags)
    }
  }, [data])

  const school = data?.school

  // Metadata diff — drives the save button + changed-fields feedback.
  const metaDiff = useMemo(
    () => (meta && school ? diffMeta(meta, school) : {}),
    [meta, school],
  )
  const metaChangedKeys = Object.keys(metaDiff)

  const setMetaField = <K extends keyof MetaForm>(key: K, value: string) =>
    setMeta((m) => (m ? { ...m, [key]: value } : m))

  const saveMeta = async () => {
    if (!id || !school || metaChangedKeys.length === 0) return
    setMetaBusy(true)
    try {
      const res = await platformApi<{ ok: true; updatedFields: string[] }>(
        `/api/platform/schools/${id}`,
        { method: 'PATCH', body: JSON.stringify(metaDiff) },
      )
      toast.success(
        res.updatedFields.length > 0
          ? `School updated — ${res.updatedFields.join(', ')}`
          : 'School saved — no effective changes',
      )
      setMetaSavedFields(res.updatedFields)
      await reload()
    } catch (e) {
      const err = e as PlatformApiError
      toast.error(err.error || 'Could not save the metadata')
    } finally {
      setMetaBusy(false)
    }
  }

  // Phase 3 — credential re-issue (step-up-gated on the server; the
  // gate wrapper handles the MFA prompt when step-up is armed). The
  // new one-time password is shown EXACTLY once in the result dialog.
  const reissueCredential = async () => {
    if (!id) return
    setReissueBusy(true)
    try {
      const res = await gate(() =>
        platformApi<{
          tempPassword: string
          revokedSessions: number
          invitation?: { state: string; errorClass?: string }
          principal: { email: string }
        }>(`/api/platform/schools/${id}/reissue-credential`, { method: 'POST' }),
      )
      if (!res) return // cancelled at the step-up prompt
      setReissueResult({
        tempPassword: res.tempPassword,
        revokedSessions: res.revokedSessions,
        invitation: res.invitation,
        principalEmail: res.principal.email,
      })
      toast.success('One-time credential re-issued — shown once in the dialog')
      await reload()
    } catch (e) {
      const err = e as PlatformApiError
      toast.error(err.error || 'Credential re-issue failed')
    } finally {
      setReissueBusy(false)
    }
  }

  const toggleFlag = async (module: string, label: string, next: boolean) => {
    if (!id || !school) return
    const previous = flags
    setFlags((f) => ({ ...f, [module]: next }))
    setFlagBusy(module)
    try {
      const res = await platformApi<{ ok: true; featureFlags: Record<string, boolean> }>(
        `/api/platform/schools/${id}/feature-flags`,
        { method: 'PATCH', body: JSON.stringify({ [module]: next }) },
      )
      setFlags(res.featureFlags)
      setData((d) => (d ? { ...d, school: { ...d.school, featureFlags: res.featureFlags } } : d))
      toast.success(`${label} ${next ? 'enabled' : 'disabled'} for this school`)
    } catch (e) {
      setFlags(previous)
      const err = e as PlatformApiError
      toast.error(err.error || 'Could not update the module flag')
    } finally {
      setFlagBusy(null)
    }
  }

  const toggleAdmissions = (next: boolean) => {
    // Enabling an UNREADY school asks for explicit confirmation — the
    // operator must see the workflow will fail closed until configured.
    if (next && admissions && !admissions.readiness.ready) {
      setAdmissionsConfirmNext(true)
      return
    }
    void applyAdmissionsIssuance(next)
  }

  const applyAdmissionsIssuance = async (next: boolean) => {
    if (!id) return
    setAdmissionsBusy(true)
    try {
      const res = await gate(() =>
        platformApi<AdmissionsIssuancePatchResponse>(
          `/api/platform/schools/${id}/admissions-issuance`,
          { method: 'PATCH', body: JSON.stringify({ enabled: next }) },
        ),
      )
      if (!res) return // cancelled at the step-up prompt
      setAdmissions({ enabled: res.enabled, source: res.source, readiness: res.readiness })
      toast.success(`Server-issued admissions ${next ? 'enabled' : 'disabled'} for this school`)
    } catch (e) {
      const err = e as PlatformApiError
      toast.error(err.error || 'Could not update the admissions flag')
    } finally {
      setAdmissionsBusy(false)
    }
  }

  const runStatusAction = async (action: 'activate' | 'reactivate') => {
    if (!id) return
    setStatusBusy(action)
    try {
      await platformApi(`/api/platform/schools/${id}/${action}`, { method: 'POST' })
      toast.success(action === 'activate' ? 'School activated — users can now sign in' : 'School reactivated — service restored')
      await reload()
    } catch (e) {
      const err = e as PlatformApiError
      toast.error(err.error || 'The status change failed')
    } finally {
      setStatusBusy(null)
    }
  }

  const deleteSchool = async () => {
    if (!id || !school || deleteTyped.trim() !== school.name) return
    setDeleteBusy(true)
    try {
      const res = await gate(() =>
        platformApi(`/api/platform/schools/${id}?confirmName=${encodeURIComponent(deleteTyped.trim())}`, {
          method: 'DELETE',
        }),
      )
      if (!res) {
        setDeleteBusy(false) // cancelled at the step-up prompt
        return
      }
      toast.success(`School ${school.name} deleted`)
      router.push('/platform/schools')
    } catch (e) {
      const err = e as PlatformApiError
      toast.error(err.error || 'Deletion failed')
      setDeleteBusy(false)
    }
  }

  // ── Guards & early states ─────────────────────────────────────────────

  if (!id) {
    return (
      <section className="rounded-xl border border-slate-200 bg-white shadow-sm p-8 text-center">
        <p className="text-sm font-semibold text-slate-900">No school selected</p>
        <Link
          href="/platform/schools"
          className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-teal-600 hover:text-teal-700 focus-ring rounded"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to schools
        </Link>
      </section>
    )
  }

  if (loading && !data) {
    return (
      <section className="space-y-4 sm:space-y-5" aria-busy="true">
        <Skeleton className="h-8 w-64 bg-slate-200" />
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-slate-200 bg-white shadow-sm p-4">
              <Skeleton className="h-3 w-20 bg-slate-200" />
              <Skeleton className="mt-3 h-7 w-12 bg-slate-200" />
            </div>
          ))}
        </div>
        <Skeleton className="h-64 w-full bg-slate-100" />
      </section>
    )
  }

  if (notFound) {
    return (
      <section className="flex flex-col items-center justify-center rounded-xl border border-slate-200 bg-white shadow-sm px-4 py-16 text-center">
        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-slate-500 ring-1 ring-slate-200">
          <ShieldAlert className="h-5 w-5" aria-hidden="true" />
        </div>
        <h1 className="mt-3 font-display text-lg font-bold text-slate-900">School not found</h1>
        <p className="mt-1 max-w-sm text-sm text-slate-500">
          This tenant does not exist (or was deleted). Platform audit entries survive deletions by design.
        </p>
        <Button asChild size="sm" className="mt-5 h-10 bg-teal-600 hover:bg-teal-700 text-white font-semibold focus-ring">
          <Link href="/platform/schools">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back to schools
          </Link>
        </Button>
      </section>
    )
  }

  if (error && !data) {
    return (
      <section
        role="alert"
        className="flex flex-col gap-3 rounded-xl border border-red-200 bg-red-50 p-5 sm:flex-row sm:items-center sm:justify-between"
      >
        <p className="flex items-start gap-2.5 text-sm text-red-600">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          {error}
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void reload()}
          className="h-9 border-slate-300 bg-transparent text-slate-700 hover:bg-slate-100 focus-ring"
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          Retry
        </Button>
      </section>
    )
  }

  if (!school || !data) return null

  // Honest schema-pending signal (worklog Tasks 3/4): when the
  // workspace's own dossier response carries subscriptionSchemaPending,
  // the Subscription group leads with the shared banner. (The child
  // school-subscription module owns its own load-error state with a
  // retry — no error boundary is needed on top of it.)
  const subscriptionPending = isSubscriptionSchemaPending(data)

  const profile: Array<{ icon: React.ReactNode; label: string; value: string }> = [
    { icon: <Globe className="h-3.5 w-3.5" />, label: 'Domain', value: school.domain ?? '—' },
    { icon: <MapPin className="h-3.5 w-3.5" />, label: 'City', value: school.city ?? '—' },
    { icon: <Info className="h-3.5 w-3.5" />, label: 'Board', value: school.board },
    { icon: <ClipboardList className="h-3.5 w-3.5" />, label: 'Plan', value: school.plan },
    { icon: <CalendarDays className="h-3.5 w-3.5" />, label: 'Academic year', value: school.academicYear ?? '—' },
    { icon: <History className="h-3.5 w-3.5" />, label: 'Created', value: new Date(school.createdAt).toLocaleString() },
    { icon: <History className="h-3.5 w-3.5" />, label: 'Updated', value: new Date(school.updatedAt).toLocaleString() },
    {
      icon: <Power className="h-3.5 w-3.5" />,
      label: 'Demo tenant',
      value: school.isDemo ? 'Yes — demo data' : 'No',
    },
  ]

  const stats = [
    { label: 'Users', value: num.format(data.counts.users), icon: <Users className="h-4 w-4" /> },
    { label: 'Students', value: num.format(data.counts.students), icon: <GraduationCap className="h-4 w-4" /> },
    { label: 'Teachers', value: num.format(data.counts.teachers), icon: <BookOpen className="h-4 w-4" /> },
    { label: 'Classes', value: num.format(data.counts.classes), icon: <LayoutGrid className="h-4 w-4" /> },
    { label: 'Exams', value: num.format(data.counts.exams), icon: <ClipboardList className="h-4 w-4" /> },
    { label: 'Fees', value: num.format(data.counts.fees), icon: <IndianRupee className="h-4 w-4" /> },
    {
      label: 'School sessions',
      value: num.format(data.activeSchoolSessions),
      icon: <MonitorSmartphone className="h-4 w-4" />,
    },
    {
      label: 'Support sessions',
      value: num.format(data.activeSupportSessions),
      icon: <LifeBuoy className="h-4 w-4" />,
      tone: 'amber' as const,
    },
  ]

  return (
    <section aria-labelledby="school-heading" className="space-y-4 sm:space-y-5">
      {/* Header */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <Link
            href="/platform/schools"
            className="inline-flex items-center gap-1.5 rounded text-xs font-semibold text-slate-600 hover:text-teal-700 focus-ring"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            Back to schools
          </Link>
          <div className="mt-2 flex flex-wrap items-center gap-2.5">
            <h1
              id="school-heading"
              className="font-display text-xl sm:text-2xl font-bold tracking-tight text-slate-900 break-words"
            >
              {school.name}
            </h1>
            <StatusBadge status={school.status} />
            {data?.provisioning ? (
              <Badge
                variant="outline"
                className={`normal-case ${
                  (PROVISIONING_META[data.provisioning.state] ?? PROVISIONING_META.NEEDS_SETUP).className
                }`}
                title={
                  (PROVISIONING_META[data.provisioning.state] ?? PROVISIONING_META.NEEDS_SETUP).hint +
                  (data.provisioning.readiness
                    ? ` (${data.provisioning.readiness.requiredDone}/${data.provisioning.readiness.requiredTotal} required setup sections done)`
                    : '')
                }
              >
                {(PROVISIONING_META[data.provisioning.state] ?? PROVISIONING_META.NEEDS_SETUP).label}
              </Badge>
            ) : null}
            {school.isDemo && (
              <Badge variant="outline" className="border-slate-200 bg-slate-100 text-slate-600 normal-case">
                demo
              </Badge>
            )}
          </div>
          <p className="mt-1 font-mono text-xs text-slate-500">
            {school.slug} · {school.code}
          </p>
        </div>
        {/* ARCHITECTURE RESET — explicit, boundary-respecting actions:
            · "Preview Website" opens the PUBLIC school website in a new tab
              (an explicit look, never an inherited tenant context).
            · "Open Support Session" (renamed from "Access School") is the
              explicit, audited, step-up-gated, read-only entry into the
              school's application context. */}
        <div className="flex flex-wrap items-center gap-2">
          {/* PLATFORM-ENTRY — the canonical cross-plane public URL from
              the detail payload (schoolPublicUrl via the API; absolute
              on the two-project topology, relative /?tenant= on the
              unified fallback). The raw /?tenant= same-origin link
              would 307 into /platform/login on the platform plane —
              the public website lives on the school plane. */}
          <a
            href={data?.access?.publicUrl ?? `/?tenant=${encodeURIComponent(school.slug)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-11 shrink-0 items-center gap-2 rounded-md border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-100 focus-ring"
          >
            <ExternalLink className="h-4 w-4" aria-hidden="true" />
            Preview Website
          </a>
          {canSupport && (
            <Button
              onClick={() => setAccessOpen(true)}
              className="h-11 shrink-0 bg-amber-500 hover:bg-amber-600 text-slate-900 font-semibold focus-ring"
            >
              <LifeBuoy className="h-4 w-4" aria-hidden="true" />
              Open Support Session
            </Button>
          )}
        </div>
      </div>

      {/* Stat cards */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4"
      >
        {stats.map((s) => (
          <StatCard key={s.label} {...s} />
        ))}
      </motion.div>

      <Tabs
          value={activeGroup && availableGroups.includes(activeGroup) ? activeGroup : 'overview'}
          onValueChange={(v) => navigateToTab(v)}
          className="space-y-4"
        >
        {/* §7 — six operator groups. Compact single-row bar, horizontally
            scrollable on mobile (no page-level horizontal scroll at
            390px). Radix keeps aria-selected + roving keyboard focus on
            the triggers (arrow-key navigation). */}
        <TabsList
          ref={tabsBarRef}
          aria-label="School workspace sections"
          className="w-full bg-slate-100 border border-slate-200 h-auto p-1 gap-1 overflow-x-auto no-scrollbar justify-start scroll-mt-20"
        >
          <TabsTrigger
            value="overview"
            className="flex-none px-3 py-1.5 min-h-[36px] data-[state=active]:bg-teal-50 data-[state=active]:text-teal-700 data-[state=active]:border-teal-200 text-slate-600"
          >
            Overview
          </TabsTrigger>
          <TabsTrigger
            value="configuration"
            className="flex-none px-3 py-1.5 min-h-[36px] data-[state=active]:bg-teal-50 data-[state=active]:text-teal-700 data-[state=active]:border-teal-200 text-slate-600"
          >
            Configuration
          </TabsTrigger>
          <TabsTrigger
            value="access"
            className="flex-none px-3 py-1.5 min-h-[36px] data-[state=active]:bg-teal-50 data-[state=active]:text-teal-700 data-[state=active]:border-teal-200 text-slate-600"
          >
            Access &amp; users
          </TabsTrigger>
          {canBill && (
            <TabsTrigger
              value="subscription"
              className="flex-none px-3 py-1.5 min-h-[36px] data-[state=active]:bg-teal-50 data-[state=active]:text-teal-700 data-[state=active]:border-teal-200 text-slate-600"
            >
              Subscription
            </TabsTrigger>
          )}
          {(canSupport || canAudit) && (
            <TabsTrigger
              value="support"
              className="flex-none px-3 py-1.5 min-h-[36px] data-[state=active]:bg-teal-50 data-[state=active]:text-teal-700 data-[state=active]:border-teal-200 text-slate-600"
            >
              Support &amp; audit
            </TabsTrigger>
          )}
          {canManage && (
            <TabsTrigger
              value="advanced"
              className="flex-none px-3 py-1.5 min-h-[36px] data-[state=active]:bg-red-50 data-[state=active]:text-red-600 data-[state=active]:border-red-200 text-slate-600"
            >
              Advanced
            </TabsTrigger>
          )}
        </TabsList>

        {/* ── §7 Overview group — status, readiness, essential counts,
            next actions (the Access card moved to Access & users —
            pure regrouping, nothing deleted) ── */}
        <TabsContent value="overview" className="space-y-4">
          <NextActionsCard
            provisioning={data.provisioning}
            canManage={canManage}
            onNavigate={navigateToTab}
          />

          <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-4 py-3.5 sm:px-5">
              <h2 className="font-display text-sm font-bold text-slate-900">School profile</h2>
            </div>
            <dl className="grid grid-cols-1 gap-x-6 gap-y-3.5 p-4 sm:grid-cols-2 sm:px-5 lg:grid-cols-4">
              {profile.map((p) => (
                <div key={p.label} className="min-w-0">
                  <dt className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    <span className="text-slate-400" aria-hidden="true">
                      {p.icon}
                    </span>
                    {p.label}
                  </dt>
                  <dd className="mt-1 truncate text-sm text-slate-700" title={p.value}>
                    {p.value}
                  </dd>
                </div>
                ))}
            </dl>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-4 py-3.5 sm:px-5">
              <h2 className="font-display text-sm font-bold text-slate-900">Recent school activity</h2>
            </div>
            {data.recentActivity.length > 0 ? (
              <ol className="relative p-4 sm:px-5" aria-label="Recent school activity">
                {data.recentActivity.map((a, i) => (
                  <li key={a.id} className="relative flex gap-3.5 pb-4 last:pb-0">
                    {i < data.recentActivity.length - 1 && (
                      <span
                        className="absolute left-[7px] top-4 h-full w-px bg-slate-200"
                        aria-hidden="true"
                      />
                    )}
                    <span
                      className="relative mt-1.5 h-[7px] w-[7px] shrink-0 rounded-full bg-emerald-500/70 ring-4 ring-white"
                      aria-hidden="true"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                        <p className="font-mono text-xs font-semibold text-slate-700">{a.action}</p>
                        <span
                          className="text-[11px] tabular-nums text-slate-500"
                          title={new Date(a.at).toLocaleString()}
                        >
                          {timeAgo(a.at)}
                        </span>
                      </div>
                      {a.detail && (
                        <p className="mt-0.5 break-words text-xs leading-snug text-slate-500">{a.detail}</p>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <div className="flex flex-col items-center justify-center px-4 py-10 text-center">
                <div className="flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-slate-500 ring-1 ring-slate-200">
                  <History className="h-5 w-5" aria-hidden="true" />
                </div>
                <p className="mt-3 text-sm font-semibold text-slate-900">No school activity recorded yet</p>
                <p className="mt-1 max-w-xs text-xs leading-snug text-slate-500">
                  Tenant-side events (sign-ins, marks, fee actions) will appear here.
                </p>
              </div>
            )}
          </div>
        </TabsContent>

        {/* ── §7 Configuration group — setup/readiness · profile &
            metadata · identity & branding · modules · domains, merged
            as titled sub-sections (never tab-in-tab) ── */}
        <TabsContent value="configuration" className="space-y-8 sm:space-y-10">
          {/* Setup & readiness (PHASE 8C §12 — DB-computed progress;
              §7: actionable blockers deep-link to the fixing section —
              the child still passes its legacy tab keys, which
              navigateToTab resolves onto this group's anchors). */}
          <GroupSection
            id={SUBSECTION_IDS.setup}
            title="Setup & readiness"
            description="DB-computed onboarding progress — incomplete sections deep-link to their fix."
          >
            <SchoolSetupTab
              schoolId={id}
              schoolStatus={data?.school.status ?? 'PENDING'}
              onNavigateTab={navigateToTab}
            />
          </GroupSection>

          {/* School profile & metadata (schools.manage) */}
          {canManage && meta && (
            <GroupSection
              id={SUBSECTION_IDS.metadata}
              title="School profile & metadata"
              description="The editable record behind the profile shown in Overview."
            >
              <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="flex flex-col gap-1 border-b border-slate-200 px-4 py-3.5 sm:px-5 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="font-display text-sm font-bold text-slate-900">School metadata</h2>
                  <p className="mt-0.5 text-xs text-slate-500">
                    Profile, contact and branding — audited field-by-field.
                  </p>
                </div>
                <span
                  className={`text-xs font-semibold tabular-nums ${
                    metaChangedKeys.length > 0 ? 'text-amber-700' : 'text-slate-400'
                  }`}
                  aria-live="polite"
                >
                  {metaChangedKeys.length > 0
                    ? `${metaChangedKeys.length} unsaved change${metaChangedKeys.length === 1 ? '' : 's'}`
                    : metaSavedFields
                      ? `Saved: ${metaSavedFields.join(', ')}`
                      : 'No unsaved changes'}
                </span>
              </div>

              <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2 sm:px-5 lg:grid-cols-3">
                <div className="space-y-1.5">
                  <Label htmlFor="meta-name" className="text-xs font-semibold text-slate-700">
                    Name
                  </Label>
                  <Input
                    id="meta-name"
                    value={meta.name}
                    onChange={(e) => setMetaField('name', e.target.value)}
                    className="h-11 bg-white border-slate-200 text-slate-900 focus-visible:ring-teal-500/40"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="meta-domain" className="text-xs font-semibold text-slate-700">
                    Domain
                  </Label>
                  <Input
                    id="meta-domain"
                    value={meta.domain}
                    onChange={(e) => setMetaField('domain', e.target.value)}
                    placeholder="school.edu.in"
                    className="h-11 bg-white border-slate-200 text-slate-900 font-mono focus-visible:ring-teal-500/40"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="meta-city" className="text-xs font-semibold text-slate-700">
                    City
                  </Label>
                  <Input
                    id="meta-city"
                    value={meta.city}
                    onChange={(e) => setMetaField('city', e.target.value)}
                    className="h-11 bg-white border-slate-200 text-slate-900 focus-visible:ring-teal-500/40"
                  />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="meta-address" className="text-xs font-semibold text-slate-700">
                    Address
                  </Label>
                  <Input
                    id="meta-address"
                    value={meta.address}
                    onChange={(e) => setMetaField('address', e.target.value)}
                    className="h-11 bg-white border-slate-200 text-slate-900 focus-visible:ring-teal-500/40"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="meta-phone" className="text-xs font-semibold text-slate-700">
                    Phone
                  </Label>
                  <Input
                    id="meta-phone"
                    value={meta.phone}
                    onChange={(e) => setMetaField('phone', e.target.value)}
                    className="h-11 bg-white border-slate-200 text-slate-900 focus-visible:ring-teal-500/40"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="meta-email" className="text-xs font-semibold text-slate-700">
                    Contact email
                  </Label>
                  <Input
                    id="meta-email"
                    type="email"
                    value={meta.email}
                    onChange={(e) => setMetaField('email', e.target.value)}
                    className="h-11 bg-white border-slate-200 text-slate-900 focus-visible:ring-teal-500/40"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="meta-board" className="text-xs font-semibold text-slate-700">
                    Board
                  </Label>
                  <Select value={meta.board} onValueChange={(v) => setMetaField('board', v)}>
                    <SelectTrigger
                      id="meta-board"
                      className="h-11 w-full bg-white border-slate-200 text-slate-900 focus-visible:ring-teal-500/40"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-white border-slate-200 text-slate-900">
                      {SCHOOL_BOARDS.map((b) => (
                        <SelectItem key={b} value={b} className="focus:bg-slate-100">
                          {b}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="meta-year" className="text-xs font-semibold text-slate-700">
                    Academic year
                  </Label>
                  <Input
                    id="meta-year"
                    value={meta.academicYear}
                    onChange={(e) => setMetaField('academicYear', e.target.value)}
                    placeholder="2025-26"
                    className="h-11 bg-white border-slate-200 text-slate-900 focus-visible:ring-teal-500/40"
                  />
                </div>
                <ColorField
                  id="meta-theme"
                  label="Theme color"
                  value={meta.themeColor}
                  onChange={(v) => setMetaField('themeColor', v)}
                />
                <ColorField
                  id="meta-accent"
                  label="Accent color"
                  value={meta.accentColor}
                  onChange={(v) => setMetaField('accentColor', v)}
                />
              </div>

              <div className="flex flex-wrap items-center justify-end gap-3 border-t border-slate-200 p-4 sm:px-5">
                <p className="mr-auto hidden items-center gap-1.5 text-[11px] text-slate-400 sm:flex">
                  <Palette className="h-3.5 w-3.5" aria-hidden="true" />
                  Colors apply to the school workspace
                </p>
                <Button
                  variant="outline"
                  onClick={() => setMeta(metaFromSchool(school))}
                  disabled={metaBusy || metaChangedKeys.length === 0}
                  className="h-11 border-slate-300 bg-transparent text-slate-700 hover:bg-slate-100 focus-ring"
                >
                  Reset
                </Button>
                <Button
                  onClick={() => void saveMeta()}
                  disabled={metaBusy || metaChangedKeys.length === 0}
                  className="h-11 bg-teal-600 hover:bg-teal-700 text-white font-semibold focus-ring"
                >
                  {metaBusy ? 'Saving…' : `Save ${metaChangedKeys.length > 0 ? `(${metaChangedKeys.length})` : ''}`}
                </Button>
              </div>
            </div>
            </GroupSection>
          )}

          {/* Modules & admissions — module availability + the
              server-issued admissions workflow (the subscription plan
              card lives in the Subscription group — single source,
              mission §5: no duplicate plan surfaces). */}
          <GroupSection
            id={SUBSECTION_IDS.modules}
            title="Modules & admissions"
            description="Per-school module overrides and the fail-closed admissions workflow."
          >
            {/* Feature flags (schools.manage) */}
            <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-4 py-3.5 sm:px-5">
              <h2 className="font-display text-sm font-bold text-slate-900">Module availability</h2>
              <p className="mt-0.5 text-xs text-slate-500">
                Effective availability ={' '}
                <span className="font-mono text-slate-600">school override ?? platform master ?? enabled</span>{' '}
                — a missing override falls back to the platform-wide master switch.
              </p>
            </div>
            <ul className="divide-y divide-slate-200">
              {FLAGGABLE_MODULES.map((module) => {
                const label = module.charAt(0).toUpperCase() + module.slice(1)
                const override = typeof flags[module] === 'boolean' ? flags[module] : null
                const checked = override ?? true
                return (
                  <li
                    key={module}
                    className="flex min-h-[56px] items-center justify-between gap-4 px-4 py-3 sm:px-5"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900">{label}</p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {override === null ? (
                          <span className="text-slate-500">No override — platform default applies</span>
                        ) : override ? (
                          <span className="text-emerald-700">Enabled for this school (override)</span>
                        ) : (
                          <span className="text-red-600">Disabled for this school (override)</span>
                        )}
                      </p>
                    </div>
                    <div className="flex items-center gap-2.5">
                      {flagBusy === module && (
                        <span className="text-[11px] text-slate-500" role="status">
                          saving…
                        </span>
                      )}
                      <Switch
                        checked={checked}
                        disabled={!canManage || flagBusy === module}
                        onCheckedChange={(next) => void toggleFlag(module, label, next)}
                        aria-label={`${label} module ${checked ? 'enabled' : 'disabled'} — toggle override for this school`}
                        className="data-[state=checked]:bg-teal-600 data-[state=unchecked]:bg-slate-300 focus-ring"
                      />
                    </div>
                  </li>
                )
              })}
            </ul>
            {!canManage && (
              <p className="border-t border-slate-200 px-4 py-3 text-xs text-slate-500 sm:px-5">
                You do not hold <span className="font-mono text-slate-600">schools.manage</span> — the switches
                are read-only for you.
              </p>
            )}
          </div>

          {/* Admissions — server-issued workflow (Batch 1 / WS-C): schools.manage + step-up */}
          <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-4 py-3.5 sm:px-5">
              <h2 className="font-display text-sm font-bold text-slate-900">
                Admissions — server-issued workflow
              </h2>
              <p className="mt-0.5 text-xs text-slate-500">
                <span className="font-mono text-slate-600">admissionsServerIssuance</span> — a fail-closed
                financial-workflow flag: absent means OFF. Changing it requires{' '}
                <span className="font-mono text-slate-600">schools.manage</span> + step-up verification and
                writes a platform audit event (actor, school, previous → new state).
              </p>
            </div>
            <div className="space-y-3 p-4 sm:px-5">
              <div className="flex min-h-[56px] items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-900">
                    {admissions
                      ? admissions.enabled
                        ? 'Enabled for this school'
                        : 'Disabled (fail-closed)'
                      : 'State unavailable'}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {admissions
                      ? admissions.source === 'school'
                        ? 'School override in effect'
                        : admissions.source === 'platform'
                          ? 'No school override — platform master switch in effect'
                          : 'No override anywhere — default OFF'
                      : 'Could not load the flag state (the toggle still works)'}
                  </p>
                </div>
                <div className="flex items-center gap-2.5">
                  {admissionsBusy && (
                    <span className="text-[11px] text-slate-500" role="status">
                      saving…
                    </span>
                  )}
                  <Switch
                    checked={admissions?.enabled ?? false}
                    disabled={!canManage || admissionsBusy || !admissions}
                    onCheckedChange={(next) => toggleAdmissions(next)}
                    aria-label="Server-issued admissions workflow — enable or disable for this school"
                    className="data-[state=checked]:bg-teal-600 data-[state=unchecked]:bg-slate-300 focus-ring"
                  />
                </div>
              </div>
              {admissions && (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    Workflow readiness
                  </p>
                  <ul className="mt-1.5 space-y-1.5 text-xs">
                    <li className="flex items-start gap-2">
                      {admissions.readiness.academicYearSet ? (
                        <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden="true" />
                      ) : (
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" aria-hidden="true" />
                      )}
                      <span className="text-slate-600">
                        {admissions.readiness.academicYearSet
                          ? `Academic year set (${admissions.readiness.academicYear})`
                          : 'No academic year set — submissions fail closed until the session is set'}
                      </span>
                    </li>
                    <li className="flex items-start gap-2">
                      {admissions.readiness.publishedFeeStructures > 0 ? (
                        <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden="true" />
                      ) : (
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" aria-hidden="true" />
                      )}
                      <span className="text-slate-600">
                        {admissions.readiness.publishedFeeStructures > 0
                          ? `${admissions.readiness.publishedFeeStructures} published fee structure${admissions.readiness.publishedFeeStructures === 1 ? '' : 's'} (current/scheduled)`
                          : 'No published fee structure — enrolment fails closed (FEE_CONFIGURATION_REQUIRED) until one is published'}
                      </span>
                    </li>
                  </ul>
                  {admissions.enabled && !admissions.readiness.ready && (
                    <p className="mt-2 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-xs text-amber-800">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" aria-hidden="true" />
                      Enabled but not ready — the workflow refuses submissions and enrolments until
                      the missing configuration above is completed (fail-closed by design).
                    </p>
                  )}
                </div>
              )}
              {!canManage && (
                <p className="text-xs text-slate-500">
                  You do not hold <span className="font-mono text-slate-600">schools.manage</span> — the
                  switch is read-only for you.
                </p>
              )}
            </div>
          </div>

          {/* Enable-an-unready-workflow confirmation (Batch 1 / WS-C) */}
          <AlertDialog open={admissionsConfirmNext} onOpenChange={setAdmissionsConfirmNext}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Enable an unconfigured workflow?</AlertDialogTitle>
                <AlertDialogDescription>
                  This school{' '}
                  {admissions?.readiness.academicYearSet
                    ? 'has an academic year set'
                    : 'has NO academic year set'}{' '}
                  and{' '}
                  {admissions && admissions.readiness.publishedFeeStructures > 0
                    ? `has ${admissions.readiness.publishedFeeStructures} published fee structure(s)`
                    : 'has NO published fee structure'}
                  . The server-issued admissions workflow fails closed — no submissions, no
                  enrolments, no fee quotes — until the missing configuration is completed. Enable
                  anyway?
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setAdmissionsConfirmNext(false)}
                  className="h-10"
                >
                  Cancel
                </Button>
                <Button
                  onClick={() => {
                    setAdmissionsConfirmNext(false)
                    void applyAdmissionsIssuance(true)
                  }}
                  className="h-10 bg-teal-600 hover:bg-teal-700 text-white font-semibold focus-ring"
                >
                  Enable anyway
                </Button>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          </GroupSection>

          {/* Identity change requests (schools.manage) — SAAS §8 */}
          {canManage && (
            <GroupSection
              id={SUBSECTION_IDS.identity}
              title="Identity & branding"
              description="Principal-submitted profile change requests — approve or reject, audited."
            >
              <SchoolIdentityRequestsTab schoolId={id} onChanged={() => void reload()} />
            </GroupSection>
          )}

          {/* Custom domains (PHASE 8B — multi-tenant domains) */}
          <GroupSection
            id={SUBSECTION_IDS.domains}
            title="Custom domains"
            description="Map and verify this tenant's custom hostnames."
          >
            <SchoolDomainsTab schoolId={id} canManage={canManage} />
          </GroupSection>
        </TabsContent>

        {/* ── §7 Access & users group — the tenant's doors, the founding
            principal's credential truth, live sessions and the user
            roster (the Access card moved here from Overview — pure
            regrouping) ── */}
        <TabsContent value="access" className="space-y-8 sm:space-y-10">
          {/* Access (PHASE 10) — canonical doors + principal credential
              truth + domain status summary, so an admin never guesses
              how a tenant is reached (management lives in
              Configuration → Custom domains). */}
          <GroupSection
            id={SUBSECTION_IDS.access}
            title="Access & sign-in"
            description="How this tenant is reached, who holds the founding credential, and live sessions."
          >
            <AccessCard
              access={data.access}
              domains={data.domains}
              canManage={canManage}
              onReissue={() => {
                setReissueResult(null)
                setReissueOpen(true)
              }}
              reissueBusy={reissueBusy}
            />
            <SessionsCard
              activeSchoolSessions={data.activeSchoolSessions}
              activeSupportSessions={data.activeSupportSessions}
            />
          </GroupSection>

          {/* Users & access (mission §9 — read-only roster) */}
          <GroupSection
            id={SUBSECTION_IDS.users}
            title="Users"
            description="Every account in this tenant with its role and status (read-only)."
          >
            <SchoolUsersTab schoolId={id ?? ''} />
          </GroupSection>
        </TabsContent>

        {/* ── §7 Subscription group (billing.manage) — the authoritative
            subscription & entitlement system (mission §5): snapshot,
            plan & billing, activation codes, student entitlements,
            ledger (the legacy plan marker moved here from the old Plan
            card — single surface, no duplicates), plus the tenant fee
            gateway (§3B). Honest schema-pending signal first: the
            hardened GET surfaces may flag the pending subscription
            migration — degraded data must never read as an empty
            state. The child module renders its own load-error state
            with retry, so no boundary wraps it. ── */}
        {canBill && (
          <TabsContent value="subscription" className="space-y-8 sm:space-y-10">
            {subscriptionPending && <SubscriptionPendingBanner compact />}
            <GroupSection
              id={SUBSECTION_IDS.subscription}
              title="Subscription & entitlements"
              description="Snapshot, plan & billing, activation codes, student entitlements and the payment ledger."
            >
              <SchoolSubscriptionTab schoolId={id} onNavigateTab={navigateToTab} />
            </GroupSection>
            <GroupSection
              id={SUBSECTION_IDS.gateway}
              title="Fee gateway"
              description="The school's own student-fee payment rail — separate credentials from the subscription system."
            >
              <SchoolPaymentGatewayTab schoolId={id} />
            </GroupSection>
          </TabsContent>
        )}

        {/* ── §7 Support & audit group (support.access / audit.read —
            §9) — the oversight surfaces merged as titled sub-sections
            ── */}
        {(canSupport || canAudit) && (
          <TabsContent value="support" className="space-y-8 sm:space-y-10">
            {canSupport && (
              <GroupSection
                id={SUBSECTION_IDS.support}
                title="Support sessions"
                description="Time-boxed, audited read-only oversight sessions into this tenant."
              >
                <SchoolSupportTab schoolId={id ?? ''} />
              </GroupSection>
            )}
            {canAudit && (
              <GroupSection
                id={SUBSECTION_IDS.audit}
                title="Audit history"
                description="The platform audit trail for this school — every action survives."
              >
                <SchoolAuditTab schoolId={id ?? ''} />
              </GroupSection>
            )}
          </TabsContent>
        )}

        {/* ── §7 Advanced group (schools.manage) — the danger zone:
            status control and irreversible deletion. The explicit
            visual warning treatment is the existing red-bordered
            container (preserved as-is); step-up gating, typed
            confirmation and audit events unchanged. ── */}
        {canManage && (
          <TabsContent value="advanced" className="space-y-8 sm:space-y-10">
            <div
              id={SUBSECTION_IDS.danger}
              className="space-y-4 scroll-mt-24 rounded-xl border-2 border-red-200 bg-red-50/60 p-4 sm:p-6"
            >
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-red-100 text-red-600">
                  <ShieldAlert className="h-4.5 w-4.5" aria-hidden="true" />
                </div>
                <div>
                  <h2 className="font-display text-sm font-bold text-red-700">Danger zone</h2>
                  <p className="mt-0.5 text-xs text-slate-500">
                    Status control and irreversible deletion. Suspend and delete require step-up
                    verification; everything is audited.
                  </p>
                </div>
              </div>

              {/* Status actions */}
              <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-4 sm:p-5">
                <h3 className="text-sm font-semibold text-slate-900">School status</h3>
                <p className="mt-1 text-xs text-slate-500">
                  Current status:{' '}
                  <StatusBadge status={school.status} />{' '}
                  {school.status === 'PENDING' &&
                    '— users of this school cannot sign in until it is activated.'}
                  {school.status === 'ACTIVE' && '— suspending signs every user out immediately.'}
                  {school.status === 'SUSPENDED' && '— sign-in remains available but the workspace stays locked; reactivate to restore service.'}
                  {school.status === 'TRIAL' && '— trial tenant; activate to make it a permanent ACTIVE school.'}
                  {school.status === 'PENDING' && '— provisioned but not yet activated; nobody can sign in until activation.'}
                </p>
                <div className="mt-4 flex flex-wrap gap-3">
                  {(school.status === 'PENDING' || school.status === 'TRIAL') && (
                    <Button
                      onClick={() => void runStatusAction('activate')}
                      disabled={statusBusy !== null}
                      className="h-11 bg-teal-600 hover:bg-teal-700 text-white font-semibold focus-ring"
                    >
                      <Power className="h-4 w-4" aria-hidden="true" />
                      {statusBusy === 'activate' ? 'Activating…' : 'Activate school'}
                    </Button>
                  )}
                  {school.status === 'ACTIVE' && (
                    <Button
                      onClick={() => setSuspendOpen(true)}
                      disabled={statusBusy !== null}
                      className="h-11 bg-red-600 hover:bg-red-500 text-white font-semibold focus-ring"
                    >
                      <Ban className="h-4 w-4" aria-hidden="true" />
                      Suspend school
                    </Button>
                  )}
                  {school.status === 'SUSPENDED' && (
                    <Button
                      onClick={() => void runStatusAction('reactivate')}
                      disabled={statusBusy !== null}
                      className="h-11 bg-teal-600 hover:bg-teal-700 text-white font-semibold focus-ring"
                    >
                      <Power className="h-4 w-4" aria-hidden="true" />
                      {statusBusy === 'reactivate' ? 'Reactivating…' : 'Reactivate school'}
                    </Button>
                  )}
                  {school.status === 'TRIAL' && (
                    <p className="text-xs text-slate-500">
                      This school is in TRIAL state — activating converts it to a fully ACTIVE tenant (audited).
                    </p>
                  )}
                </div>
              </div>

              {/* Delete */}
              <div className="rounded-xl border border-red-200 bg-white p-4 sm:p-5">
                <h3 className="text-sm font-semibold text-slate-900">Delete this school</h3>
                <p className="mt-1.5 max-w-2xl text-xs leading-relaxed text-slate-500">
                  Permanently deletes <span className="font-semibold text-slate-700">{school.name}</span> and{' '}
                  <span className="font-semibold text-red-600">every tenant row</span> — users, students,
                  teachers, classes, subjects, exams, marks, fees, payments, attendance, timetables, homework,
                  library records and messages. This is a full cascade and{' '}
                  <span className="font-semibold text-slate-700">cannot be undone</span>. Platform audit
                  entries survive (by design) so the deletion itself remains traceable.
                </p>
                <Button
                  variant="outline"
                  onClick={() => {
                    setDeleteTyped('')
                    setDeleteOpen(true)
                  }}
                  disabled={deleteBusy}
                  className="mt-4 h-11 border-red-200 bg-red-50 text-red-600 hover:bg-red-100 hover:text-red-700 font-semibold focus-ring"
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                  Delete school
                </Button>
              </div>
            </div>
          </TabsContent>
        )}
      </Tabs>

      {/* Dialogs + the shared step-up TOTP prompt */}
      {canSupport && (
        <AccessDialog
          open={accessOpen}
          onOpenChange={setAccessOpen}
          schoolId={id}
          schoolName={school.name}
          gate={gate}
        />
      )}
      <SuspendDialog
        open={suspendOpen}
        onOpenChange={setSuspendOpen}
        schoolId={id}
        schoolName={school.name}
        gate={gate}
        onSuspended={() => void reload()}
      />

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent className="bg-white border-red-200 text-slate-900 sm:max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-red-700">
              Delete {school.name} permanently?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-slate-500">
              This cascades through the entire tenant — {num.format(data.counts.users)} users,{' '}
              {num.format(data.counts.students)} students, {num.format(data.counts.teachers)} teachers and
              every dependent row (exams, marks, fees, payments, attendance, timetables, homework, library,
              messages). It cannot be undone. Type the school&apos;s exact name to confirm.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="delete-confirm" className="text-xs font-semibold text-slate-700">
              Type <span className="font-mono font-bold text-red-700">{school.name}</span> to confirm
            </Label>
            <Input
              id="delete-confirm"
              value={deleteTyped}
              onChange={(e) => setDeleteTyped(e.target.value)}
              placeholder={school.name}
              autoComplete="off"
              aria-invalid={deleteTyped.length > 0 && deleteTyped.trim() !== school.name}
              className="h-11 bg-white border-slate-200 text-slate-900 font-mono focus-visible:ring-red-500/40"
            />
            {deleteTyped.length > 0 && deleteTyped.trim() !== school.name && (
              <p role="alert" className="text-[11px] text-red-600">
                The name does not match yet.
              </p>
            )}
          </div>
          <AlertDialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setDeleteOpen(false)}
              disabled={deleteBusy}
              className="h-11 border-slate-300 bg-transparent text-slate-700 hover:bg-slate-100 focus-ring"
            >
              Cancel
            </Button>
            <Button
              onClick={() => void deleteSchool()}
              disabled={deleteBusy || deleteTyped.trim() !== school.name}
              className="h-11 bg-red-600 hover:bg-red-500 text-white font-semibold focus-ring"
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
              {deleteBusy ? 'Deleting…' : 'Delete permanently'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Phase 3 — credential re-issue: confirmation + one-time result ── */}
      <Dialog open={reissueOpen} onOpenChange={setReissueOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto custom-scrollbar bg-white border-slate-200 text-slate-900 sm:max-w-lg">
          {reissueResult ? (
            <div className="space-y-4">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 font-display text-slate-900">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-500 text-white">
                    <RefreshCw className="h-4 w-4" aria-hidden="true" />
                  </span>
                  New one-time credential
                </DialogTitle>
                <DialogDescription className="text-slate-500">
                  The previous bootstrap password stopped working the moment this was issued.{' '}
                  {reissueResult.revokedSessions > 0
                    ? `${reissueResult.revokedSessions} live session(s) for the principal were revoked. `
                    : ''}
                  The principal must replace this password at first sign-in (enforced).
                </DialogDescription>
              </DialogHeader>
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-amber-700">
                  One-time credential for {reissueResult.principalEmail}
                </p>
                <p className="mt-1 text-xs text-amber-800">
                  Shown only once — never displayed again. Copy it now and deliver it to the principal.
                </p>
                <div className="mt-2 flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded-lg border border-amber-200 bg-white px-3 py-2 font-mono text-sm text-slate-900">
                    {reissueResult.tempPassword}
                  </code>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-9 border-amber-300 bg-white text-amber-700 hover:bg-amber-50 focus-ring"
                    onClick={() => {
                      void navigator.clipboard
                        ?.writeText(reissueResult.tempPassword)
                        .then(() => toast.success('One-time credential copied'))
                        .catch(() => toast.error('Copy failed — select the text manually'))
                    }}
                  >
                    <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                    Copy
                  </Button>
                </div>
              </div>
              {reissueResult.invitation ? (
                <div
                  className={`flex items-start gap-2.5 rounded-xl border p-3 text-xs ${
                    reissueResult.invitation.state === 'FAILED' || reissueResult.invitation.state === 'NONE'
                      ? 'border-amber-200 bg-amber-50 text-amber-800'
                      : 'border-teal-200 bg-teal-50 text-teal-800'
                  }`}
                >
                  {reissueResult.invitation.state === 'FAILED' || reissueResult.invitation.state === 'NONE' ? (
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  ) : (
                    <Check className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  )}
                  <p>
                    <span className="font-semibold">Invite email to {reissueResult.principalEmail}:</span>{' '}
                    {reissueResult.invitation.state === 'SENT'
                      ? 'sent.'
                      : reissueResult.invitation.state === 'QUEUED'
                        ? 'accepted by the email provider — delivery pending confirmation.'
                        : `failed${reissueResult.invitation.errorClass ? ` (${reissueResult.invitation.errorClass})` : ''} — deliver the one-time credential above yourself.`}
                  </p>
                </div>
              ) : null}
              <div className="flex justify-end">
                <Button
                  onClick={() => setReissueOpen(false)}
                  className="h-10 bg-teal-600 hover:bg-teal-700 text-white font-semibold focus-ring"
                >
                  Done
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 font-display text-slate-900">
                  <RefreshCw className="h-4 w-4 text-amber-600" aria-hidden="true" />
                  Re-issue the one-time credential?
                </DialogTitle>
                <DialogDescription className="text-slate-500">
                  {data?.access.principal
                    ? `A fresh one-time password will be generated for ${data.access.principal.email}. The current bootstrap password stops working immediately, the principal's live sessions are revoked, and a new invite email is sent. Audited.`
                    : 'A fresh one-time password will be generated for the founding principal. Audited.'}
                </DialogDescription>
              </DialogHeader>
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button
                  variant="outline"
                  onClick={() => setReissueOpen(false)}
                  disabled={reissueBusy}
                  className="h-10 border-slate-300 bg-transparent text-slate-700 hover:bg-slate-100 focus-ring"
                >
                  Cancel
                </Button>
                <Button
                  onClick={() => void reissueCredential()}
                  disabled={reissueBusy}
                  className="h-10 bg-amber-500 hover:bg-amber-600 text-slate-900 font-semibold focus-ring"
                >
                  <RefreshCw className={`h-4 w-4 ${reissueBusy ? 'animate-spin' : ''}`} aria-hidden="true" />
                  {reissueBusy ? 'Re-issuing…' : 'Re-issue credential'}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {stepUpNode}
    </section>
  )
}
