'use client'

// ============================================================
// SubscriptionsModule — /platform/subscriptions (control plane)
// ------------------------------------------------------------
// SUBSCRIPTION & ENTITLEMENT SYSTEM operations center:
//   · Registry    — every tenant subscription (computed states,
//                   billing model, plan, expiry, renewal payments)
//                   + student entitlement aggregate + diagnostics.
//   · Students    — Model B/C workspace: pick a school, search
//                   students, assign per-student entitlements
//                   (offline/complimentary), issue + reissue
//                   activation codes, revoke/suspend, view history.
//   · Plans       — the commercial plan registry (Model A/B
//                   prices, policies, availability) + the global
//                   model switches (config).
// All actions are billing.manage-gated server-side; COMPLIMENTARY
// additionally requires billing.complimentary AND an audit note
// (≥10 chars) — both enforced server-side; this UI only sends the
// fields, never trusting client-side gating.
// iPad/tablet-friendly: tables scroll horizontally with sticky
// actions; dialogs are scrollable; nothing essential is truncated.
// ============================================================

import React, { useCallback, useEffect, useState } from 'react'
import {
  BookMarked, Building2, CalendarClock, CreditCard, KeyRound,
  Loader2, Package, RefreshCw, Search, Settings2, ShieldAlert, Users,
} from 'lucide-react'
import { platformApi } from '../platform-client'
import {
  StateBadge, errMessage, money, dateStr,
  AssignEntitlementDialog, StudentHistoryDialog,
  type StudentRow, type PlanRow, type RegistryRow,
} from './subscription-shared'
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
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { toast } from 'sonner'

// ── types ──────────────────────────────────────────────────────────────

interface SubsConfig {
  models: { school: { enabled: boolean }; student: { enabled: boolean }; manual: { enabled: boolean } }
  defaultBillingModel: string
  student: { defaultClaimWindowDays: number; defaultValidityMonths: number }
  school: { defaultGraceDays: number }
}
interface SchoolOption { id: string; name: string; slug: string }


// ── module ─────────────────────────────────────────────────────────────

