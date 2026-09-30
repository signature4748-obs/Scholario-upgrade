'use client'

/**
 * FeesCatalogueView — Fee Head Catalogue MANAGEMENT (SaaS-STAGE-1).
 *
 * A FULL CONTENT-AREA VIEW — never a modal. It REPLACES the Fee Structures
 * tab content while the app shell (sidebar / application header / Fee
 * Management tabs) stays untouched; "← Back to Fee Structures" returns to
 * the preserved list. This is the ONLY place where catalogue heads are
 * created, edited, or archived.
 *
 * Separation of concerns (critical rule):
 *   - Fee Structures only PICK from this catalogue (fee-head-catalogue-picker).
 *   - Edits here change DEFAULTS FOR FUTURE structures only. Published fee
 *     structure versions keep their immutable snapshots — head amounts in
 *     existing versions are never rewritten by a catalogue edit (the store
 *     enforces this; the footer note keeps it visible to the user).
 *
 * Header matches the detail-screen visual language (compact, strong
 * hierarchy, no oversized hero): back link · title + "N heads · M archived"
 * · "+ New Head" (always fully visible — the header wraps, never clips).
 */

import { useMemo, useState } from 'react'
import {
  ArrowLeft, Plus, Search, Pencil, Archive, ArchiveRestore,
  BookOpen, Layers, ShieldCheck, Lock,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  useSchoolSettingsStore,
} from '@/lib/store/school-settings-store'
import type { FeeHeadConfig, FeeHeadKind } from '@/lib/store/school-settings-store/types'
import { useFeeData } from '@/lib/store/fee-store'
import { useAcademicSession } from '@/lib/academic-session'
// SaaS-STAGE-2A (Task 7-b) — the catalogue view is writable only when the
// ACTIVE school's config grants fee_catalogue_manage; otherwise it renders
// READ-ONLY (heads list without the New Head / Edit / Archive-Restore
// actions, plus a slim notice). The store CRUD actions enforce the same
// capability at action time.
import { useEffectiveFeeCapabilities } from '@/lib/tenant/store'
import { formatINR } from '@/lib/format'
import { cn } from '@/lib/utils'
import {
  CATEGORY_ORDER, CategoryBadge, FrequencyBadge, GstBadge, KindBadge,
  deriveHeadCategory,
} from './fees-catalogue-shared'
import { FeeEmptyState } from './fees-shared'
import { toast } from 'sonner'

const HEAD_TYPES = CATEGORY_ORDER // Tuition / Admission / Annual / Transport / Lab / Library / Exam / Activity / Board / Other

// SaaS-STAGE-2A §4 — 'Per-Exam' is the EXAMINATION-head frequency: the
// charge applies once per conducted exam of the mapped exam type (never
// ×12). Rendered as a normal frequency option + badge.
const FREQUENCIES: FeeHeadConfig['frequency'][] = [
  'Monthly', 'Quarterly', 'Half-Yearly', 'Per Term', 'Term', 'Annual', 'One-Time', 'Per-Exam',
]

const KINDS: FeeHeadKind[] = ['CORE', 'EXAMINATION', 'ADDITIONAL']

interface Props {
  onBack: () => void
}

