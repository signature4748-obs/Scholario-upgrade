'use client'

// ============================================================
// PlansModule — /platform/plans (PAYMENTS & GATEWAYS REDESIGN)
// ------------------------------------------------------------
// The product catalogue and commercial rules — the ONE place plan
// management lives (extracted from the old subscriptions module's
// internal "Manage plans" view so the control centre stays a control
// centre). School-specific negotiated terms remain on the school's own
// Plan & Billing tab (audited there); this page defines what every
// school purchases FROM.
//
// THE FOUR ACTIONS, NEVER CONFLATED (Phase 4):
//   1. Selecting a catalogue plan — school detail, Plan & billing.
//   2. Saving negotiated commercial terms — school detail terms dialog
//      (audited; NEVER activates anything).
//   3. Recording a verified payment — school detail Record payment.
//   4. Activating subscription access — follows VERIFIED money only.
// Saving pricing here or on a school NEVER activates a subscription.
// ============================================================

import React, { useCallback, useEffect, useState } from 'react'
import {
  AlertTriangle, CreditCard, FileSignature, Loader2, Package, RefreshCw,
  Settings2, ShieldCheck,
} from 'lucide-react'
import { platformApi, type PlatformApiError } from '../platform-client'
import { errMessage, money, type PlanRow } from './subscription-shared'
import { SubscriptionPendingBanner, isSubscriptionSchemaPending } from './pending-banner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { toast } from 'sonner'

interface SubsConfig {
  models: { school: { enabled: boolean }; student: { enabled: boolean }; manual: { enabled: boolean } }
  defaultBillingModel: string
  student: { defaultClaimWindowDays: number; defaultValidityMonths: number }
  school: { defaultGraceDays: number }
}