export function SubscriptionsModule() {
  const [tab, setTab] = useState('registry')
  const [loading, setLoading] = useState(true)

  const [registry, setRegistry] = useState<{
    schools: { rows: RegistryRow[]; total: number }
    students: { rows: Array<{ entitlementId: string; school: SchoolOption; student: { id: string; admissionNo: string | null; user: { name: string | null; email: string } }; planCode: string | null; status: string; computedState: string; validityStart: string; validityEnd: string; source: string; revokeReason: string | null }> }
    summary: { studentEntitlements: Record<string, number>; orders: Record<string, number>; rejectedClaims: number; subscriptionsExpiringWithin30Days: number }
  } | null>(null)
  const [plans, setPlans] = useState<PlanRow[]>([])
  const [config, setConfig] = useState<SubsConfig | null>(null)
  const [query, setQuery] = useState('')

  const load = useCallback(async (q = query) => {
    setLoading(true)
    try {
      const [reg, pl] = await Promise.all([
        platformApi<typeof registry>(`/api/platform/subscriptions/registry?q=${encodeURIComponent(q)}&pageSize=50`),
        platformApi<{ plans: PlanRow[]; config: SubsConfig }>('/api/platform/subscriptions/plans'),
      ])
      setRegistry(reg)
      setPlans(pl.plans)
      setConfig(pl.config)
    } catch (e) {
      toast.error('Could not load subscriptions', { description: errMessage(e) })
    } finally {
      setLoading(false)
    }
  }, [query])

  useEffect(() => { void load() /* eslint-disable-line react-hooks/exhaustive-deps */ }, [])

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Subscriptions</h1>
        <p className="text-sm text-muted-foreground">
          Commercial models, plans, per-student entitlements, activation codes and payment reconciliation.
        </p>
      </header>

      {registry && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <SummaryCard icon={<Building2 className="h-4 w-4" />} label="Tenants" value={String(registry.schools.total)} />
          <SummaryCard icon={<CalendarClock className="h-4 w-4" />} label="Expiring ≤30d" value={String(registry.summary.subscriptionsExpiringWithin30Days)} />
          <SummaryCard icon={<Users className="h-4 w-4" />} label="Active students" value={String((registry.summary.studentEntitlements?.ACTIVE ?? 0))} />
          <SummaryCard icon={<BookMarked className="h-4 w-4" />} label="Pending" value={String(registry.summary.studentEntitlements?.PENDING ?? 0)} />
          <SummaryCard icon={<Package className="h-4 w-4" />} label="Paid orders" value={String(registry.summary.orders?.PAID ?? 0)} />
          <SummaryCard icon={<ShieldAlert className="h-4 w-4" />} label="Rejected claims" value={String(registry.summary.rejectedClaims)} />
        </div>
      )}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex h-auto w-full flex-wrap">
          <TabsTrigger value="registry"><Building2 className="mr-1 h-4 w-4" />Registry</TabsTrigger>
          <TabsTrigger value="students"><Users className="mr-1 h-4 w-4" />Student entitlements</TabsTrigger>
          <TabsTrigger value="plans"><Package className="mr-1 h-4 w-4" />Plans &amp; models</TabsTrigger>
        </TabsList>

        <TabsContent value="registry" className="space-y-3">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search school name / slug / code…"
                className="pl-8"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void load() }}
              />
            </div>
            <Button variant="outline" onClick={() => void load()}><RefreshCw className="mr-1 h-4 w-4" />Refresh</Button>
          </div>
          {loading ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full min-w-[900px] text-sm">
                <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">School</th>
                    <th className="px-3 py-2">Model</th>
                    <th className="px-3 py-2">Plan</th>
                    <th className="px-3 py-2">Price</th>
                    <th className="px-3 py-2">Valid until</th>
                    <th className="px-3 py-2">State</th>
                    <th className="px-3 py-2">Payments</th>
                  </tr>
                </thead>
                <tbody>
                  {(registry?.schools.rows ?? []).map((r) => (
                    <tr key={r.subscriptionId} className="border-t hover:bg-muted/30">
                      <td className="px-3 py-2 font-medium">
                        {r.school.name}
                        {r.school.isDemo && <Badge variant="outline" className="ml-2 text-[10px]">demo</Badge>}
                        <div className="text-xs text-muted-foreground">{r.school.slug}</div>
                      </td>
                      <td className="px-3 py-2"><Badge variant="outline">{r.billingModel.replace(/_/g, ' ')}</Badge></td>
                      <td className="px-3 py-2">{r.planDef ? `${r.planDef.name}` : r.plan}{r.interval ? <div className="text-xs text-muted-foreground">{r.interval.toLowerCase()}</div> : null}</td>
                      <td className="px-3 py-2">{money(r.priceSnapshot, r.currencySnapshot)}</td>
                      <td className="px-3 py-2">{dateStr(r.periodEnd)}</td>
                      <td className="px-3 py-2"><StateBadge state={r.entitlement.state} /></td>
                      <td className="px-3 py-2">{r.paymentCount}</td>
                    </tr>
                  ))}
                  {(registry?.schools.rows.length ?? 0) === 0 && (
                    <tr><td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">No subscriptions match.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="students">
          <StudentEntitlementsTab onAssigned={() => void load()} />
        </TabsContent>

        <TabsContent value="plans">
          <PlansTab
            plans={plans}
            config={config}
            onChanged={() => void load()}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}

function SummaryCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="flex items-center gap-1.5 text-muted-foreground">{icon}<span className="text-xs">{label}</span></div>
      <div className="mt-1 text-xl font-bold">{value}</div>
    </div>
  )
}

// ── Students tab (Model B/C workspace) ────────────────────────────────