export function FeesCatalogueView({ onBack }: Props) {
  const feeHeads = useSchoolSettingsStore((s) => s.fees.feeHeads)
  const addFeeHead = useSchoolSettingsStore((s) => s.addFeeHead)
  const updateFeeHead = useSchoolSettingsStore((s) => s.updateFeeHead)
  const archiveFeeHead = useSchoolSettingsStore((s) => s.archiveFeeHead)
  const restoreFeeHead = useSchoolSettingsStore((s) => s.restoreFeeHead)
  const { feeStructures } = useFeeData()
  const session = useAcademicSession()
  // SaaS-STAGE-2A (Task 7-b) — write access follows the ACTIVE school's
  // effective capabilities (fee_catalogue_manage). Read-only otherwise.
  const perms = useEffectiveFeeCapabilities()
  const canManage = perms.fee_catalogue_manage

  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<'All' | string>('All')
  const [showArchived, setShowArchived] = useState(false)
  const [editorOpen, setEditorOpen] = useState(false)
  const [editing, setEditing] = useState<FeeHeadConfig | null>(null)

  const archivedCount = feeHeads.filter((h) => h.archived).length
  const activeCount = feeHeads.length - archivedCount

  // "Used in N structures" — how many live per-class structures carry a
  // head bound to this catalogue entry (metadata linkage via catalogueId).
  const usedInByHead = useMemo(() => {
    const m = new Map<string, number>()
    for (const s of feeStructures) {
      const seen = new Set<string>()
      for (const c of s.components) {
        if (c.catalogueId && !seen.has(c.catalogueId)) {
          seen.add(c.catalogueId)
          m.set(c.catalogueId, (m.get(c.catalogueId) ?? 0) + 1)
        }
      }
    }
    return m
  }, [feeStructures])

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    return feeHeads
      .filter((h) => (showArchived ? true : !h.archived))
      .filter((h) => (categoryFilter === 'All' ? true : deriveHeadCategory(h as never, h.type) === categoryFilter))
      .filter((h) => {
        if (!q) return true
        return (
          h.name.toLowerCase().includes(q) ||
          (h.description ?? '').toLowerCase().includes(q) ||
          h.type.toLowerCase().includes(q)
        )
      })
  }, [feeHeads, search, categoryFilter, showArchived])

  const openCreate = () => {
    setEditing(null)
    setEditorOpen(true)
  }
  const openEdit = (h: FeeHeadConfig) => {
    setEditing(h)
    setEditorOpen(true)
  }

  return (
    <div className="space-y-4 max-w-7xl mx-auto">
      {/* ── Page-level header: Back · Title + counts · New Head ──
          flex-wrap guarantees "+ New Head" is NEVER clipped on
          tablet/mobile widths (SaaS-STAGE-1 responsive rule). */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <Button variant="ghost" size="sm" className="h-8 text-xs gap-1.5 -ml-2 shrink-0" onClick={onBack}>
            <ArrowLeft className="h-3.5 w-3.5" /> Back to Fee Structures
          </Button>
          <div className="min-w-0">
            <h2 className="text-base font-bold flex items-center gap-1.5 leading-tight">
              <BookOpen className="h-4 w-4 text-emerald-600" /> Fee Head Catalogue
            </h2>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              {activeCount} heads · {archivedCount} archived · defaults for {session.label ?? 'Session not set'}
            </p>
          </div>
        </div>
        {/* SaaS-STAGE-2A (Task 7-b) — "+ New Head" stays VISIBLE and fully
            rendered whenever the school may manage the catalogue; hidden
            (not disabled) in read-only mode. */}
        {canManage && (
          <Button size="sm" className="h-8 text-xs gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white shrink-0" onClick={openCreate}>
            <Plus className="h-3.5 w-3.5" /> New Head
          </Button>
        )}
      </div>

      {/* SaaS-STAGE-2A (Task 7-b) — READ-ONLY notice: the catalogue is
          browsable for everyone, but management actions require
          fee_catalogue_manage. Slim — never a banner. */}
      {!canManage && (
        <div className="rounded-md border border-border/60 bg-muted/40 px-2.5 py-1.5 flex items-start gap-2" data-testid="fee-catalogue-readonly-notice">
          <Lock className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            <span className="font-medium text-foreground">Read-only</span> — catalogue management is disabled for your school by the platform configuration
          </p>
        </div>
      )}

      {/* ── Search + compact category filters + archived toggle ── */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[180px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search heads…" className="pl-9 h-9 text-xs" />
        </div>
        <div className="flex items-center gap-1 flex-wrap">
          {(['All', ...HEAD_TYPES] as string[]).map((cat) => {
            const active = categoryFilter === cat
            return (
              <button
                key={cat}
                type="button"
                onClick={() => setCategoryFilter(cat)}
                className={cn(
                  'h-7 px-2.5 rounded-full text-[10px] font-semibold border transition-colors whitespace-nowrap',
                  active
                    ? 'bg-emerald-600 text-white border-emerald-600'
                    : 'bg-muted/40 text-muted-foreground border-border hover:bg-muted hover:text-foreground',
                )}
              >
                {cat === 'Exam' ? 'Exam' : cat}
              </button>
            )
          })}
        </div>
        <div className="flex-1" />
        {archivedCount > 0 && (
          <Button variant="outline" size="sm" className="h-8 text-xs shrink-0" onClick={() => setShowArchived((v) => !v)}>
            {showArchived ? 'Hide Archived' : `Archived (${archivedCount})`}
          </Button>
        )}
      </div>

      {/* ── Catalogue rows — the module ledger table recipe ── */}
      <div className="rounded-xl border bg-card">
        <div className="overflow-x-auto max-h-[34rem]">
          <table className="w-full text-xs border-separate border-spacing-0">
            <thead className="sticky top-0 z-10">
              <tr className="h-10 bg-muted shadow-[inset_0_-1px_0_0_hsl(var(--border))]">
                <th className="text-left px-3 text-[11px] uppercase tracking-wider font-medium text-muted-foreground whitespace-nowrap bg-muted">Head</th>
                <th className="text-center px-3 text-[11px] uppercase tracking-wider font-medium text-muted-foreground whitespace-nowrap bg-muted hidden sm:table-cell">Category</th>
                <th className="text-center px-3 text-[11px] uppercase tracking-wider font-medium text-muted-foreground whitespace-nowrap bg-muted hidden lg:table-cell">Kind</th>
                <th className="text-right px-3 text-[11px] uppercase tracking-wider font-medium text-muted-foreground whitespace-nowrap bg-muted">Default</th>
                <th className="text-center px-3 text-[11px] uppercase tracking-wider font-medium text-muted-foreground whitespace-nowrap bg-muted hidden md:table-cell">Frequency</th>
                <th className="text-center px-3 text-[11px] uppercase tracking-wider font-medium text-muted-foreground whitespace-nowrap bg-muted hidden xl:table-cell">Used in</th>
                <th className="text-right pl-3 pr-4 text-[11px] uppercase tracking-wider font-medium text-muted-foreground whitespace-nowrap bg-muted">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((h) => {
                const usedIn = usedInByHead.get(h.id) ?? 0
                return (
                  <tr key={h.id} className={cn('border-t border-border/30 hover:bg-muted/30 transition-colors', h.archived && 'opacity-70')}>
                    <td className="px-3 py-2.5 max-w-[260px]">
                      <p className="font-medium leading-tight truncate flex items-center gap-1.5" title={h.name}>
                        <span className="truncate">{h.name}</span>
                        {/* SaaS-STAGE-2A (Task 7-b) — OPTIONAL heads
                            (mandatory === false) are never auto-billed to
                            every student; per-student applicability applies
                            later. Tiny muted chip keeps rows compact. */}
                        {h.mandatory === false && (
                          <span className="shrink-0 rounded bg-slate-500/10 px-1 py-px text-[10px] leading-4 font-medium text-slate-600 dark:text-slate-300">
                            Optional
                          </span>
                        )}
                      </p>
                      {h.description && (
                        <p className="text-[10px] text-muted-foreground truncate mt-0.5" title={h.description}>{h.description}</p>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-center hidden sm:table-cell">
                      <CategoryBadge category={deriveHeadCategory(h as never, h.type)} />
                    </td>
                    <td className="px-3 py-2.5 text-center hidden lg:table-cell">
                      <KindBadge kind={h.kind ?? (h.type === 'Exam' ? 'EXAMINATION' : 'CORE')} />
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums font-semibold whitespace-nowrap text-emerald-700 dark:text-emerald-400">
                      {formatINR(h.defaultAmount)}
                      <GstBadge isTaxable={h.isTaxable} taxRate={h.taxRate} className="ml-1.5 hidden xl:inline-flex align-middle" />
                    </td>
                    <td className="px-3 py-2.5 text-center hidden md:table-cell">
                      <FrequencyBadge frequency={h.frequency} />
                    </td>
                    <td className="px-3 py-2.5 text-center hidden xl:table-cell">
                      <span
                        className={cn('text-[10px] tabular-nums', usedIn > 0 ? 'text-muted-foreground' : 'text-muted-foreground/50')}
                        title={usedIn > 0 ? `${usedIn} structure${usedIn === 1 ? '' : 's'} pick this head (their published snapshots are NOT affected by edits here)` : 'Not picked by any structure yet'}
                      >
                        {usedIn > 0 ? `${usedIn} structure${usedIn === 1 ? '' : 's'}` : '—'}
                      </span>
                    </td>
                    <td className="pl-3 pr-4 py-2.5 text-right">
                      {/* SaaS-STAGE-2A (Task 7-b) — row actions are hidden in
                          read-only mode (fee_catalogue_manage off). */}
                      {canManage && (
                        <div className="inline-flex items-center gap-0.5">
                          <button
                            onClick={() => openEdit(h)}
                            className="inline-flex items-center justify-center h-6 w-6 rounded text-primary hover:bg-primary/10 transition-colors"
                            title="Edit defaults"
                            aria-label={`Edit ${h.name}`}
                          >
                            <Pencil className="h-3 w-3" />
                          </button>
                          {h.archived ? (
                            <button
                              onClick={() => { restoreFeeHead(h.id); toast.success('Head restored', { description: `${h.name} is pickable again.` }) }}
                              className="inline-flex items-center justify-center h-6 w-6 rounded text-emerald-600 hover:bg-emerald-500/10 transition-colors"
                              title="Restore head"
                              aria-label={`Restore ${h.name}`}
                            >
                              <ArchiveRestore className="h-3 w-3" />
                            </button>
                          ) : (
                            <button
                              onClick={() => { archiveFeeHead(h.id); toast.info('Head archived', { description: `${h.name} hidden from new picks — existing structures keep their snapshot.` }) }}
                              className="inline-flex items-center justify-center h-6 w-6 rounded text-amber-600 hover:bg-amber-500/10 transition-colors"
                              title="Archive head (existing structures keep their snapshot)"
                              aria-label={`Archive ${h.name}`}
                            >
                              <Archive className="h-3 w-3" />
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-12">
                    <FeeEmptyState
                      icon={<Layers className="h-6 w-6" />}
                      title="No heads match"
                      description={search || categoryFilter !== 'All' ? 'Try adjusting the search or category filter.' : 'Create the first catalogue head with “New Head”.'}
                      action={feeHeads.length === 0 && canManage ? (
                        <Button size="sm" className="h-8 text-xs gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white" onClick={openCreate}>
                          <Plus className="h-3.5 w-3.5" /> New Head
                        </Button>
                      ) : undefined}
                    />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {/* Boundary rule — always visible so the boundary is never a surprise */}
        <div className="border-t border-border/60 px-4 py-2 flex items-start gap-2 text-[10px] text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5 text-emerald-500 shrink-0 mt-0.5" aria-hidden />
          <p>
            Catalogue edits apply to <span className="font-semibold text-foreground">new structures only</span> —
            existing structures, payments and receipts are unchanged.
          </p>
        </div>
      </div>

      <FeeHeadEditorDialog
        open={editorOpen}
        editing={editing}
        onClose={() => setEditorOpen(false)}
        onSubmit={(patch) => {
          if (editing) {
            updateFeeHead(editing.id, patch)
            toast.success('Catalogue head updated', { description: `${patch.name ?? editing.name} — future picks use the new defaults.` })
          } else {
            addFeeHead(patch as Omit<FeeHeadConfig, 'id'>)
            toast.success('Catalogue head created', { description: `${patch.name} is now pickable in Fee Structures.` })
          }
          setEditorOpen(false)
        }}
      />
    </div>
  )
}

// ─── New / Edit head dialog ─────────────────────────────────────────────

interface EditorPatch {
  name: string
  type: FeeHeadConfig['type']
  kind?: FeeHeadKind
  defaultAmount: number
  frequency: FeeHeadConfig['frequency']
  description?: string
  isTaxable?: boolean
  taxRate?: number
  /** SaaS-STAGE-2A (Task 7-b) — applicability template: optional heads
   *  (mandatory=false) are never auto-billed to every student. */
  mandatory?: boolean
}

function FeeHeadEditorDialog({
  open, editing, onClose, onSubmit,
}: {
  open: boolean
  editing: FeeHeadConfig | null
  onClose: () => void
  onSubmit: (patch: EditorPatch) => void
}) {
  const [name, setName] = useState('')
  const [type, setType] = useState<FeeHeadConfig['type']>('Other')
  const [kind, setKind] = useState<FeeHeadKind>('CORE')
  const [amount, setAmount] = useState('')
  const [frequency, setFrequency] = useState<FeeHeadConfig['frequency']>('Annual')
  const [description, setDescription] = useState('')
  const [taxable, setTaxable] = useState(false)
  const [taxRate, setTaxRate] = useState('18')
  // SaaS-STAGE-2A (Task 7-b) — Mandatory/Optional applicability. Optional
  // heads (Books, Uniform…) are never auto-billed to every student.
  const [mandatory, setMandatory] = useState(true)
  const [formKey, setFormKey] = useState(0)

  // Re-seed the form whenever the dialog opens (create vs edit target).
  const [wasOpen, setWasOpen] = useState(false)
  if (open && !wasOpen) {
    setWasOpen(true)
    setName(editing?.name ?? '')
    setType((editing?.type ?? 'Other') as FeeHeadConfig['type'])
    setKind(editing?.kind ?? (editing?.type === 'Exam' ? 'EXAMINATION' : 'CORE'))
    setAmount(editing ? String(editing.defaultAmount) : '')
    setFrequency(editing?.frequency ?? 'Annual')
    setDescription(editing?.description ?? '')
    setTaxable(editing?.isTaxable ?? false)
    setTaxRate(String(editing?.taxRate ?? 18))
    setMandatory(editing?.mandatory ?? true)
    setFormKey((k) => k + 1)
  } else if (!open && wasOpen) {
    setWasOpen(false)
  }

  const amountNum = Number(amount)
  const valid = name.trim().length >= 2 && Number.isFinite(amountNum) && amountNum >= 0

  const submit = () => {
    if (!valid) return
    onSubmit({
      name: name.trim(),
      type,
      kind,
      defaultAmount: Math.round(amountNum),
      frequency,
      description: description.trim() || undefined,
      isTaxable: taxable,
      taxRate: taxable ? Number(taxRate) || 18 : undefined,
      mandatory,
    })
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm flex items-center gap-1.5">
            <BookOpen className="h-4 w-4 text-emerald-600" />
            {editing ? 'Edit Catalogue Head' : 'New Catalogue Head'}
          </DialogTitle>
          <DialogDescription className="text-[11px]">
            {editing
              ? 'Changes become the DEFAULTS for future structures — published versions keep their snapshots.'
              : 'Create a reusable fee head that Fee Structures can pick from.'}
          </DialogDescription>
        </DialogHeader>

        <div key={formKey} className="space-y-3 py-1">
          <div>
            <Label className="text-[11px]">Head name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Computer Lab Fee" className="h-8 text-xs mt-1" autoFocus />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-[11px]">Category</Label>
              <Select value={type} onValueChange={(v) => setType(v as FeeHeadConfig['type'])}>
                <SelectTrigger className="h-8 text-xs mt-1 w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {HEAD_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-[11px]">Financial kind</Label>
              <Select value={kind} onValueChange={(v) => setKind(v as FeeHeadKind)}>
                <SelectTrigger className="h-8 text-xs mt-1 w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {KINDS.map((k) => (
                    <SelectItem key={k} value={k}>
                      {k === 'CORE' ? 'Core Fee' : k === 'EXAMINATION' ? 'Exam Fee' : 'Additional (event template)'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-[11px]">Default amount (₹)</Label>
              <Input
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ''))}
                placeholder="500"
                inputMode="numeric"
                className="h-8 text-xs font-mono mt-1"
              />
            </div>
            <div>
              <Label className="text-[11px]">Frequency</Label>
              <Select value={frequency} onValueChange={(v) => setFrequency(v as FeeHeadConfig['frequency'])}>
                <SelectTrigger className="h-8 text-xs mt-1 w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {FREQUENCIES.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label className="text-[11px]">Description (optional)</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Shown in the picker to guide selection" className="h-8 text-xs mt-1" />
          </div>
          {/* SaaS-STAGE-2A (Task 7-b) — Mandatory/Optional applicability
              template. Bound to `mandatory` and persisted via the existing
              add/update actions. */}
          <div>
            <Label className="text-[11px]">Applicability</Label>
            <div className="grid grid-cols-2 gap-1.5 mt-1 rounded-md border border-border bg-muted/30 p-1">
              <button
                type="button"
                onClick={() => setMandatory(true)}
                aria-pressed={mandatory}
                className={cn(
                  'h-7 rounded text-[11px] font-medium transition-colors',
                  mandatory
                    ? 'bg-card shadow-sm text-foreground ring-1 ring-border'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                Mandatory
              </button>
              <button
                type="button"
                onClick={() => setMandatory(false)}
                aria-pressed={!mandatory}
                className={cn(
                  'h-7 rounded text-[11px] font-medium transition-colors',
                  !mandatory
                    ? 'bg-card shadow-sm text-foreground ring-1 ring-border'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                Optional
              </button>
            </div>
            <p className="text-[10px] text-muted-foreground mt-1 leading-relaxed">
              Optional heads (Books, Uniform…) are never auto-billed to every student — per-student applicability applies later.
            </p>
          </div>
          <div className="flex items-center justify-between rounded-lg border border-border bg-muted/20 px-3 py-2">
            <div>
              <p className="text-xs font-medium">GST applies to this head</p>
              <p className="text-[10px] text-muted-foreground">Most school fees are GST-exempt — leave off unless certain.</p>
            </div>
            <Switch checked={taxable} onCheckedChange={setTaxable} aria-label="GST applies" />
          </div>
          {taxable && (
            <div>
              <Label className="text-[11px]">GST rate (%)</Label>
              <Input value={taxRate} onChange={(e) => setTaxRate(e.target.value.replace(/[^\d]/g, ''))} className="h-8 text-xs font-mono mt-1 w-24" inputMode="numeric" />
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 pt-1">
          <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={onClose}>Cancel</Button>
          <Button size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700 text-white" onClick={submit} disabled={!valid}>
            {editing ? 'Save Changes' : 'Create Head'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
