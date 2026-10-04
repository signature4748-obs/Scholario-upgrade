'use client'

/**
 * SAAS-HARDENING (§3B) — platform console · school detail · Payment
 * Gateway tab (School Fees).
 *
 * The school's OWN student-fee gateway account (Razorpay) — tenant-scoped,
 * platform-managed billing infrastructure. This is the B-domain (school
 * collects fees from parents); it is completely disjoint from the
 * subscription ledger (A-domain — school pays SCHOLARIO).
 *
 * Secrets are write-only: the API never returns them, so this form never
 * prefills or echoes a secret — only "stored encrypted — enter a new
 * value to replace". PUT/DELETE are step-up gated and audited server-side.
 */
import React, { useCallback, useEffect, useState } from 'react'
import {
  AlertTriangle,
  CreditCard,
  EyeOff,
  KeyRound,
  Landmark,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Webhook,
} from 'lucide-react'
import { platformApi, type PlatformApiError } from '../platform-client'
import { useStepUpGate } from '../step-up-gate'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { toast } from 'sonner'

// ── Types (API contract — GET/PUT/DELETE payment-gateway) ─────────────────

interface GatewayView {
  schoolId: string
  provider: string
  publicKeyId: string | null
  mode: 'live' | 'test' | 'sandbox' | null
  status: string
}

const GATEWAY_STATUSES = ['ACTIVE', 'PENDING', 'DISABLED'] as const

const STATUS_STYLES: Record<string, string> = {
  ACTIVE: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  PENDING: 'border-amber-200 bg-amber-50 text-amber-700',
  DISABLED: 'border-slate-200 bg-slate-100 text-slate-500',
}

function errText(e: unknown): string {
  const pae = e as PlatformApiError
  if (pae && typeof pae.error === 'string') return pae.error
  return e instanceof Error ? e.message : 'Something went wrong'
}

function GatewayStatusBadge({ status }: { status: string }) {
  return (
    <Badge variant="outline" className={`normal-case ${STATUS_STYLES[status] ?? STATUS_STYLES['DISABLED']}`}>
      {status}
    </Badge>
  )
}

interface GatewayForm {
  publicKeyId: string
  keySecret: string
  webhookSecret: string
  status: string
  notes: string
}

function formFromGateway(g: GatewayView | null): GatewayForm {
  return {
    publicKeyId: g?.publicKeyId ?? '',
    keySecret: '',
    webhookSecret: '',
    status: g?.status === 'PENDING' || g?.status === 'DISABLED' ? g.status : 'ACTIVE',
    notes: '',
  }
}

// ── Module ────────────────────────────────────────────────────────────────