function StudentEntitlementsTab({ onAssigned }: { onAssigned: () => void }) {
  const [schools, setSchools] = useState<SchoolOption[]>([])
  const [schoolId, setSchoolId] = useState('')
  const [students, setStudents] = useState<StudentRow[]>([])
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(false)
  const [assignFor, setAssignFor] = useState<StudentRow | null>(null)
  const [detailFor, setDetailFor] = useState<StudentRow | null>(null)

  useEffect(() => {
    platformApi<{ schools: Array<{ id: string; name: string; slug: string }> }>('/api/platform/schools?pageSize=200')
      .then((d) => setSchools(d.schools.map((s) => ({ id: s.id, name: s.name, slug: s.slug }))))
      .catch((e) =>
        toast.error('Could not load the school list', {
          description:
            (errMessage(e) || '').includes('permission') || (errMessage(e) || '').includes('403')
              ? `${errMessage(e)} — the student workspace additionally requires the schools.read permission for the school picker.`
              : errMessage(e),
        }),
      )
  }, [])

  const loadStudents = useCallback(async (sid: string, query2 = '') => {
    if (!sid) return
    setLoading(true)
    try {
      const d = await platformApi<{ school: { billingModel: string }; students: StudentRow[] }>(
        `/api/platform/schools/${sid}/students?q=${encodeURIComponent(query2)}&pageSize=50`,
      )
      setStudents(d.students)
    } catch (e) {
      toast.error('Could not load students', { description: errMessage(e) })
    } finally {
      setLoading(false)
    }
  }, [])

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[220px] flex-1">
          <Label className="text-xs">School</Label>
          <Select value={schoolId} onValueChange={(v) => { setSchoolId(v); void loadStudents(v) }}>
            <SelectTrigger><SelectValue placeholder="Select school…" /></SelectTrigger>
            <SelectContent>
              {schools.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="relative min-w-[200px] flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search name / admission no…"
            className="pl-8"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && schoolId) void loadStudents(schoolId, q) }}
            disabled={!schoolId}
          />
        </div>
        <Button variant="outline" disabled={!schoolId} onClick={() => void loadStudents(schoolId, q)}>
          <RefreshCw className="mr-1 h-4 w-4" />Search
        </Button>
      </div>

      {loading ? (
        <Skeleton className="h-64 w-full" />
      ) : !schoolId ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">Select a school to manage student entitlements.</div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Student</th>
                <th className="px-3 py-2">Class</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Valid until</th>
                <th className="px-3 py-2">Source</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {students.map((s) => (
                <tr key={s.studentId} className="border-t hover:bg-muted/30">
                  <td className="px-3 py-2 font-medium">
                    {s.name}
                    {s.accountLocked && <Badge variant="outline" className="ml-2 text-[10px]">account locked</Badge>}
                    <div className="text-xs text-muted-foreground">{s.email}</div>
                  </td>
                  <td className="px-3 py-2">{s.class ?? '—'}</td>
                  <td className="px-3 py-2"><StateBadge state={s.entitlement.computedState} /></td>
                  <td className="px-3 py-2">{dateStr(s.entitlement.validityEnd ?? null)}</td>
                  <td className="px-3 py-2 text-xs">{s.entitlement.source ?? '—'}</td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="outline" onClick={() => setDetailFor(s)}>History</Button>
                      <Button size="sm" onClick={() => setAssignFor(s)}>
                        <KeyRound className="mr-1 h-3.5 w-3.5" />Assign
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
              {students.length === 0 && (
                <tr><td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">No students match.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {assignFor && (
        <AssignEntitlementDialog
          student={assignFor}
          onClose={() => setAssignFor(null)}
          onDone={() => { setAssignFor(null); void loadStudents(schoolId, q); onAssigned() }}
        />
      )}
      {detailFor && (
        <StudentHistoryDialog student={detailFor} onClose={() => setDetailFor(null)} />
      )}
    </div>
  )
}



// ── Plans & models tab ─────────────────────────────────────────────────


function PlansTab({ plans, config, onChanged }: { plans: PlanRow[]; config: SubsConfig | null; onChanged: () => void }) {
  const [saving, setSaving] = useState(false)
  const [creating, setCreating] = useState(false)

  const saveConfig = async (patch: Record<string, unknown>) => {
    setSaving(true)
    try {
      await platformApi('/api/platform/subscriptions/config', { method: 'PATCH', body: JSON.stringify(patch) })
      toast.success('Configuration saved')
      onChanged()
    } catch (e) {
      toast.error('Config save failed', { description: errMessage(e) })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      {config && (
        <section className="rounded-lg border p-4">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold"><Settings2 className="h-4 w-4" />Commercial models</h3>
          <p className="text-xs text-muted-foreground">Which subscription models are offered. New schools default to the selected billing model.</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            {(['school', 'student', 'manual'] as const).map((k) => (
              <div key={k} className="flex items-center justify-between rounded-lg border p-3">
                <div>
                  <div className="text-sm font-medium capitalize">{k === 'school' ? 'Per-school (A)' : k === 'student' ? 'Per-student (B)' : 'Manual (C)'}</div>
                  <div className="text-xs text-muted-foreground">{k === 'school' ? 'monthly / annual' : k === 'student' ? 'annual per student' : 'operator-assigned'}</div>
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
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div className="text-sm">Default billing model</div>
              <Select value={config.defaultBillingModel} onValueChange={(v) => void saveConfig({ defaultBillingModel: v })}>
                <SelectTrigger className="w-[170px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {['SCHOOL_WIDE', 'PER_STUDENT', 'MIXED'].map((m) => <SelectItem key={m} value={m}>{m.replace(/_/g, ' ')}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div className="text-sm">Student claim window</div>
              <Input className="w-20" type="number" min="1" max="365" defaultValue={config.student.defaultClaimWindowDays}
                onBlur={(e) => { const v = Number(e.target.value); if (v !== config.student.defaultClaimWindowDays) void saveConfig({ student: { ...config.student, defaultClaimWindowDays: v } }) }} />
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div className="text-sm">Student validity (months)</div>
              <Input className="w-20" type="number" min="1" max="36" defaultValue={config.student.defaultValidityMonths}
                onBlur={(e) => { const v = Number(e.target.value); if (v !== config.student.defaultValidityMonths) void saveConfig({ student: { ...config.student, defaultValidityMonths: v } }) }} />
            </div>
          </div>
        </section>
      )}

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold"><Package className="h-4 w-4" />Plan registry</h3>
          <Button size="sm" onClick={() => setCreating(true)}><CreditCard className="mr-1 h-4 w-4" />New plan</Button>
        </div>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Plan</th><th className="px-3 py-2">Scope</th><th className="px-3 py-2">Price</th>
                <th className="px-3 py-2">Policies</th><th className="px-3 py-2">Availability</th><th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {plans.map((p) => (
                <tr key={p.id} className="border-t hover:bg-muted/30">
                  <td className="px-3 py-2 font-medium">{p.name}<div className="font-mono text-xs text-muted-foreground">{p.code}</div></td>
                  <td className="px-3 py-2"><Badge variant="outline">{p.scope}</Badge><div className="text-xs text-muted-foreground">{p.interval.toLowerCase()}</div></td>
                  <td className="px-3 py-2">
                    {p.scope === 'STUDENT' ? money(p.pricePerStudent, p.currency) : p.interval === 'MONTHLY' ? `${money(p.priceMonthly, p.currency)}/mo` : `${money(p.priceAnnual, p.currency)}/yr`}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {p.allowOnline ? 'online' : '—'} · {p.allowOffline ? 'offline' : '—'} · grace {p.graceDays}d
                  </td>
                  <td className="px-3 py-2 text-xs">
                    <Badge variant="outline" className={p.status === 'ACTIVE' ? 'border-emerald-300 text-emerald-700' : ''}>{p.status}</Badge>
                    {p.availableForNew ? ' new' : ''}{p.availableForRenewal ? ' renewal' : ''}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Button size="sm" variant="outline" onClick={() => { if (window.confirm(`Archive plan ${p.code}? Historical purchases keep their snapshots.`)) void archive(p.id) }}>Archive</Button>
                  </td>
                </tr>
              ))}
              {plans.length === 0 && <tr><td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">No plans configured yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {creating && <PlanCreateDialog onClose={() => setCreating(false)} onCreated={() => { setCreating(false); onChanged() }} />}
    </div>
  )

  async function archive(id: string) {
    try {
      await platformApi(`/api/platform/subscriptions/plans/${id}`, { method: 'DELETE' })
      toast.success('Plan archived')
      onChanged()
    } catch (e) {
      toast.error('Archive failed', { description: errMessage(e) })
    }
  }
}

function PlanCreateDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    code: '', name: '', description: '', scope: 'STUDENT', interval: 'ANNUAL',
    price: '', currency: 'INR', graceDays: '14', allowOnline: true, allowOffline: true,
    availableForNew: true, availableForRenewal: true, sortOrder: '0',
  })

  const submit = async () => {
    setSaving(true)
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
      toast.error('Plan creation failed', { description: errMessage(e) })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New plan</DialogTitle>
          <DialogDescription>Prices are the platform&apos;s product prices — schools see them at renewal; students see student-scope plans.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div><Label className="text-xs">Code</Label><Input value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} placeholder="STUDENT-ANNUAL" /></div>
            <div><Label className="text-xs">Name</Label><Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Student Annual" /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Scope</Label>
              <Select value={form.scope} onValueChange={(v) => setForm((f) => ({ ...f, scope: v, interval: v === 'STUDENT' ? 'ANNUAL' : f.interval }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="SCHOOL">SCHOOL (Model A)</SelectItem><SelectItem value="STUDENT">STUDENT (Model B/C)</SelectItem></SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Interval</Label>
              <Select value={form.interval} onValueChange={(v) => setForm((f) => ({ ...f, interval: v }))} disabled={form.scope === 'STUDENT'}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="MONTHLY">MONTHLY</SelectItem><SelectItem value="ANNUAL">ANNUAL</SelectItem></SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div><Label className="text-xs">{form.scope === 'STUDENT' ? 'Per-student price' : form.interval === 'MONTHLY' ? 'Monthly price' : 'Annual price'}</Label><Input type="number" min="0" value={form.price} onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))} /></div>
            <div>
              <Label className="text-xs">Currency</Label>
              <Select value={form.currency} onValueChange={(v) => setForm((f) => ({ ...f, currency: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{['INR', 'USD', 'EUR', 'GBP', 'AED'].map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label className="text-xs">Grace days</Label><Input type="number" min="0" max="90" value={form.graceDays} onChange={(e) => setForm((f) => ({ ...f, graceDays: e.target.value }))} /></div>
          </div>
          <div><Label className="text-xs">Description</Label><Textarea rows={2} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} /></div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="flex items-center justify-between rounded-lg border p-2.5"><span className="text-sm">Allow online payment</span><Switch checked={form.allowOnline} onCheckedChange={(v) => setForm((f) => ({ ...f, allowOnline: v }))} /></div>
            <div className="flex items-center justify-between rounded-lg border p-2.5"><span className="text-sm">Allow offline payment</span><Switch checked={form.allowOffline} onCheckedChange={(v) => setForm((f) => ({ ...f, allowOffline: v }))} /></div>
            <div className="flex items-center justify-between rounded-lg border p-2.5"><span className="text-sm">Available for new</span><Switch checked={form.availableForNew} onCheckedChange={(v) => setForm((f) => ({ ...f, availableForNew: v }))} /></div>
            <div className="flex items-center justify-between rounded-lg border p-2.5"><span className="text-sm">Available for renewal</span><Switch checked={form.availableForRenewal} onCheckedChange={(v) => setForm((f) => ({ ...f, availableForRenewal: v }))} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={() => void submit()} disabled={saving}>{saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}Create plan</Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  )
}
