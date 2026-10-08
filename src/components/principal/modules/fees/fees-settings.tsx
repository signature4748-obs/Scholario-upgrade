'use client'

/**
 * FeesSettingsSection — Fee Management module settings (FEE-SPECIFIC RULES
 * ONLY, Principal-first).
 *
 * The Principal reads this screen as "What can I control about fees?" —
 * short titles, live status, compact controls, minimal helper text. No
 * architecture descriptions, no routes, no implementation narration.
 *
 * What lives here is genuinely fee-specific POLICY:
 *
 *   1. Late Fee Rules        — per-month amount, grace period, max, scope
 *   2. Concession Rules      — sibling / staff ward / scholarship %
 *   3. One-Time Entry Fees   — compact applicability list + per-fee rule
 *                              builder (Everyone / Selected classes / Gender /
 *                              Classes + gender). Amounts stay canonical:
 *                              admission = the engine's own value; registration
 *                              = the published fee structures. The settings
 *                              card never creates a second amount source.
 *   4. Controlled-Edit Policy — the actual structure versioning behaviour
 *
 * Permission model (Super Admin → school capability → Principal):
 *   fee_entry_policy_manage grants the One-Time Entry Fee EDIT controls.
 *   Without it the Principal sees the live policy read-only — no editable
 *   controls, no misleading "request" actions. The store action enforces
 *   the same capability (defence in depth), matching every other fee
 *   capability.
 *
 * Card anatomy mirrors Salary Settings via the shared SettingsCard
 * primitive (modules/shared/settings-card.tsx): one flat card per group,
 * clean rows, no box-inside-box nesting.
 *
 * HONESTY (7-HONESTY2): every rule this tab edits lives in the CLIENT
 * fee-store — it never reaches the server (server truth = fee structures
 * + transactions + ledger; the student balance derives from the server
 * roster fees block per 7-E). The muted line at the top of the tab says
 * so. Rewiring is future scope; do not add a demo banner here (this is
 * the core Fees module, not a secondary demo module).
 */

import { useMemo, useState } from 'react'
import {
  AlertTriangle, Gift, Check, Archive, Lock, UserPlus, ShieldCheck, Eye, Pencil,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { useFeeStore } from '@/lib/store/fee-store'
import type { EntryFeeAudience, EntryFeeRule } from '@/lib/store/fee-store'
import { entryFeeApplies } from '@/lib/store/fee-store-data'
import { useStudentsStore } from '@/lib/store/students-store'
import { ACADEMIC_CLASSES } from '@/lib/mock/academic/classes'
import { formatINR } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useEffectiveFeeCapabilities } from '@/lib/tenant/store'
import { SettingsCard } from '../shared/settings-card'
import { toast } from 'sonner'

// RuleChip — tiny mono value chip summarising the live rule values.
function RuleChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-md border border-border/50 bg-muted/60 px-2 py-0.5 text-[10px] font-medium tabular-nums whitespace-nowrap">
      {children}
    </span>
  )
}

/** Non-interactive "view only" pill — makes a platform-restricted setting
 *  visible as such without implying any editable or requestable action. */
function ViewOnlyChip({ label = 'View only' }: { label?: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground ring-1 ring-border"
      title="Managed under a platform permission you have not been granted"
    >
      <Eye className="h-2.5 w-2.5" aria-hidden /> {label}
    </span>
  )
}

export function FeesSettingsSection() {
  return (
    // No page heading / banner — the "Settings" tab establishes context and
    // content starts immediately (Salary Settings benchmark). The single
    // muted honesty line below (7-HONESTY2) is a note, not a banner: these
    // rules are workspace-local and never reach the server.
    <div className="space-y-4">
      <p className="text-[11px] text-muted-foreground">
        Workspace-local rules — applied when computing amounts in this
        browser; the school server&rsquo;s fee structures and ledger remain the
        source of truth.
      </p>
      <LateFeeSettings />
      <ConcessionSettings />
      <EntryFeePolicyCard />
      <PoliciesSettings />
    </div>
  )
}

// ─── Late Fee Rules ────────────────────────────────────────────────
// Principal reading: ₹50/month · max ₹500 · 7-day grace · mandatory heads
// only · applied automatically. The engine consumes the exact same rule.