export function SchoolPaymentGatewayTab({ schoolId }: { schoolId: string }) {
  const { gate, node: stepUpNode } = useStepUpGate()
  const [gateway, setGateway] = useState<GatewayView | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [form, setForm] = useState<GatewayForm>(formFromGateway(null))
  const [busy, setBusy] = useState(false)
  const [disableOpen, setDisableOpen] = useState(false)
  const [disableBusy, setDisableBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoadError(null)
    try {
      const res = await platformApi<{ gateway: GatewayView | null }>(
        `/api/platform/schools/${schoolId}/payment-gateway`,
      )
      setGateway(res.gateway)
      setForm(formFromGateway(res.gateway))
      setLoaded(true)
    } catch (e) {
      setLoadError(errText(e))
    }
  }, [schoolId])

  useEffect(() => {
    void load()
  }, [load])

  const setField = <K extends keyof GatewayForm>(key: K, value: string) =>
    setForm((f) => ({ ...f, [key]: value }))

  const validate = (): string | null => {
    const publicKeyId = form.publicKeyId
    if (publicKeyId.trim().length < 4) return 'Public key id is required (min 4 characters)'
    if (!/^rzp_(live|test)_/.test(publicKeyId.trim())) {
      return 'Razorpay key ids look like rzp_live_… or rzp_test_…'
    }
    if (form.keySecret.trim().length < 8) return 'Key secret is required (min 8 characters) — it cannot be read back, so enter it on every save'
    if (form.webhookSecret.trim().length > 0 && form.webhookSecret.trim().length < 8) {
      return 'Webhook secret (when provided) must be at least 8 characters'
    }
    return null
  }

  const save = async () => {
    const problem = validate()
    if (problem) {
      setError(problem)
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await gate(() =>
        platformApi<{ ok: true; gateway: GatewayView; message: string }>(
          `/api/platform/schools/${schoolId}/payment-gateway`,
          {
            method: 'PUT',
            body: JSON.stringify({
              provider: 'razorpay',
              publicKeyId: form.publicKeyId.trim(),
              keySecret: form.keySecret.trim(),
              status: form.status,
              ...(form.webhookSecret.trim() ? { webhookSecret: form.webhookSecret.trim() } : {}),
              ...(form.notes.trim() ? { notes: form.notes.trim() } : {}),
            }),
          },
        ),
      )
      if (!res) return // cancelled at the step-up prompt
      toast.success(res.message)
      setForm((f) => ({ ...f, keySecret: '', webhookSecret: '' }))
      await load()
    } catch (e) {
      setError(errText(e))
    } finally {
      setBusy(false)
    }
  }

  const disable = async () => {
    setDisableBusy(true)
    setError(null)
    try {
      const res = await gate(() =>
        platformApi<{ ok: true; message: string }>(
          `/api/platform/schools/${schoolId}/payment-gateway`,
          { method: 'DELETE' },
        ),
      )
      if (!res) return
      toast.success(res.message)
      setDisableOpen(false)
      await load()
    } catch (e) {
      setError(errText(e))
      setDisableOpen(false)
    } finally {
      setDisableBusy(false)
    }
  }

  const configured = gateway !== null

  return (
    <div className="space-y-4">
      {stepUpNode}

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

      {!loaded && loadError === null && (
        <div className="space-y-4" aria-busy="true" aria-label="Loading fee gateway">
          <Skeleton className="h-28 w-full rounded-xl bg-slate-100" />
          <Skeleton className="h-80 w-full rounded-xl bg-slate-100" />
        </div>
      )}

      {loaded && (
        <>
          {/* ── Current gateway ─────────────────────────────────────── */}
          <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-col gap-3 border-b border-slate-200 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-5">
              <div>
                <h2 className="font-display text-sm font-bold text-slate-900 flex items-center gap-2">
                  <Landmark className="h-4 w-4 text-teal-600" aria-hidden="true" />
                  Fee payment gateway (student fees)
                </h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  This is the school&apos;s own student-fee gateway account (Razorpay). Secrets
                  are AES-encrypted at rest and never displayed.
                </p>
              </div>
              {configured && (
                <Button
                  variant="outline"
                  onClick={() => setDisableOpen(true)}
                  disabled={disableBusy || gateway.status === 'DISABLED'}
                  className="h-11 shrink-0 border-red-200 bg-red-50 text-red-600 hover:bg-red-100 hover:text-red-700 font-semibold focus-ring"
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                  {gateway.status === 'DISABLED' ? 'Already disabled' : 'Disable gateway'}
                </Button>
              )}
            </div>

            {configured ? (
              <dl className="grid grid-cols-1 gap-x-6 gap-y-3.5 p-4 sm:grid-cols-3 sm:px-5">
                <div>
                  <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Provider</dt>
                  <dd className="mt-1 flex items-center gap-2 text-sm capitalize text-slate-700">
                    <CreditCard className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                    {gateway.provider}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Public key id</dt>
                  <dd className="mt-1 break-all font-mono text-sm text-slate-700">
                    {gateway.publicKeyId ?? '—'}
                    {gateway.mode === 'test' && (
                      <Badge variant="outline" className="ml-2 border-amber-200 bg-amber-50 text-amber-700 normal-case">
                        test keys
                      </Badge>
                    )}
                    {gateway.mode === 'live' && (
                      <Badge variant="outline" className="ml-2 border-emerald-200 bg-emerald-50 text-emerald-700 normal-case">
                        live keys
                      </Badge>
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Status</dt>
                  <dd className="mt-1">
                    <GatewayStatusBadge status={gateway.status} />
                    {gateway.status === 'ACTIVE' && (
                      <p className="mt-1 text-[11px] text-slate-500">
                        Student-fee checkout runs against this account.
                      </p>
                    )}
                    {gateway.status === 'PENDING' && (
                      <p className="mt-1 text-[11px] text-amber-700">
                        Not yet active — checkout does not use this account yet.
                      </p>
                    )}
                    {gateway.status === 'DISABLED' && (
                      <p className="mt-1 text-[11px] text-slate-500">
                        Disabled — checkout falls back to the deployment-level provider.
                      </p>
                    )}
                  </dd>
                </div>
              </dl>
            ) : (
              <div className="flex flex-col items-center justify-center px-4 py-10 text-center">
                <div className="flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-slate-500 ring-1 ring-slate-200">
                  <Landmark className="h-5 w-5" aria-hidden="true" />
                </div>
                <p className="mt-3 text-sm font-semibold text-slate-900">No tenant gateway configured</p>
                <p className="mt-1 max-w-sm text-xs leading-snug text-slate-500">
                  This school&apos;s student-fee checkout currently resolves to the
                  deployment-level payment provider. Configure the school&apos;s own account below
                  to route its fee collections separately.
                </p>
              </div>
            )}
          </div>

          {/* ── Configure form (secrets are write-only) ──────────────── */}
          <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-4 py-3.5 sm:px-5">
              <h2 className="font-display text-sm font-bold text-slate-900 flex items-center gap-2">
                <KeyRound className="h-4 w-4 text-teal-600" aria-hidden="true" />
                {configured ? 'Reconfigure the gateway' : 'Configure the gateway'}
              </h2>
              <p className="mt-0.5 text-xs text-slate-500">
                Platform-owned billing infrastructure — a principal never sees or sets these
                values. Saving requires step-up verification and is audited (secret lengths
                only, values never).
              </p>
            </div>

            {error && (
              <div role="alert" className="mx-4 mt-4 flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-600 sm:mx-5">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                {error}
              </div>
            )}

            <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2 sm:px-5">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="gw-key-id" className="text-xs font-semibold text-slate-700">
                  Public key id *
                </Label>
                <Input
                  id="gw-key-id"
                  value={form.publicKeyId}
                  onChange={(e) => setField('publicKeyId', e.target.value)}
                  placeholder="rzp_live_XXXXXXXXXXXXXX"
                  maxLength={120}
                  autoComplete="off"
                  className="h-11 bg-white border-slate-200 text-slate-900 font-mono focus-visible:ring-teal-500/40"
                />
                <p className="text-[10px] text-slate-400">
                  Razorpay key ids look like <span className="font-mono">rzp_live_…</span> or{' '}
                  <span className="font-mono">rzp_test_…</span> — browser-safe (checkout needs it).
                </p>
              </div>

              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="gw-key-secret" className="text-xs font-semibold text-slate-700">
                  Key secret *
                </Label>
                <Input
                  id="gw-key-secret"
                  type="password"
                  value={form.keySecret}
                  onChange={(e) => setField('keySecret', e.target.value)}
                  placeholder={
                    configured
                      ? 'stored encrypted — enter a new value to replace'
                      : 'paste the key secret from the Razorpay dashboard'
                  }
                  maxLength={200}
                  autoComplete="new-password"
                  className="h-11 bg-white border-slate-200 text-slate-900 focus-visible:ring-teal-500/40"
                />
                <p className="flex items-start gap-1.5 text-[10px] text-slate-400">
                  <EyeOff className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                  {configured
                    ? 'Write-only: the stored secret cannot be read back, so it must be entered (or rotated) on every save.'
                    : 'Stored AES-256-GCM encrypted at rest; never displayed again.'}
                </p>
              </div>

              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="gw-webhook-secret" className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
                  <Webhook className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                  Webhook secret (optional)
                </Label>
                <Input
                  id="gw-webhook-secret"
                  type="password"
                  value={form.webhookSecret}
                  onChange={(e) => setField('webhookSecret', e.target.value)}
                  placeholder={configured ? 'stored encrypted — enter a new value to replace' : 'webhook signing secret'}
                  maxLength={200}
                  autoComplete="new-password"
                  className="h-11 bg-white border-slate-200 text-slate-900 focus-visible:ring-teal-500/40"
                />
                <p className="text-[10px] text-slate-400">
                  Providing a value stores or rotates it; leaving it blank removes any stored
                  webhook secret on save.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="gw-status" className="text-xs font-semibold text-slate-700">
                  Status
                </Label>
                <Select value={form.status} onValueChange={(v) => setField('status', v)}>
                  <SelectTrigger id="gw-status" className="h-11 w-full bg-white border-slate-200 text-slate-900 focus-visible:ring-teal-500/40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-white border-slate-200 text-slate-900">
                    {GATEWAY_STATUSES.map((s) => (
                      <SelectItem key={s} value={s} className="focus:bg-slate-100">
                        {s}
                        {configured && s === gateway.status ? ' (current)' : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="gw-notes" className="text-xs font-semibold text-slate-700">
                  Notes (optional, audited)
                </Label>
                <Textarea
                  id="gw-notes"
                  value={form.notes}
                  onChange={(e) => setField('notes', e.target.value)}
                  placeholder="e.g. Keys issued by the school's bursar on 2026-10-04 — account KYC verified…"
                  rows={2}
                  maxLength={400}
                  className="bg-white border-slate-200 text-slate-900 placeholder:text-slate-400 focus-visible:ring-teal-500/40 min-h-[72px]"
                />
                <p className="text-[10px] text-slate-400">
                  Not shown back on this page — leaving blank keeps any existing note.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-3 border-t border-slate-200 p-4 sm:px-5">
              <Button
                variant="outline"
                onClick={() => {
                  setForm(formFromGateway(gateway))
                  setError(null)
                }}
                disabled={busy}
                className="h-11 border-slate-300 bg-transparent text-slate-700 hover:bg-slate-100 focus-ring"
              >
                Reset
              </Button>
              <Button
                onClick={() => void save()}
                disabled={busy}
                className="h-11 bg-teal-600 hover:bg-teal-700 text-white font-semibold focus-ring"
              >
                <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                {busy ? 'Saving…' : configured ? 'Save configuration' : 'Configure gateway'}
              </Button>
            </div>
          </div>

          {/* ── Disable confirmation ─────────────────────────────────── */}
          <AlertDialog open={disableOpen} onOpenChange={setDisableOpen}>
            <AlertDialogContent className="bg-white border-slate-200 text-slate-900 sm:max-w-md">
              <AlertDialogHeader>
                <AlertDialogTitle className="font-display flex items-center gap-2 text-red-700">
                  <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                  Disable this fee gateway?
                </AlertDialogTitle>
                <AlertDialogDescription className="text-slate-500">
                  Student-fee checkout for this school immediately falls back to the
                  deployment-level payment provider. The configuration (including the encrypted
                  secrets) is kept and can be re-enabled by saving a configuration — step-up
                  gated and audited.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter className="gap-2">
                <Button
                  variant="outline"
                  onClick={() => setDisableOpen(false)}
                  disabled={disableBusy}
                  className="h-11 border-slate-300 bg-transparent text-slate-700 hover:bg-slate-100 focus-ring"
                >
                  Cancel
                </Button>
                <Button
                  onClick={() => void disable()}
                  disabled={disableBusy}
                  className="h-11 bg-red-600 hover:bg-red-500 text-white font-semibold focus-ring"
                >
                  {disableBusy ? 'Disabling…' : 'Disable gateway'}
                </Button>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      )}
    </div>
  )
}