export function PlansModule() {
  const [plans, setPlans] = useState<PlanRow[]>([])
  const [config, setConfig] = useState<SubsConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<PlanRow | null>(null)
  const [saving, setSaving] = useState(false)
  const [archiveFor, setArchiveFor] = useState<PlanRow | null>(null)
  const [archiving, setArchiving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const d = await platformApi<{ subscriptionSchemaPending?: boolean; plans: PlanRow[]; config: SubsConfig }>(
        '/api/platform/subscriptions/plans',
      )
      setPlans(d.plans)
      setConfig(d.config)
      setPending(isSubscriptionSchemaPending(d))
    } catch (e) {
      setError(errMessage(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const saveConfig = async (patch: Record<string, unknown>) => {
    setSaving(true)
    try {
      await platformApi('/api/platform/subscriptions/config', { method: 'PATCH', body: JSON.stringify(patch) })
      toast.success('Configuration saved')
      void load()
    } catch (e) {
      toast.error('Config save failed', { description: errMessage(e) })
    } finally {
      setSaving(false)
    }
  }

  const archive = async (id: string) => {
    setArchiving(true)
    try {
      await platformApi(`/api/platform/subscriptions/plans/${id}`, { method: 'DELETE' })
      toast.success('Plan archived')
      setArchiveFor(null)
      void load()
    } catch (e) {
      toast.error('Archive failed', { description: errMessage(e) })
    } finally {
      setArchiving(false)
    }
  }

  const scopeLabel = (scope: string): string =>
    scope === 'SCHOOL' ? 'School-wide (A)' : scope === 'STAFF' ? 'Staff seats' : 'Per student (B/C)'

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-xl sm:text-2xl font-bold tracking-tight text-slate-900">Plans &amp; Pricing</h1>
        <p className="mt-1 text-sm text-slate-500">
          The plan catalogue and commercial rules. Saving pricing never activates a subscription — activation follows verified money only.
        </p>
      </div>

      {pending && <SubscriptionPendingBanner />}

      {/* The four-step contract — compact explainer, no repeated cards */}
      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm" aria-labelledby="plans-flow-heading">
        <h2 id="plans-flow-heading" className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
          <ShieldCheck className="h-4 w-4 text-teal-600" aria-hidden="true" />How a school becomes active
        </h2>
        <ol className="mt-2 grid gap-2 text-xs text-slate-600 sm:grid-cols-4">
          <li className="rounded-lg border border-slate-200 p-2.5"><span className="font-semibold text-slate-800">1 · Select plan</span><br />On the school&apos;s Plan &amp; billing tab.</li>
          <li className="rounded-lg border border-slate-200 p-2.5"><span className="font-semibold text-slate-800">2 · Negotiate terms</span><br />Per-school price/quantity — audited, never activates.</li>
          <li className="rounded-lg border border-slate-200 p-2.5"><span className="font-semibold text-slate-800">3 · Record payment</span><br />Verified offline payment or gateway capture.</li>
          <li className="rounded-lg border border-slate-200 p-2.5"><span className="font-semibold text-slate-800">4 · Access activates</span><br />Follows the verified paid period, never the price edit.</li>
        </ol>
      </section>

      {/* Commercial-model config — always served (pre-migration settings) */}
      {config && (
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm" aria-labelledby="plans-config-heading">
          <h3 id="plans-config-heading" className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
            <Settings2 className="h-4 w-4" aria-hidden="true" />Commercial models
          </h3>
          <p className="mt-0.5 text-xs text-slate-500">Which subscription models are offered. New schools default to the selected billing model.</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            {(['school', 'student', 'manual'] as const).map((k) => (
              <div key={k} className="flex items-center justify-between rounded-lg border border-slate-200 p-3">
                <div>
                  <div className="text-sm font-medium text-slate-900 capitalize">{k === 'school' ? 'Per-school (A)' : k === 'student' ? 'Per-student (B)' : 'Manual (C)'}</div>
                  <div className="text-xs text-slate-500">{k === 'school' ? 'monthly / annual' : k === 'student' ? 'annual per student' : 'operator-assigned'}</div>
                </div>
                <Switch
                  checked={config.models[k].enabled}
                  disabled={saving}
                  onCheckedChange={(v) => void saveConfig({ models: { ...config.models, [k]: { enabled: v } } })}
                />
              </div>
            ))}
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <div className="flex items-center justify-between rounded-lg border border-slate-200 p-3">
              <div className="text-sm text-slate-700">Default billing model</div>
              <Select value={config.defaultBillingModel} onValueChange={(v) => void saveConfig({ defaultBillingModel: v })}>
                <SelectTrigger className="h-9 w-[170px] border-slate-300 bg-white" aria-label="Default billing model"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {['SCHOOL_WIDE', 'PER_STUDENT', 'MIXED'].map((m) => <SelectItem key={m} value={m}>{m.replace(/_/g, ' ')}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-slate-200 p-3">
              <div className="text-sm text-slate-700">Student claim window</div>
              <Input className="h-9 w-20 border-slate-300 bg-white" type="number" min="1" max="365" defaultValue={config.student.defaultClaimWindowDays}
                onBlur={(e) => { const v = Number(e.target.value); if (v !== config.student.defaultClaimWindowDays) void saveConfig({ student: { ...config.student, defaultClaimWindowDays: v } }) }}
                aria-label="Student claim window in days" />
            </div>
            <div className="flex items-center justify-between rounded-lg border border-slate-200 p-3">
              <div className="text-sm text-slate-700">Student validity (months)</div>
              <Input className="h-9 w-20 border-slate-300 bg-white" type="number" min="1" max="36" defaultValue={config.student.defaultValidityMonths}
                onBlur={(e) => { const v = Number(e.target.value); if (v !== config.student.defaultValidityMonths) void saveConfig({ student: { ...config.student, defaultValidityMonths: v } }) }}
                aria-label="Student entitlement validity in months" />
            </div>
          </div>
        </section>
      )}

      {/* Plan registry */}
      <section className="space-y-2" aria-labelledby="plans-registry-heading">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id="plans-registry-heading" className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
            <Package className="h-4 w-4" aria-hidden="true" />Plan registry
          </h3>
          <Button
            size="sm"
            onClick={() => setCreating(true)}
            disabled={pending}
            title={pending ? 'The plan registry is created by the pending subscription-system migration — new plans become available once it is applied.' : undefined}
            className="bg-teal-600 font-semibold text-white hover:bg-teal-700"
          >
            <CreditCard className="h-4 w-4" aria-hidden="true" />New plan
          </Button>
        </div>

        {loading ? (
          <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="space-y-3 p-4">
              {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full bg-slate-200" />)}
            </div>
          </div>
        ) : error ? (
          <div role="alert" className="flex flex-col gap-2 rounded-xl border border-red-200 bg-red-50 p-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-red-600">Could not load the plan registry: {error}</p>
            <Button variant="outline" size="sm" onClick={() => void load()} className="border-slate-300 bg-white text-slate-700">
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />Retry
            </Button>
          </div>
        ) : plans.length === 0 ? (
          pending ? (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center">
              <p className="text-sm font-medium text-slate-600">Plan registry is not provisioned on this database yet.</p>
              <p className="mt-1 text-xs text-slate-500">Plans are stored in a table created by the pending subscription-system migration. Commercial-model configuration above remains fully available.</p>
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center">
              <p className="text-sm font-medium text-slate-600">No plans configured yet.</p>
              <p className="mt-1 text-xs text-slate-500">Create the first plan schools can purchase.</p>
            </div>
          )
        ) : (
          <>
            <div className="hidden overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm md:block">
              <table className="w-full min-w-[860px] text-sm">
                <caption className="sr-only">The plan registry with scope, billing model, price, policies and availability</caption>
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th scope="col" className="px-3 py-2.5">Plan</th>
                    <th scope="col" className="px-3 py-2.5">Audience &amp; scope</th>
                    <th scope="col" className="px-3 py-2.5">Billing</th>
                    <th scope="col" className="px-3 py-2.5">Price</th>
                    <th scope="col" className="px-3 py-2.5">Policies</th>
                    <th scope="col" className="px-3 py-2.5">Availability</th>
                    <th scope="col" className="px-3 py-2.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {plans.map((p) => (
                    <tr key={p.id} className="border-t border-slate-100 hover:bg-slate-50/60">
                      <td className="px-3 py-2.5 font-medium text-slate-900">
                        {p.name}
                        <div className="font-mono text-xs text-slate-500">{p.code}</div>
                        {p.description && <div className="mt-0.5 max-w-[240px] truncate text-xs text-slate-500" title={p.description}>{p.description}</div>}
                      </td>
                      <td className="px-3 py-2.5 text-xs text-slate-600">
                        <Badge variant="outline">{scopeLabel(p.scope)}</Badge>
                        {p.scope === 'STAFF' && <div className="mt-1">per-seat entitlement</div>}
                      </td>
                      <td className="px-3 py-2.5 text-xs text-slate-600">{p.interval.toLowerCase()}</td>
                      <td className="px-3 py-2.5 text-slate-700">
                        {p.scope === 'STUDENT' || p.scope === 'STAFF' ? money(p.pricePerStudent, p.currency) : p.interval === 'MONTHLY' ? `${money(p.priceMonthly, p.currency)}/mo` : `${money(p.priceAnnual, p.currency)}/yr`}
                      </td>
                      <td className="px-3 py-2.5 text-xs text-slate-600">
                        {p.allowOnline ? 'online' : '—'} · {p.allowOffline ? 'offline' : '—'} · grace {p.graceDays}d
                      </td>
                      <td className="px-3 py-2.5 text-xs text-slate-600">
                        <Badge variant="outline" className={p.status === 'ACTIVE' ? 'border-emerald-300 text-emerald-700' : ''}>{p.status}</Badge>
                        {p.availableForNew ? ' new' : ''}{p.availableForRenewal ? ' renewal' : ''}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        {p.status === 'ACTIVE' ? (
                          <div className="flex items-center justify-end gap-2">
                            <Button size="sm" variant="outline" className="border-slate-300 text-slate-700" onClick={() => setEditing(p)}>Edit</Button>
                            <Button size="sm" variant="outline" className="border-slate-300 text-slate-700" onClick={() => setArchiveFor(p)} aria-label={`Archive plan ${p.code}`}>Archive</Button>
                          </div>
                        ) : (
                          <span className="text-xs text-slate-400" title="Archive is irreversible — create a successor plan instead">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile plan cards */}
            <div className="space-y-2 md:hidden">
              {plans.map((p) => (
                <div key={p.id} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-900">{p.name}</p>
                      <p className="font-mono text-xs text-slate-500">{p.code}</p>
                    </div>
                    <Badge variant="outline" className={p.status === 'ACTIVE' ? 'border-emerald-300 text-emerald-700' : ''}>{p.status}</Badge>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
                    <span>{p.scope === 'STUDENT' || p.scope === 'STAFF' ? money(p.pricePerStudent, p.currency) : p.interval === 'MONTHLY' ? `${money(p.priceMonthly, p.currency)}/mo` : `${money(p.priceAnnual, p.currency)}/yr`}</span>
                    <span>{scopeLabel(p.scope)} · {p.interval.toLowerCase()}</span>
                    <span>grace {p.graceDays}d</span>
                  </div>
                  <div className="mt-1.5 text-xs text-slate-500">
                    {p.availableForNew ? 'new' : '—'} · {p.availableForRenewal ? 'renewal' : '—'} · {p.allowOnline ? 'online' : '—'} · {p.allowOffline ? 'offline' : '—'}
                  </div>
                  {p.status === 'ACTIVE' ? (
                    <div className="mt-2 flex gap-2">
                      <Button size="sm" variant="outline" className="flex-1 border-slate-300 text-slate-700" onClick={() => setEditing(p)}>Edit</Button>
                      <Button size="sm" variant="outline" className="flex-1 border-slate-300 text-slate-700" onClick={() => setArchiveFor(p)} aria-label={`Archive plan ${p.code}`}>Archive</Button>
                    </div>
                  ) : (
                    <p className="mt-2 text-xs text-slate-400">Archived — irreversible; create a successor plan to replace it.</p>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </section>

      {creating && <PlanCreateDialog onClose={() => setCreating(false)} onCreated={() => { setCreating(false); void load() }} />}
      {editing && (
        <PlanEditDialog
          plan={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); void load() }}
        />
      )}

      <AlertDialog open={archiveFor !== null} onOpenChange={(o) => { if (!o && !archiving) setArchiveFor(null) }}>
        <AlertDialogContent className="border-slate-200 bg-white text-slate-900 sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 font-display text-red-700">
              <AlertTriangle className="h-4 w-4" aria-hidden="true" />
              Archive plan {archiveFor?.code}?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-slate-500">
              Historical purchases keep their snapshots. Archived plans cannot be edited or purchased — archive is
              irreversible; create a successor plan to replace it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setArchiveFor(null)} disabled={archiving} className="h-11 border-slate-300 bg-transparent text-slate-700 hover:bg-slate-100 focus-ring">
              Cancel
            </Button>
            <Button
              onClick={() => { if (archiveFor) void archive(archiveFor.id) }}
              disabled={archiving}
              className="h-11 bg-red-600 font-semibold text-white hover:bg-red-500 focus-ring"
            >
              {archiving && <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-label="Archiving plan" />}
              {archiving ? 'Archiving…' : 'Archive plan'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function PlanCreateDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [saving, setSaving] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitPending, setSubmitPending] = useState(false)
  const [form, setForm] = useState({
    code: '', name: '', description: '', scope: 'STUDENT', interval: 'ANNUAL',
    price: '', currency: 'INR', graceDays: '14', allowOnline: true, allowOffline: true,
    availableForNew: true, availableForRenewal: true, sortOrder: '0',
  })

  const submit = async () => {
    setSaving(true)
    setSubmitError(null)
    setSubmitPending(false)
    try {
      await platformApi('/api/platform/subscriptions/plans', {
        method: 'POST',
        body: JSON.stringify({
          code: form.code.toUpperCase().trim(),
          name: form.name.trim(),
          description: form.description.trim() || undefined,
          scope: form.scope,
          interval: form.interval,
          ...(form.scope === 'STUDENT'
            ? { pricePerStudent: Number(form.price || 0) }
            : form.interval === 'MONTHLY'
              ? { priceMonthly: Number(form.price || 0) }
              : { priceAnnual: Number(form.price || 0) }),
          currency: form.currency,
          graceDays: Number(form.graceDays || 14),
          allowOnline: form.allowOnline,
          allowOffline: form.allowOffline,
          availableForNew: form.availableForNew,
          availableForRenewal: form.availableForRenewal,
          sortOrder: Number(form.sortOrder || 0),
        }),
      })
      toast.success(`Plan ${form.code.toUpperCase()} created`)
      onCreated()
    } catch (e) {
      const code = (e as PlatformApiError)?.code
      setSubmitPending(code === 'SUBSCRIPTION_SYSTEM_PENDING')
      setSubmitError(errMessage(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><FileSignature className="h-4 w-4 text-teal-600" aria-hidden="true" />New plan</DialogTitle>
          <DialogDescription>Prices are the platform&apos;s product prices — schools see them at renewal; students see student-scope plans.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          {submitError && (
            <div role="alert" className={`rounded-lg border p-3 text-sm ${submitPending ? 'border-amber-300 bg-amber-50 text-amber-800' : 'border-red-200 bg-red-50 text-red-700'}`}>
              {submitPending ? 'Plan creation is unavailable on this database: ' : 'Plan creation failed: '}
              {submitError}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div><Label className="text-xs" htmlFor="plan-code">Code</Label><Input id="plan-code" className="border-slate-300 bg-white" value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} placeholder="STUDENT-ANNUAL" /></div>
            <div><Label className="text-xs" htmlFor="plan-name">Name</Label><Input id="plan-name" className="border-slate-300 bg-white" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Student Annual" /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs" htmlFor="plan-scope">Audience &amp; scope</Label>
              <Select value={form.scope} onValueChange={(v) => setForm((f) => ({ ...f, scope: v, interval: v === 'STUDENT' ? 'ANNUAL' : f.interval }))}>
                <SelectTrigger id="plan-scope" className="border-slate-300 bg-white"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="SCHOOL">SCHOOL (Model A)</SelectItem><SelectItem value="STUDENT">STUDENT (Model B/C)</SelectItem><SelectItem value="STAFF">STAFF (per-seat)</SelectItem></SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs" htmlFor="plan-interval">Interval</Label>
              <Select value={form.interval} onValueChange={(v) => setForm((f) => ({ ...f, interval: v }))} disabled={form.scope === 'STUDENT' || form.scope === 'STAFF'}>
                <SelectTrigger id="plan-interval" className="border-slate-300 bg-white"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="MONTHLY">MONTHLY</SelectItem><SelectItem value="ANNUAL">ANNUAL</SelectItem></SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div><Label className="text-xs" htmlFor="plan-price">{form.scope === 'STUDENT' || form.scope === 'STAFF' ? 'Per-seat price' : form.interval === 'MONTHLY' ? 'Monthly price' : 'Annual price'}</Label><Input id="plan-price" className="border-slate-300 bg-white" type="number" min="0" value={form.price} onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))} /></div>
            <div>
              <Label className="text-xs" htmlFor="plan-currency">Currency</Label>
              <Select value={form.currency} onValueChange={(v) => setForm((f) => ({ ...f, currency: v }))}>
                <SelectTrigger id="plan-currency" className="border-slate-300 bg-white"><SelectValue /></SelectTrigger>
                <SelectContent>{['INR', 'USD', 'EUR', 'GBP', 'AED'].map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label className="text-xs" htmlFor="plan-grace">Grace days</Label><Input id="plan-grace" className="border-slate-300 bg-white" type="number" min="0" max="90" value={form.graceDays} onChange={(e) => setForm((f) => ({ ...f, graceDays: e.target.value }))} /></div>
          </div>
          <div><Label className="text-xs" htmlFor="plan-description">Description</Label><Textarea id="plan-description" className="border-slate-300 bg-white" rows={2} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} /></div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="flex items-center justify-between rounded-lg border border-slate-200 p-2.5"><span className="text-sm text-slate-700">Allow online payment</span><Switch aria-label="Allow online payment" checked={form.allowOnline} onCheckedChange={(v) => setForm((f) => ({ ...f, allowOnline: v }))} /></div>
            <div className="flex items-center justify-between rounded-lg border border-slate-200 p-2.5"><span className="text-sm text-slate-700">Allow offline payment</span><Switch aria-label="Allow offline payment" checked={form.allowOffline} onCheckedChange={(v) => setForm((f) => ({ ...f, allowOffline: v }))} /></div>
            <div className="flex items-center justify-between rounded-lg border border-slate-200 p-2.5"><span className="text-sm text-slate-700">Available for new</span><Switch aria-label="Available for new" checked={form.availableForNew} onCheckedChange={(v) => setForm((f) => ({ ...f, availableForNew: v }))} /></div>
            <div className="flex items-center justify-between rounded-lg border border-slate-200 p-2.5"><span className="text-sm text-slate-700">Available for renewal</span><Switch aria-label="Available for renewal" checked={form.availableForRenewal} onCheckedChange={(v) => setForm((f) => ({ ...f, availableForRenewal: v }))} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={onClose} className="border-slate-300 bg-white text-slate-700">Cancel</Button>
            <Button onClick={() => void submit()} disabled={saving} className="bg-teal-600 font-semibold text-white hover:bg-teal-700">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}Create plan
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Edit an ACTIVE plan — PATCH /api/platform/subscriptions/plans/[id].
 * Mirrors PlanCreateDialog's field layout, styles and error surface so
 * the two dialogs read as one control. `code` and `scope` are immutable
 * server-side and render as read-only text, not inputs. ARCHIVED plans
 * are refused server-side with 409 CONFLICT — surfaced honestly here.
 */
function PlanEditDialog({ plan, onClose, onSaved }: { plan: PlanRow; onClose: () => void; onSaved: () => void }) {
  const [saving, setSaving] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitPending, setSubmitPending] = useState(false)
  const [form, setForm] = useState(() => ({
    name: plan.name,
    description: plan.description ?? '',
    interval: plan.interval,
    price: plan.scope === 'STUDENT' || plan.scope === 'STAFF'
      ? (plan.pricePerStudent?.toString() ?? '')
      : plan.interval === 'MONTHLY'
        ? (plan.priceMonthly?.toString() ?? '')
        : (plan.priceAnnual?.toString() ?? ''),
    currency: plan.currency,
    graceDays: String(plan.graceDays),
    allowOnline: plan.allowOnline,
    allowOffline: plan.allowOffline,
    availableForNew: plan.availableForNew,
    availableForRenewal: plan.availableForRenewal,
  }))

  const validate = (): string | null => {
    if (form.name.trim().length < 2 || form.name.trim().length > 80) return 'Name must be 2–80 characters.'
    if (form.description.length > 400) return 'Description must be 400 characters or fewer.'
    const grace = Number(form.graceDays)
    if (form.graceDays.trim() === '' || !Number.isInteger(grace) || grace < 0 || grace > 90) return 'Grace days must be 0–90.'
    if (form.price.trim() === '') {
      if (plan.scope === 'STUDENT') return 'Student plans need a per-student annual price.'
      if (plan.scope === 'STAFF') return 'Staff plans need a per-seat annual price.'
      return form.interval === 'MONTHLY' ? 'Monthly price is required for this plan.' : 'Annual price is required for this plan.'
    }
    const price = Number(form.price)
    if (!(price > 0) || price > 100_000_000) return 'Price must be greater than zero and under 100,000,000.'
    return null
  }

  const submit = async () => {
    const problem = validate()
    if (problem) {
      setSubmitPending(false)
      setSubmitError(problem)
      return
    }
    setSaving(true)
    setSubmitError(null)
    setSubmitPending(false)
    try {
      const price = form.price.trim() === '' ? null : Number(form.price)
      await platformApi(`/api/platform/subscriptions/plans/${plan.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: form.name.trim(),
          description: form.description.trim() || null,
          interval: form.interval,
          ...(plan.scope === 'STUDENT' || plan.scope === 'STAFF'
            ? { pricePerStudent: price }
            : {
                priceMonthly: form.interval === 'MONTHLY' ? price : plan.priceMonthly,
                priceAnnual: form.interval === 'ANNUAL' ? price : plan.priceAnnual,
              }),
          currency: form.currency,
          graceDays: Number(form.graceDays),
          allowOnline: form.allowOnline,
          allowOffline: form.allowOffline,
          availableForNew: form.availableForNew,
          availableForRenewal: form.availableForRenewal,
        }),
      })
      toast.success(`Plan ${plan.code} updated`)
      onSaved()
    } catch (e) {
      const code = (e as PlatformApiError)?.code
      setSubmitPending(code === 'SUBSCRIPTION_SYSTEM_PENDING')
      setSubmitError(errMessage(e))
      toast.error('Plan update failed', { description: errMessage(e) })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit plan — {plan.code}</DialogTitle>
          <DialogDescription>Code and scope are fixed — purchase snapshots reference them. Everything else updates in place.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          {submitError && (
            <div role="alert" className={`rounded-lg border p-3 text-sm ${submitPending ? 'border-amber-300 bg-amber-50 text-amber-800' : 'border-red-200 bg-red-50 text-red-700'}`}>
              {submitPending ? 'Plan editing is unavailable on this database: ' : 'Plan update failed: '}
              {submitError}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs" htmlFor="plan-edit-code">Code</Label>
              <div
                id="plan-edit-code"
                title="Immutable — purchase snapshots reference the plan code"
                className="flex h-9 items-center overflow-hidden rounded-md border border-slate-200 bg-slate-50 px-3 font-mono text-sm text-slate-700"
              >
                {plan.code}
              </div>
            </div>
            <div><Label className="text-xs" htmlFor="plan-edit-name">Name</Label><Input id="plan-edit-name" className="border-slate-300 bg-white" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Student Annual" /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs" htmlFor="plan-edit-scope">Audience &amp; scope</Label>
              <div
                id="plan-edit-scope"
                title="Immutable — the commercial model is fixed at creation"
                className="flex h-9 items-center overflow-hidden rounded-md border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700"
              >
                {plan.scope === 'SCHOOL' ? 'SCHOOL (Model A)' : plan.scope === 'STAFF' ? 'STAFF (per-seat)' : 'STUDENT (Model B/C)'}
              </div>
            </div>
            <div>
              <Label className="text-xs" htmlFor="plan-edit-interval">Interval</Label>
              <Select value={form.interval} onValueChange={(v) => setForm((f) => ({ ...f, interval: v }))} disabled={plan.scope === 'STUDENT' || plan.scope === 'STAFF'}>
                <SelectTrigger id="plan-edit-interval" className="border-slate-300 bg-white"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="MONTHLY">MONTHLY</SelectItem><SelectItem value="ANNUAL">ANNUAL</SelectItem></SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div><Label className="text-xs" htmlFor="plan-edit-price">{plan.scope === 'STUDENT' || plan.scope === 'STAFF' ? 'Per-seat price' : form.interval === 'MONTHLY' ? 'Monthly price' : 'Annual price'}</Label><Input id="plan-edit-price" className="border-slate-300 bg-white" type="number" min="0" value={form.price} onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))} /></div>
            <div>
              <Label className="text-xs" htmlFor="plan-edit-currency">Currency</Label>
              <Select value={form.currency} onValueChange={(v) => setForm((f) => ({ ...f, currency: v }))}>
                <SelectTrigger id="plan-edit-currency" className="border-slate-300 bg-white"><SelectValue /></SelectTrigger>
                <SelectContent>{['INR', 'USD', 'EUR', 'GBP', 'AED'].map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label className="text-xs" htmlFor="plan-edit-grace">Grace days</Label><Input id="plan-edit-grace" className="border-slate-300 bg-white" type="number" min="0" max="90" value={form.graceDays} onChange={(e) => setForm((f) => ({ ...f, graceDays: e.target.value }))} /></div>
          </div>
          <div><Label className="text-xs" htmlFor="plan-edit-description">Description</Label><Textarea id="plan-edit-description" className="border-slate-300 bg-white" rows={2} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} /></div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="flex items-center justify-between rounded-lg border border-slate-200 p-2.5"><span className="text-sm text-slate-700">Allow online payment</span><Switch aria-label="Allow online payment" checked={form.allowOnline} onCheckedChange={(v) => setForm((f) => ({ ...f, allowOnline: v }))} /></div>
            <div className="flex items-center justify-between rounded-lg border border-slate-200 p-2.5"><span className="text-sm text-slate-700">Allow offline payment</span><Switch aria-label="Allow offline payment" checked={form.allowOffline} onCheckedChange={(v) => setForm((f) => ({ ...f, allowOffline: v }))} /></div>
            <div className="flex items-center justify-between rounded-lg border border-slate-200 p-2.5"><span className="text-sm text-slate-700">Available for new</span><Switch aria-label="Available for new" checked={form.availableForNew} onCheckedChange={(v) => setForm((f) => ({ ...f, availableForNew: v }))} /></div>
            <div className="flex items-center justify-between rounded-lg border border-slate-200 p-2.5"><span className="text-sm text-slate-700">Available for renewal</span><Switch aria-label="Available for renewal" checked={form.availableForRenewal} onCheckedChange={(v) => setForm((f) => ({ ...f, availableForRenewal: v }))} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={onClose} className="border-slate-300 bg-white text-slate-700">Cancel</Button>
            <Button onClick={() => void submit()} disabled={saving} className="bg-teal-600 font-semibold text-white hover:bg-teal-700">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}Save changes
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  )
}
