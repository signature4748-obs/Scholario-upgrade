'use client'

/**
 * fees-structures-shared — Shared primitives for the versioned Fee
 * Structure components (Phase 4-8, Phase 7-D server wiring).
 *
 * - VersionStatusPill: CURRENT (emerald) / SCHEDULED (amber) /
 *   DRAFT (slate) / ARCHIVED (muted)
 * - StructureStatusBadge: per-card badge for the card grid
 * - formatINRAmount: Decimal-safe INR display (server num() values only —
 *   never used on client-derived totals)
 * - AmountInput: string-state rupee input (≤2 decimals) whose value stays
 *   a STRING straight to the server zod — no float arithmetic anywhere
 */

import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { MAX_HEADS, parseAmountInput, type FeeStructureStatus, type MasterFeeHeadDTO } from './fees-structures-hooks'

const STATUS_STYLES: Record<FeeStructureStatus, string> = {
  current: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 ring-emerald-500/20',
  scheduled: 'bg-amber-500/10 text-amber-700 dark:text-amber-300 ring-amber-500/20',
  draft: 'bg-slate-500/10 text-slate-700 dark:text-slate-300 ring-slate-500/20',
  archived: 'bg-muted text-muted-foreground ring-border/40',
}

// SaaS-STAGE-1 lifecycle vocabulary — status labels follow the agreed
// flow: Draft → Save Draft → Ready for publish → Publish/Implement →
// Current (archived history stays read-only). The store's internal
// status unions are UNCHANGED ('current' | 'scheduled' | 'archived' |
// 'draft'); only the DISPLAY labels adopt the vocabulary.
const STATUS_LABEL: Record<FeeStructureStatus, string> = {
  current: 'Current',
  scheduled: 'Ready for publish',
  draft: 'Draft',
  archived: 'Archived',
}

const STATUS_DOT: Record<FeeStructureStatus, string> = {
  current: 'bg-emerald-500',
  scheduled: 'bg-amber-500',
  draft: 'bg-slate-500',
  archived: 'bg-muted-foreground/50',
}

export function VersionStatusPill({
  status,
  className,
  withDot = true,
}: {
  status: FeeStructureStatus
  className?: string
  withDot?: boolean
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-semibold ring-1 whitespace-nowrap',
        STATUS_STYLES[status],
        className,
      )}
    >
      {withDot && <span className={cn('h-1.5 w-1.5 rounded-full', STATUS_DOT[status])} />}
      {STATUS_LABEL[status]}
    </span>
  )
}

// Compact version — for very small contexts (e.g. card grid footer).
export function VersionStatusDot({ status }: { status: FeeStructureStatus }) {
  return (
    <span
      className={cn('inline-flex items-center gap-1 text-[9px] font-semibold', STATUS_STYLES[status].split(' ').filter((c) => c.startsWith('text-')).join(' '))}
      title={STATUS_LABEL[status]}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', STATUS_DOT[status])} />
      {STATUS_LABEL[status]}
    </span>
  )
}

// Per-card status badge for the card grid — shows the current version's
// status. Most structures will be 'current' (emerald), but newly-created
// drafts will show 'draft' (slate) until published.
export function StructureStatusBadge({ status, version }: { status: FeeStructureStatus; version: number }) {
  return (
    <div className="flex items-center gap-1.5">
      <VersionStatusPill status={status} />
      <span className="text-[9px] text-muted-foreground font-mono">v{version}</span>
    </div>
  )
}

// Re-export for convenience
export const STATUS_LABELS = STATUS_LABEL
export const STATUS_STYLE_MAP = STATUS_STYLES

// ─── Phase 7-D — Decimal-safe money display + string amount input ──────

const inrDecimalFormatter = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
})

/**
 * Decimal-safe INR display for SERVER-emitted amounts (num() of
 * Decimal(12,2)): keeps paise visible when present (₹125.50) and stays
 * whole-rupee clean otherwise (₹2,500). The legacy formatINR rounds to 0
 * fraction digits, which silently eats paise — never use it for head
 * amounts. DISPLAY ONLY: never feed client-derived totals in here.
 */
export function formatINRAmount(amount: number): string {
  if (!Number.isFinite(amount)) return '—'
  return inrDecimalFormatter.format(amount)
}

/** Sanitize raw text → digits with at most one '.' and 2 decimals. */
export function sanitizeAmountText(raw: string): string {
  // Digits + dots only.
  const t = raw.replace(/[^\d.]/g, '')
  // Collapse leading zeros on the integer part ("007" → "7", "0" stays).
  const firstDot = t.indexOf('.')
  const intPart = firstDot === -1 ? t : t.slice(0, firstDot)
  const rest = firstDot === -1 ? '' : t.slice(firstDot)
  const normalizedInt = intPart.length > 1 ? intPart.replace(/^0+(?=\d)/, '') : intPart
  // At most one dot.
  const dotIdx = rest.indexOf('.')
  let frac = ''
  if (dotIdx !== -1) {
    frac = '.' + rest.slice(dotIdx + 1).replace(/\./g, '').slice(0, 2)
  }
  return normalizedInt + frac
}