function LateFeeSettings() {
  const rule = useFeeStore((s) => s.lateFeeRule)
  const updateLateFeeRule = useFeeStore((s) => s.updateLateFeeRule)
  const [local, setLocal] = useState(rule)
  const dirty = JSON.stringify(local) !== JSON.stringify(rule)

  return (
    <SettingsCard
      label="Late Fee Rules"
      icon={<AlertTriangle />}
      summary={local.enabled ? 'on' : 'off'}
      action={
        dirty ? (
          <Button size="sm" className="h-8 text-xs gap-1" onClick={() => { updateLateFeeRule(local); toast.success('Late fee rules updated') }}>
            <Check className="h-3 w-3" /> Save
          </Button>
        ) : undefined
      }
    >
      <div className="space-y-3">
        {/* Live rule summary — current values at a glance (updates as fields change) */}
        <div className="flex items-center flex-wrap gap-1.5">
          <RuleChip>{formatINR(local.amountPerMonth, true)} / month</RuleChip>
          <RuleChip>max {formatINR(local.maxLateFee, true)}</RuleChip>
          <RuleChip>grace {local.gracePeriodDays}d</RuleChip>
          <RuleChip>{local.appliesTo === 'mandatory_only' ? 'mandatory heads' : 'all heads'}</RuleChip>
          <RuleChip>{local.enabled ? 'applied automatically' : 'manual — engine off'}</RuleChip>
        </div>
        {/* Rule inputs — 2-col grid of labeled fields */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-[11px]">Amount per Month (₹)</Label>
            <Input type="number" value={local.amountPerMonth} onChange={(e) => setLocal({ ...local, amountPerMonth: Number(e.target.value) })} className="h-8 text-xs tabular-nums mt-1" />
          </div>
          <div>
            <Label className="text-[11px]">Grace Period (days)</Label>
            <Input type="number" value={local.gracePeriodDays} onChange={(e) => setLocal({ ...local, gracePeriodDays: Number(e.target.value) })} className="h-8 text-xs tabular-nums mt-1" />
          </div>
          <div>
            <Label className="text-[11px]">Max Late Fee (₹)</Label>
            <Input type="number" value={local.maxLateFee} onChange={(e) => setLocal({ ...local, maxLateFee: Number(e.target.value) })} className="h-8 text-xs tabular-nums mt-1" />
          </div>
          <div>
            <Label className="text-[11px]">Applies To</Label>
            <select value={local.appliesTo} onChange={(e) => setLocal({ ...local, appliesTo: e.target.value as 'mandatory_only' | 'all' })} className="w-full h-8 text-xs rounded-md border border-border bg-background px-2 mt-1">
              <option value="mandatory_only">Mandatory Heads Only</option>
              <option value="all">All Heads</option>
            </select>
          </div>
        </div>
        {/* Master switch — clean row, no nested bordered box */}
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-medium">Automatically apply to overdue accounts</p>
          <Switch checked={local.enabled} onCheckedChange={(c) => setLocal({ ...local, enabled: c })} aria-label="Enable late fee" />
        </div>
        {/* One short engine-behaviour line — the chips above carry the values. */}
        <p className="text-[10px] text-muted-foreground border-t border-border/60 pt-2.5">
          Each instalment unpaid past the {local.gracePeriodDays}-day grace accrues{' '}
          <span className="font-semibold tabular-nums text-foreground">{formatINR(local.amountPerMonth, true)}</span>/month, capped{' '}
          <span className="font-semibold tabular-nums text-foreground">{formatINR(local.maxLateFee, true)}</span>.
          {local.appliesTo === 'mandatory_only' ? ' Optional and additional charges are never late-fee\u2019d.' : ' Applies to all heads.'}
        </p>
      </div>
    </SettingsCard>
  )
}

// ─── Concession Rules ──────────────────────────────────────────────

function ConcessionSettings() {
  const rule = useFeeStore((s) => s.concessionRule)
  const updateConcessionRule = useFeeStore((s) => s.updateConcessionRule)
  const [local, setLocal] = useState(rule)
  const dirty = JSON.stringify(local) !== JSON.stringify(rule)

  return (
    <SettingsCard
      label="Concession Rules"
      icon={<Gift />}
      summary={local.enabled ? 'on' : 'off'}
      action={
        dirty ? (
          <Button size="sm" className="h-8 text-xs gap-1" onClick={() => { updateConcessionRule(local); toast.success('Concession rules updated') }}>
            <Check className="h-3 w-3" /> Save
          </Button>
        ) : undefined
      }
    >
      <div className="space-y-3">
        {/* Live rule summary — discounts at a glance (updates as fields change) */}
        <div className="flex items-center flex-wrap gap-1.5">
          <RuleChip>sibling {local.siblingDiscountPct}%</RuleChip>
          <RuleChip>staff ward {local.staffWardDiscountPct}%</RuleChip>
          <RuleChip>scholarship {local.scholarshipDiscountPct}%</RuleChip>
          {local.requiresApproval && <RuleChip><span className="text-amber-600 font-semibold">principal approval</span></RuleChip>}
        </div>
        {/* Rule inputs — discount %s */}
        <div className="grid sm:grid-cols-3 gap-3">
          <div>
            <Label className="text-[11px]">Sibling Discount (%)</Label>
            <Input type="number" value={local.siblingDiscountPct} onChange={(e) => setLocal({ ...local, siblingDiscountPct: Number(e.target.value) })} className="h-8 text-xs tabular-nums mt-1" />
          </div>
          <div>
            <Label className="text-[11px]">Staff Ward (%)</Label>
            <Input type="number" value={local.staffWardDiscountPct} onChange={(e) => setLocal({ ...local, staffWardDiscountPct: Number(e.target.value) })} className="h-8 text-xs tabular-nums mt-1" />
          </div>
          <div>
            <Label className="text-[11px]">Scholarship (%)</Label>
            <Input type="number" value={local.scholarshipDiscountPct} onChange={(e) => setLocal({ ...local, scholarshipDiscountPct: Number(e.target.value) })} className="h-8 text-xs tabular-nums mt-1" />
          </div>
        </div>
        {/* Toggles — clean rows, no nested bordered container */}
        <div className="space-y-2 border-t border-border/60 pt-2.5">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-medium">Require Principal approval</p>
            <Switch checked={local.requiresApproval} onCheckedChange={(c) => setLocal({ ...local, requiresApproval: c })} aria-label="Require principal approval" />
          </div>
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-medium">Enable concessions on student accounts</p>
            <Switch checked={local.enabled} onCheckedChange={(c) => setLocal({ ...local, enabled: c })} aria-label="Enable concessions" />
          </div>
        </div>
      </div>
    </SettingsCard>
  )
}

// ─── One-Time Entry Fees — compact applicability list + rule builder ──
//
// WHAT the fee is (catalogue head + canonical amount) is separate from
// WHO it applies to (the applicability rule edited here). Each fee row
// shows the rule in one human line; the pencil opens a small dialog with
// the four-option rule builder and a live preview.
//
// Amounts are never edited here: Admission Fee shows the engine's own
// value; Registration Fee is derived from the published fee structures.
// One-time stays one-time — the billing engine expands these heads
// exactly once, and this card never touches frequency semantics.

/** Compact display name for a canonical class ("Class 11 PCM" only when
 *  the selection covers SOME of that grade's streams). */
function classChipLabel(id: string): string {
  const c = ACADEMIC_CLASSES.find((x) => x.id === id)
  if (!c) return id
  return c.stream ? `${c.name} ${c.stream}` : c.name
}

/** Human one-line summary of an applicability rule:
 *  "All students" · "Boys" · "Class 9 & Class 11" · "Boys · Class 6 & Class 8". */
function describeAudience(a: EntryFeeAudience): string {
  if (a.scope === 'all') return 'All students'
  const classIds = a.classIds ?? []
  const list = summarizeClassIds(classIds)
  if (a.scope === 'gender') return a.gender === 'girls' ? 'Girls' : 'Boys'
  if (a.scope === 'classes') return list || 'No classes selected'
  return `${a.gender === 'girls' ? 'Girls' : 'Boys'} · ${list || 'No classes selected'}`
}

/** Join selected canonical classes into a short human list, collapsing a
 *  grade to its plain name when every stream of that grade is selected. */
function summarizeClassIds(ids: string[]): string {
  if (ids.length === 0) return ''
  const picked = new Set(ids)
  const byName = new Map<string, { total: number; picked: number; first: string; stream: string | undefined }>()
  for (const c of ACADEMIC_CLASSES) {
    const e = byName.get(c.name) ?? { total: 0, picked: 0, first: c.id, stream: c.stream }
    e.total += 1
    if (picked.has(c.id)) e.picked += 1
    byName.set(c.name, e)
  }
  const tokens: string[] = []
  const seen = new Set<string>()
  for (const c of ACADEMIC_CLASSES) {
    if (!picked.has(c.id) || seen.has(c.name)) continue
    seen.add(c.name)
    const e = byName.get(c.name)!
    tokens.push(e.picked === e.total ? c.name : `${c.name} ${c.stream ?? ''}`.trim())
  }
  if (tokens.length === 0) return ''
  if (tokens.length === 1) return tokens[0]
  return `${tokens.slice(0, -1).join(', ')} & ${tokens[tokens.length - 1]}`
}

// ─── One-Time Entry Fees card ──────────────────────────────────────

function EntryFeePolicyCard() {
  const policy = useFeeStore((s) => s.entryFeePolicy)
  const updateEntryFeePolicy = useFeeStore((s) => s.updateEntryFeePolicy)
  const feeStructures = useFeeStore((s) => s.feeStructures)
  const perms = useEffectiveFeeCapabilities()
  const canManage = perms.fee_entry_policy_manage
  const [editingRule, setEditingRule] = useState<string | null>(null)

  // Registration Fee amount is DERIVED from the live published fee
  // structures (canonical source) — draft copies are excluded because a
  // draft charges nobody.
  const registration = useMemo(() => {
    const entries = feeStructures
      .filter((st) => !/draft/i.test(st.className))
      .flatMap((st) => st.components
        .filter((c) => c.active && (c.catalogueId === 'fh-2' || c.name === 'Registration Fee'))
        .map((c) => ({ amount: c.amount })))
    const amounts = Array.from(new Set(entries.map((e) => e.amount)))
    return {
      found: entries.length > 0,
      label: amounts.length === 1 ? formatINR(amounts[0]) : 'per structure',
    }
  }, [feeStructures])

  const ruleLabel = (r: EntryFeeRule) => (r.id === 'admission' ? 'Admission Fee' : r.id === 'registration' ? 'Registration Fee' : r.id)
  const ruleAmount = (r: EntryFeeRule) =>
    r.id === 'admission'
      ? `${formatINR(policy.admissionAmount)} · one-time`
      : `${registration.found ? registration.label : '—'} · one-time`

  const saveRule = (ruleId: string, applies: EntryFeeAudience) => {
    updateEntryFeePolicy({
      rules: policy.rules.map((r) => (r.id === ruleId ? { ...r, applies } : r)),
    })
    toast.success('Applicability updated', {
      description: `${ruleLabel(policy.rules.find((r) => r.id === ruleId)!)}, now: ${describeAudience(applies)}`,
    })
  }

  const editing = editingRule ? policy.rules.find((r) => r.id === editingRule) ?? null : null

  return (
    <SettingsCard
      label="One-Time Entry Fees"
      icon={<UserPlus />}
      summary={policy.enabled ? 'enabled' : 'off'}
      action={
        canManage ? (
          <span className="text-[10px] text-muted-foreground">Tap a fee to edit who pays it</span>
        ) : (
          <ViewOnlyChip label="View only" />
        )
      }
    >
      <div className="space-y-3">
        {/* Status · who manages — one compact line */}
        <div className="flex items-center flex-wrap gap-x-4 gap-y-1 text-[11px]">
          <span className="text-muted-foreground">Status
            <span className={cn('ml-1.5 font-semibold', policy.enabled ? 'text-emerald-600' : 'text-muted-foreground')}>
              {policy.enabled ? 'Enabled' : 'Disabled'}
            </span>
          </span>
          <span className="text-muted-foreground">Who can manage
            <span className="ml-1.5 font-semibold text-foreground">{canManage ? 'Principal' : 'Platform (Super Admin)'}</span>
          </span>
        </div>

        {/* Fee rows — name + amount, then the rule in one human line */}
        <div className="divide-y divide-border/40 border-t border-b border-border/40">
          {policy.rules.map((r) => (
            <div key={r.id} className="py-2.5">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-medium shrink-0">{ruleLabel(r)}</p>
                <div className="flex items-center gap-1.5 shrink-0">
                  <p className="text-[11px] text-muted-foreground tabular-nums">{ruleAmount(r)}</p>
                  {canManage && (
                    <Button
                      size="sm" variant="ghost"
                      className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
                      onClick={() => setEditingRule(r.id)}
                      aria-label={`Edit who pays ${ruleLabel(r)}`}
                    >
                      <Pencil className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Applies to: <span className={cn('font-medium', canManage ? 'text-foreground' : 'text-foreground/80')}>{describeAudience(r.applies)}</span>
              </p>
            </div>
          ))}
        </div>

        {/* One honest line — the one-time guarantee (engine rule, unchanged). */}
        <p className="text-[10px] text-muted-foreground">
          Charged once, at admission — never with recurring dues.
          {!canManage && ' Changes are managed by the platform (Super Admin).'}
        </p>
      </div>

      {/* Rule builder — small dialog per fee */}
      {editing && canManage && (
        <RuleBuilderDialog
          rule={editing}
          label={ruleLabel(editing)}
          onClose={() => setEditingRule(null)}
          onSave={(applies) => { saveRule(editing.id, applies); setEditingRule(null) }}
        />
      )}
    </SettingsCard>
  )
}

// ─── Rule builder dialog — "APPLIES TO" with four simple options ───

const SCOPE_OPTIONS: { value: EntryFeeAudience['scope']; label: string; hint: string }[] = [
  { value: 'all', label: 'Everyone', hint: 'Every student' },
  { value: 'classes', label: 'Selected classes', hint: 'Only the classes you pick' },
  { value: 'gender', label: 'Gender', hint: 'Boys only or girls only' },
  { value: 'classes_gender', label: 'Classes + gender', hint: 'One gender within selected classes' },
]

function RuleBuilderDialog({ rule, label, onClose, onSave }: {
  rule: EntryFeeRule
  label: string
  onClose: () => void
  onSave: (applies: EntryFeeAudience) => void
}) {
  const students = useStudentsStore((s) => s.students)
  const [scope, setScope] = useState<EntryFeeAudience['scope']>(rule.applies.scope)
  const [gender, setGender] = useState<'boys' | 'girls'>(rule.applies.gender ?? 'boys')
  const [classIds, setClassIds] = useState<string[]>(rule.applies.classIds ?? [])

  const draft: EntryFeeAudience = useMemo(() => ({
    scope,
    ...(scope === 'gender' || scope === 'classes_gender' ? { gender } : {}),
    ...(scope === 'classes' || scope === 'classes_gender' ? { classIds } : {}),
  }), [scope, gender, classIds])

  const affected = useMemo(
    () => students.filter((s) => s.status === 'Active' && entryFeeApplies(draft, s)).length,
    [students, draft],
  )

  const needsClasses = scope === 'classes' || scope === 'classes_gender'
  const needsGender = scope === 'gender' || scope === 'classes_gender'

  const toggleClass = (id: string) =>
    setClassIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))

  const save = () => {
    if (needsClasses && classIds.length === 0) {
      toast.error('Select at least one class')
      return
    }
    onSave(draft)
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm font-semibold">{label} — who pays it?</DialogTitle>
          <DialogDescription className="text-[11px]">
            Applies to future admissions only. Recorded payments never change.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3.5">
          {/* APPLIES TO — four options */}
          <RadioGroup value={scope} onValueChange={(v) => setScope(v as EntryFeeAudience['scope'])} className="gap-1.5">
            {SCOPE_OPTIONS.map((opt) => (
              <label
                key={opt.value}
                className={cn(
                  'flex items-center gap-2.5 rounded-lg border px-3 py-2 cursor-pointer transition-colors',
                  scope === opt.value ? 'border-primary/50 bg-primary/5' : 'border-border/60 hover:bg-muted/40',
                )}
              >
                <RadioGroupItem value={opt.value} className="h-3.5 w-3.5" />
                <span className="min-w-0">
                  <span className="block text-xs font-medium leading-tight">{opt.label}</span>
                  <span className="block text-[10px] text-muted-foreground leading-tight mt-0.5">{opt.hint}</span>
                </span>
              </label>
            ))}
          </RadioGroup>

          {/* Gender — when the scope needs it */}
          {needsGender && (
            <div>
              <p className="text-[10px] uppercase font-semibold tracking-wider text-muted-foreground mb-1.5">Gender</p>
              <div className="flex gap-1.5">
                {(['boys', 'girls'] as const).map((g) => (
                  <button
                    key={g}
                    type="button"
                    onClick={() => setGender(g)}
                    className={cn(
                      'h-7 px-3 rounded-md text-xs font-medium border transition-colors capitalize',
                      gender === g ? 'border-primary/50 bg-primary/5 text-foreground' : 'border-border/60 text-muted-foreground hover:bg-muted/40',
                    )}
                    aria-pressed={gender === g}
                  >
                    {g}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Classes — chip grid, when the scope needs it */}
          {needsClasses && (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-[10px] uppercase font-semibold tracking-wider text-muted-foreground">Classes</p>
                <button
                  type="button"
                  className="text-[10px] font-medium text-muted-foreground hover:text-foreground"
                  onClick={() => setClassIds(classIds.length === ACADEMIC_CLASSES.length ? [] : ACADEMIC_CLASSES.map((c) => c.id))}
                >
                  {classIds.length === ACADEMIC_CLASSES.length ? 'Clear all' : 'Select all'}
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {ACADEMIC_CLASSES.map((c) => {
                  const on = classIds.includes(c.id)
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => toggleClass(c.id)}
                      aria-pressed={on}
                      className={cn(
                        'h-7 px-2.5 rounded-md text-[11px] font-medium border transition-colors',
                        on ? 'border-primary/50 bg-primary/10 text-foreground' : 'border-border/60 text-muted-foreground hover:bg-muted/40',
                      )}
                    >
                      {classChipLabel(c.id)}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* Live preview — the rule in one line + how many students it reaches */}
          <div className="rounded-lg bg-muted/50 border border-border/50 px-3 py-2">
            <p className="text-[11px] leading-snug">
              <span className="text-muted-foreground">Applies to</span>{' '}
              <span className="font-semibold">{describeAudience(draft)}</span>
            </p>
            <p className="text-[10px] text-muted-foreground mt-0.5 tabular-nums">
              {affected} student{affected === 1 ? '' : 's'} currently match
            </p>
          </div>
        </div>

        <DialogFooter className="gap-1.5">
          <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={onClose}>Cancel</Button>
          <Button size="sm" className="h-8 text-xs gap-1" onClick={save}>
            <Check className="h-3 w-3" /> Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Controlled-Edit Policy — the ACTUAL version mechanics implemented
// across Fee Structures (publish → lock → window), as short rules.

const POLICY_ROWS = [
  {
    icon: <Lock className="h-3.5 w-3.5 shrink-0 text-sky-600 mt-0.5" />,
    lead: 'Publish locks.',
    text: 'Published structures never change silently — edits open a new version.',
  },
  {
    icon: <Check className="h-3.5 w-3.5 shrink-0 text-emerald-600 mt-0.5" />,
    lead: '60% guardian approval.',
    text: 'Fee changes affecting families apply after 60% approve, or at the deadline.',
  },
  {
    icon: <Archive className="h-3.5 w-3.5 shrink-0 text-amber-600 mt-0.5" />,
    lead: 'Archive, never delete.',
    text: 'Payments and receipts are permanent records — archived, never removed.',
  },
]

function PoliciesSettings() {
  return (
    <SettingsCard label="Controlled-Edit Policy" icon={<ShieldCheck />}>
      <div className="space-y-2.5">
        {POLICY_ROWS.map((row) => (
          <div key={row.lead} className="flex items-start gap-2.5">
            {row.icon}
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              <span className="font-semibold text-foreground">{row.lead}</span> {row.text}
            </p>
          </div>
        ))}
      </div>
    </SettingsCard>
  )
}