/**
 * String-state rupee input for fee-head amounts. The emitted value is the
 * RAW STRING (e.g. "125.50") — it travels to POST/PATCH untouched and is
 * parsed by the server zod (z.coerce.number()). No Number() conversion,
 * no float arithmetic, no derived totals.
 */
export function AmountInput({
  value,
  onChange,
  onValidate,
  disabled,
  id,
  ariaLabel = 'Amount in rupees',
  placeholder = '0.00',
  className,
  invalid,
}: {
  /** Current string value ('' = empty). */
  value: string
  /** Emits the sanitized string; '' when empty (validate on submit). */
  onChange: (value: string) => void
  /** Optional live validation callback (receives '' when empty). */
  onValidate?: (value: string) => void
  disabled?: boolean
  id?: string
  ariaLabel?: string
  placeholder?: string
  className?: string
  invalid?: boolean
}) {
  return (
    <div className={cn('relative w-full', className)}>
      <Input
        id={id}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        value={value}
        disabled={disabled}
        onChange={(e) => {
          const next = sanitizeAmountText(e.target.value)
          onChange(next)
          onValidate?.(next)
        }}
        placeholder={placeholder}
        className={cn('h-8 text-right text-xs tabular-nums', invalid && 'border-rose-500/60 focus-visible:ring-rose-500/40')}
      />
    </div>
  )
}

// ─── Phase 7-D — shared draft-heads editor (create dialog + detail) ────

export const FREQUENCIES = ['Annual', 'Half-Yearly', 'Quarterly', 'Monthly', 'Per Term', 'One-Time'] as const

/** Editable head row — `amount` stays a STRING to the server zod. */
export interface DraftHead {
  key: string
  catalogueId: string | null
  name: string
  category: string
  amount: string
  frequency: string
  mandatory: boolean
  active: boolean
}

let rowSeq = 0
export const newRowKey = () => `dh-${Date.now().toString(36)}-${++rowSeq}`

/**
 * DraftHeadsEditor — the shared heads editor used by BOTH the create
 * dialog and the draft detail drawer. Each row keeps its amount as the
 * raw STRING typed by the principal (server zod coerces it); heads can be
 * picked from the server MasterFeeHead catalogue (prefill + catalogueId
 * binding) or typed as custom heads (no catalogueId — the POST/PATCH
 * contract allows both).
 */
export function DraftHeadsEditor({
  heads,
  errors,
  catalogue,
  onPatch,
  onRemove,
  onAdd,
}: {
  heads: DraftHead[]
  errors: Record<string, string>
  catalogue: MasterFeeHeadDTO[]
  onPatch: (key: string, patch: Partial<DraftHead>) => void
  onRemove: (key: string) => void
  onAdd: (head: Omit<DraftHead, 'key'>) => void
}) {
  const [newName, setNewName] = useState('')
  const [newAmount, setNewAmount] = useState('')
  const [newFrequency, setNewFrequency] = useState<string>('Monthly')
  const [newCatalogueId, setNewCatalogueId] = useState<string>('__custom__')
  const [addError, setAddError] = useState<string | null>(null)

  const selectedCatalogueEntry = catalogue.find((c) => c.id === newCatalogueId) ?? null

  const handleAdd = () => {
    const name = (selectedCatalogueEntry ? selectedCatalogueEntry.name : newName).trim()
    if (!name) {
      setAddError('Name is required')
      return
    }
    if (heads.some((h) => h.name.trim().toLowerCase() === name.toLowerCase())) {
      setAddError('Duplicate head name')
      return
    }
    // Prefill the amount from the catalogue entry when bound; the user's
    // typed string always wins otherwise. Server emits num() — String()
    // round-trips the 2-decimal value exactly.
    const amount = newAmount.trim() !== ''
      ? newAmount
      : selectedCatalogueEntry
        ? String(selectedCatalogueEntry.amount)
        : ''
    const parsed = parseAmountInput(amount)
    if (!parsed.ok) {
      setAddError(parsed.error)
      return
    }
    if (heads.length + 1 > MAX_HEADS) {
      setAddError(`A fee structure may have at most ${MAX_HEADS} heads`)
      return
    }
    onAdd({
      catalogueId: selectedCatalogueEntry ? selectedCatalogueEntry.id : null,
      name,
      category: selectedCatalogueEntry ? selectedCatalogueEntry.category : 'Other',
      amount: parsed.value,
      frequency: selectedCatalogueEntry ? selectedCatalogueEntry.frequency : newFrequency,
      mandatory: selectedCatalogueEntry ? selectedCatalogueEntry.mandatory : true,
      active: true,
    })
    setNewName('')
    setNewAmount('')
    setNewFrequency('Monthly')
    setNewCatalogueId('__custom__')
    setAddError(null)
  }

  return (
    <div className="space-y-3">
      {/* Existing rows */}
      <div className="rounded-lg border border-border overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-1.5 bg-muted/40 text-[9px] uppercase font-semibold text-muted-foreground tracking-wider">
          <span className="flex-1">Head</span>
          <span className="w-[110px] text-right">Amount</span>
          <span className="hidden sm:block w-28">Frequency</span>
          <span className="w-9 text-center" title="Mandatory">Req</span>
          <span className="w-7" aria-label="Remove" />
        </div>
        <div className="divide-y divide-border/40">
          {heads.length === 0 && (
            <div className="px-3 py-3 text-[11px] text-muted-foreground text-center">
              No heads yet — add the first one below.
            </div>
          )}
          {heads.map((h) => (
            <div key={h.key} className="px-3 py-2 space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <Input
                  value={h.name}
                  onChange={(e) => onPatch(h.key, { name: e.target.value })}
                  aria-label={`Fee head name: ${h.name}`}
                  className="h-8 text-xs flex-1 min-w-[140px]"
                  aria-invalid={!!errors[h.key]}
                />
                <div className="w-[110px] shrink-0">
                  <AmountInput
                    value={h.amount}
                    onChange={(v) => onPatch(h.key, { amount: v })}
                    ariaLabel={`Amount for ${h.name}`}
                    invalid={!!errors[h.key]}
                  />
                </div>
                <div className="hidden sm:block w-28 shrink-0">
                  <Select value={h.frequency} onValueChange={(v) => onPatch(h.key, { frequency: v })}>
                    <SelectTrigger className="h-8 text-xs w-full" aria-label={`Frequency for ${h.name}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {FREQUENCIES.map((f) => (
                        <SelectItem key={f} value={f}>{f}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center justify-center w-9 shrink-0">
                  <Switch
                    checked={h.mandatory}
                    onCheckedChange={(v) => onPatch(h.key, { mandatory: v })}
                    aria-label={`${h.name} is mandatory`}
                  />
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0 text-rose-600 hover:text-rose-700 hover:bg-rose-500/10 shrink-0"
                  onClick={() => onRemove(h.key)}
                  aria-label={`Remove ${h.name}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
              {errors[h.key] && (
                <p className="text-[10px] text-rose-600 dark:text-rose-400" role="alert">{errors[h.key]}</p>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Add head — catalogue pick (server MasterFeeHead) or custom name */}
      <div className="rounded-lg border border-dashed border-border p-3 space-y-2">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
          <Plus className="h-3 w-3" /> Add fee head
        </div>
        {catalogue.length > 0 && (
          <div>
            <Label htmlFor="new-head-catalogue" className="text-[10px] text-muted-foreground">From catalogue</Label>
            <Select value={newCatalogueId} onValueChange={(v) => setNewCatalogueId(v)}>
              <SelectTrigger id="new-head-catalogue" className="h-8 text-xs w-full mt-1">
                <SelectValue placeholder="Custom head (typed below)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__custom__">Custom head (typed below)</SelectItem>
                {catalogue.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name} · {formatINRAmount(c.amount)} · {c.frequency}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        {!selectedCatalogueEntry && (
          <div className="flex items-end gap-2 flex-wrap">
            <div className="space-y-1 flex-1 min-w-[150px]">
              <Label htmlFor="new-head-name" className="text-[10px] text-muted-foreground">Head name</Label>
              <Input
                id="new-head-name"
                value={newName}
                onChange={(e) => { setNewName(e.target.value); setAddError(null) }}
                placeholder="e.g. Tuition Fee"
                className="h-8 text-xs"
              />
            </div>
            <div className="space-y-1 w-[110px] shrink-0">
              <Label htmlFor="new-head-amount" className="text-[10px] text-muted-foreground">Amount</Label>
              <AmountInput id="new-head-amount" value={newAmount} onChange={(v) => { setNewAmount(v); setAddError(null) }} ariaLabel="New head amount" invalid={!!addError} />
            </div>
            <div className="space-y-1 w-28 shrink-0 hidden sm:block">
              <Label htmlFor="new-head-frequency" className="text-[10px] text-muted-foreground">Frequency</Label>
              <Select value={newFrequency} onValueChange={setNewFrequency}>
                <SelectTrigger id="new-head-frequency" className="h-8 text-xs w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FREQUENCIES.map((f) => (
                    <SelectItem key={f} value={f}>{f}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}
        {selectedCatalogueEntry && (
          <div className="flex items-end gap-2">
            <div className="space-y-1 w-[130px]">
              <Label htmlFor="new-head-amount-cat" className="text-[10px] text-muted-foreground">
                Amount (defaults to catalogue)
              </Label>
              <AmountInput
                id="new-head-amount-cat"
                value={newAmount}
                onChange={(v) => { setNewAmount(v); setAddError(null) }}
                ariaLabel="New head amount"
                placeholder={String(selectedCatalogueEntry.amount)}
                invalid={!!addError}
              />
            </div>
          </div>
        )}
        {addError && <p className="text-[10px] text-rose-600 dark:text-rose-400" role="alert">{addError}</p>}
        <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5" onClick={handleAdd}>
          <Plus className="h-3.5 w-3.5" /> Add head
        </Button>
        <p className="text-[10px] text-muted-foreground leading-relaxed">
          Amounts are sent exactly as typed (up to 2 decimals, 0–500000) — the server validates and stores them as
          NUMERIC(12,2).
        </p>
      </div>
    </div>
  )
}
