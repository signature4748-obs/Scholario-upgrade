'use client'

/**
 * fees-additional-charges — Additional Collections (Payments page).
 *
 * APPS-IA-1 — THE COLLECTION IS A FIRST-CLASS OBJECT. This surface answers
 * "where does a special collection come from?" directly:
 *
 *   • A Principal can CREATE a collection right here (+ New Collection):
 *     tours, workshops, events, competitions, donations, materials,
 *     activities, anything. NO form is required — a collection exists on
 *     its own and money can be collected against it immediately.
 *   • A collection MAY optionally be linked to a form from Applications &
 *     Forms (reverse-lookup by payment.chargeId → "Linked form · title").
 *     The form collects the responses; the collection collects the money.
 *     One payment is recorded once (fee-store recordPayment with
 *     additionalChargeId) and appears here, in Transactions, on the
 *     student account and in the linked form — never duplicated.
 *
 * LIFECYCLE (§5): Draft → Active (published) → Closed → Archived.
 *   Draft    — editable in full, deletable (nothing financial exists yet).
 *   Active   — an obligation for its scoped students; safe-field edits only;
 *              destructive delete is IMPOSSIBLE (accounting integrity).
 *   Closed   — window finished; payment history stays readable.
 *   Archived — permanent read-only historical record.
 *
 * Money flow: recording payments happens through the ONE canonical flow
 * (the Payments page's Collect Fee wizard bound to the charge) — this
 * surface reads those transactions and never invents new ones.
 */

import { Fragment, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { motion } from 'framer-motion'
import {
  Archive, Bus, CalendarDays, CheckCircle2, CircleDollarSign,
  Edit3, FileText, FlaskConical, HandHeart, IndianRupee, Lock, MoreHorizontal,
  Package, PencilLine, Plus, Send, Tag, Tent, Trash2, Trophy, Wallet, XCircle,
  type LucideIcon,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle,
} from '@/components/ui/sheet'
import { DatePicker } from '@/components/ui/date-picker'
import {
  useFeeStore, useFeeData,
  type AdditionalCharge, type AdditionalChargeCategory, type FeeTransaction,
} from '@/lib/store/fee-store'
import { useApplicationsStore, type SchoolApplication } from '@/lib/store/applications-store'
import { useStudentsStore, type StudentRecord } from '@/lib/store/students-store'
import { ACADEMIC_CLASSES } from '@/lib/mock/academic/classes'
import { formatINR, formatDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { FeeEmptyState, FeeStatusBadge } from './fees-shared'
import { MoneyInput } from './money-input'
import { CollectionExportMenu } from './collection-export'
import { Panel } from '../shared/panel'
import { CURRENT_ACADEMIC_YEAR } from '@/lib/store/fee-store-data'

const ACTOR = 'Dr. Ananya Iyer'
const CURRENT_YEAR = CURRENT_ACADEMIC_YEAR

// ─── Category meta ─────────────────────────────────────────────────────

const CHARGE_CATEGORIES: Array<{ value: AdditionalChargeCategory; icon: LucideIcon; hint: string }> = [
  { value: 'Tour', icon: Bus, hint: 'Trips & excursions' },
  { value: 'Workshop', icon: FlaskConical, hint: 'Skill sessions' },
  { value: 'Event', icon: CalendarDays, hint: 'Annual day, fairs' },
  { value: 'Competition', icon: Trophy, hint: 'Olympiads, sports' },
  { value: 'Camp', icon: Tent, hint: 'Camps & retreats' },
  { value: 'Donation', icon: HandHeart, hint: 'Funds & drives' },
  { value: 'Material', icon: Package, hint: 'Kits, uniforms, IDs' },
  { value: 'Other', icon: Tag, hint: 'Anything else' },
]

/** Module-level icon lookup — keeps dynamic icon resolution OUT of render
 *  scopes (react-hooks/static-components). */
const CATEGORY_ICON_MAP: Record<string, LucideIcon> = Object.fromEntries(
  CHARGE_CATEGORIES.map((c) => [c.value, c.icon]),
)

function CategoryIcon({ category, className }: { category: string; className?: string }) {
  const Icon = CATEGORY_ICON_MAP[category] ?? Tag
  return <Icon className={className} />
}

/** Icon chip tone — violet module accent; emerald for Donation drives. */
function categoryTone(category: string): string {
  return category === 'Donation'
    ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 ring-1 ring-emerald-500/20'
    : 'bg-violet-500/10 text-violet-600 dark:text-violet-400 ring-1 ring-violet-500/20'
}

// ─── Status chips (full lifecycle) ─────────────────────────────────────

const STATUS_CHIP: Record<AdditionalCharge['status'], string> = {
  Draft: 'bg-slate-500/10 text-slate-600 dark:text-slate-300 ring-1 ring-inset ring-slate-400/30',
  Active: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  Closed: 'bg-slate-500/10 text-slate-600 dark:text-slate-300',
  Archived: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
  Cancelled: 'bg-rose-500/10 text-rose-700 dark:text-rose-300',
}

const STATUS_LABEL: Record<AdditionalCharge['status'], string> = {
  Draft: 'Draft',
  Active: 'Open',
  Closed: 'Closed',
  Archived: 'Archived',
  Cancelled: 'Cancelled',
}

function StatusChip({ status }: { status: AdditionalCharge['status'] }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center px-1.5 py-0.5 rounded-full text-[9px] font-semibold whitespace-nowrap',
        STATUS_CHIP[status],
      )}
    >
      {STATUS_LABEL[status]}
    </span>
  )
}

// ─── Small helpers ──────────────────────────────────────────────────────

function MiniChip({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center px-1.5 py-0.5 rounded-full text-[9px] font-semibold whitespace-nowrap',
        className,
      )}
    >
      {children}
    </span>
  )
}

function initialsOf(name: string): string {
  return name
    .split(' ')
    .map((p) => p[0] ?? '')
    .slice(0, 2)
    .join('')
    .toUpperCase()
}

function classLabels(classIds: string[]): string {
  const names = classIds.map((id) => ACADEMIC_CLASSES.find((c) => c.id === id)?.name ?? id)
  if (names.length === 0) return 'No classes'
  if (names.length <= 3) return names.join(', ')
  return `${names.slice(0, 3).join(', ')} +${names.length - 3}`
}

/** Students scoped by a charge — explicit studentIds win, else the roster of
 *  the applicable classes (Active students only). */
function scopedStudentsFor(charge: AdditionalCharge, activeStudents: StudentRecord[]): StudentRecord[] {
  const ids = charge.studentIds
  if (ids && ids.length > 0) return activeStudents.filter((s) => ids.includes(s.id))
  return activeStudents.filter((s) => charge.applicableClassIds.includes(s.classId))
}

/** Per-charge roll-up used by rows and the detail drawer. */
interface ChargeFacts {
  /** Scoped (eligible) student count. */
  students: number
  /** Success + Under Verification money bound to the charge. */
  collected: number
  /** students × amount — or targetAmount for custom-amount drives (0 = open). */
  expected: number
  /** null when there is no denominator (open-amount drive). */
  pct: number | null
  /** ALL bound transactions (Payments tab). */
  txns: FeeTransaction[]
}

const EMPTY_FACTS: ChargeFacts = { students: 0, collected: 0, expected: 0, pct: null, txns: [] }

// ─── Wizard state (create + edit share one dialog) ─────────────────────

interface WizardState {
  name: string
  category: AdditionalChargeCategory
  description: string
  amount: number
  customAmount: boolean
  targetAmount: number
  applicableClassIds: string[]
  studentIds: string[]
  startDate: string
  dueDate: string
  mandatory: boolean
  instructions: string
}

function freshWizard(): WizardState {
  return {
    name: '',
    category: 'Tour',
    description: '',
    amount: 0,
    customAmount: false,
    targetAmount: 0,
    applicableClassIds: [],
    studentIds: [],
    startDate: '',
    dueDate: '',
    mandatory: true,
    instructions: '',
  }
}

function wizardFromCharge(c: AdditionalCharge): WizardState {
  return {
    name: c.name,
    category: c.category,
    description: c.description ?? '',
    amount: c.amount,
    customAmount: c.allowCustomAmount === true,
    targetAmount: c.targetAmount ?? 0,
    applicableClassIds: [...c.applicableClassIds],
    studentIds: [...(c.studentIds ?? [])],
    startDate: c.startDate ?? '',
    dueDate: c.dueDate,
    mandatory: c.mandatory,
    instructions: c.instructions ?? '',
  }
}

function wizardCandidateStudents(w: Pick<WizardState, 'applicableClassIds'>, activeStudents: StudentRecord[]): StudentRecord[] {
  const base = w.applicableClassIds.length
    ? activeStudents.filter((s) => w.applicableClassIds.includes(s.classId))
    : activeStudents
  return base.slice(0, 60)
}

// ─── Section ───────────────────────────────────────────────────────────

export function FeesAdditionalCharges({ data, onCollect }: {
  data: ReturnType<typeof useFeeData>
  /** Opens the Payments page's Collect Fee wizard (records a payment
   *  against a charge through the canonical flow). */
  onCollect?: () => void
}) {
  const { additionalCharges, transactions } = data
  const students = useStudentsStore((s) => s.students)
  const applications = useApplicationsStore((s) => s.applications)

  const [detailId, setDetailId] = useState<string | null>(null)
  const [wizard, setWizard] = useState<{ open: boolean; editing?: AdditionalCharge } | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<AdditionalCharge | null>(null)

  const activeStudents = useMemo(() => students.filter((s) => s.status === 'Active'), [students])

  // Reverse lookup — the form linked to a charge (no drift-prone field):
  // the SchoolApplication whose payment.chargeId === charge.id.
  const appByChargeId = useMemo(() => {
    const map = new Map<string, SchoolApplication>()
    for (const app of applications) {
      const cid = app.payment.chargeId
      if (cid && !map.has(cid)) map.set(cid, app)
    }
    return map
  }, [applications])

  // Live roll-up per charge from bound transactions.
  const facts = useMemo(() => {
    const map = new Map<string, ChargeFacts>()
    for (const c of additionalCharges) {
      const scoped = scopedStudentsFor(c, activeStudents)
      const txns = transactions.filter((t) => t.additionalChargeId === c.id)
      const collected = txns
        .filter((t) => t.status === 'Success' || t.status === 'Under Verification')
        .reduce((sum, t) => sum + t.amount, 0)
      const custom = c.allowCustomAmount === true
      const expected = custom ? (c.targetAmount ?? 0) : scoped.length * c.amount
      const pct = expected > 0 ? Math.min(100, Math.round((collected / expected) * 100)) : null
      map.set(c.id, { students: scoped.length, collected, expected, pct, txns })
    }
    return map
  }, [additionalCharges, transactions, activeStudents])

  // Actionable surface first: drafts + open collections, then closed, then
  // archived/cancelled (permanent record tail).
  // "Application payments" filter (spec §4): only collections linked to an
  // Applications & Forms form — never standalone collections.
  const [scopeFilter, setScopeFilter] = useState<'all' | 'application'>('all')
  const orderedCharges = useMemo(() => {
    const rank = (c: AdditionalCharge) =>
      c.status === 'Draft' ? 0 : c.status === 'Active' ? 1 : c.status === 'Closed' ? 2 : 3
    return [...additionalCharges]
      .filter((c) => (scopeFilter === 'application' ? appByChargeId.has(c.id) : true))
      .sort((a, b) => rank(a) - rank(b) || a.dueDate.localeCompare(b.dueDate))
  }, [additionalCharges, scopeFilter, appByChargeId])

  const detailCharge = detailId ? additionalCharges.find((c) => c.id === detailId) ?? null : null

  // ── Store actions (row + drawer + wizard all funnel through these) ──
  const publishCharge = (c: AdditionalCharge) => {
    const r = useFeeStore.getState().publishAdditionalCharge(c.id, ACTOR)
    if (r.success) {
      toast.success('Collection published', {
        description: `"${c.name}" is now an obligation for its ${scopedStudentsFor(c, activeStudents).length} scoped student(s).`,
      })
    } else {
      toast.error('Could not publish', { description: r.error })
    }
  }
  const closeCharge = (c: AdditionalCharge) => {
    const r = useFeeStore.getState().closeAdditionalCharge(c.id, ACTOR)
    if (r.success) toast.success('Collection closed', { description: 'Payment history stays on record.' })
    else toast.error('Could not close', { description: r.error })
  }
  const archiveCharge = (c: AdditionalCharge) => {
    const r = useFeeStore.getState().archiveAdditionalCharge(c.id, ACTOR)
    if (r.success) toast.info('Archived', { description: 'Historical record — payments remain readable.' })
    else toast.error('Could not archive', { description: r.error })
  }
  const deleteCharge = (c: AdditionalCharge) => {
    // UI-level guard: a form (any state) explicitly links to this draft →
    // deleting would orphan the form's payment path.
    const linkedApp = appByChargeId.get(c.id)
    if (linkedApp) {
      toast.error('Cannot delete this draft', {
        description: `The form "${linkedApp.title}" is linked to it. Delete that form draft first (Applications & Forms).`,
      })
      return
    }
    const r = useFeeStore.getState().deleteAdditionalCharge(c.id, ACTOR)
    if (r.success) {
      toast.success('Draft deleted', { description: `"${c.name}" was removed permanently.` })
      if (detailId === c.id) setDetailId(null)
    } else {
      toast.error('Could not delete', { description: r.error })
    }
  }

  return (
    <>
      <Panel
        title={
          <span className="inline-flex items-center gap-2">
            Additional Collections
            <Badge variant="outline" className="text-[9px] h-4 px-1.5">
              {orderedCharges.filter((c) => c.status === 'Active' || c.status === 'Draft').length}
            </Badge>
          </span>
        }
        subtitle="Money collections outside the regular fee structure — tours, events, workshops and special charges."
        action={
          <div className="inline-flex items-center gap-1.5">
            <div className="inline-flex h-7 items-center rounded-full bg-muted/70 p-0.5" role="group" aria-label="Collection scope">
              {([['all', 'All collections'], ['application', 'Application payments']] as const).map(([v, label]) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setScopeFilter(v)}
                  aria-pressed={scopeFilter === v}
                  className={cn(
                    'px-2.5 h-6 rounded-full text-[10.5px] font-medium whitespace-nowrap transition-all',
                    scopeFilter === v ? 'bg-white dark:bg-white/10 shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-[11px] gap-1 shrink-0"
              onClick={() => setWizard({ open: true })}
              aria-label="Create a new collection"
            >
              <Plus className="h-3 w-3" /> New Collection
            </Button>
          </div>
        }
        bodyClassName="p-0"
      >
        {orderedCharges.length > 0 ? (
          <div className="divide-y divide-border">
            {orderedCharges.map((c) => {
              const f = facts.get(c.id) ?? EMPTY_FACTS
              const app = appByChargeId.get(c.id)
              return (
                <motion.div key={c.id} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}>
                  <CollectionRow
                    charge={c}
                    facts={f}
                    app={app}
                    hasLinkedForm={appByChargeId.has(c.id)}
                    onOpen={() => setDetailId(c.id)}
                    onEdit={() => setWizard({ open: true, editing: c })}
                    onPublish={() => publishCharge(c)}
                    onClose={() => closeCharge(c)}
                    onArchive={() => archiveCharge(c)}
                    onDelete={() => setDeleteTarget(c)}
                    onCollect={onCollect}
                  />
                </motion.div>
              )
            })}
          </div>
        ) : (
          <FeeEmptyState
            icon={<CircleDollarSign className="h-6 w-6" />}
            title={scopeFilter === 'application' ? 'No application payments yet' : 'No additional collections yet'}
            description={scopeFilter === 'application'
              ? 'Collections linked to a published form appear here once a paid form goes live.'
              : 'Create a collection for a tour, event, workshop, activity or any special school charge.'}
            action={scopeFilter === 'all' ? (
              <Button variant="outline" size="sm" className="h-7 text-[11px] gap-1" onClick={() => setWizard({ open: true })}>
                <Plus className="h-3 w-3" /> New Collection
              </Button>
            ) : undefined}
          />
        )}
      </Panel>

      {/* Creation / edit wizard */}
      {wizard?.open && (
        <CollectionWizardDialog
          editing={wizard.editing}
          activeStudents={activeStudents}
          onClose={() => setWizard(null)}
        />
      )}

      {/* Delete-draft confirmation (§17 — honest, non-technical language) */}
      {deleteTarget && (
        <AlertDialog open onOpenChange={(o) => { if (!o) setDeleteTarget(null) }}>
          <AlertDialogContent className="max-w-sm">
            <AlertDialogHeader>
              <AlertDialogTitle>Delete draft collection?</AlertDialogTitle>
              <AlertDialogDescription>
                {appByChargeId.has(deleteTarget.id)
                  ? `The form "${appByChargeId.get(deleteTarget.id)!.title}" is linked to this collection — delete that form draft first.`
                  : `"${deleteTarget.name}" has not been published and has no payments on record. It will be permanently removed.`}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-rose-600 hover:bg-rose-700 text-white"
                disabled={appByChargeId.has(deleteTarget.id)}
                onClick={() => { deleteCharge(deleteTarget); setDeleteTarget(null) }}
              >
                Delete Draft
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}

      {/* Collection status drawer */}
      {detailCharge && (
        <CollectionStatusSheet
          charge={detailCharge}
          facts={facts.get(detailCharge.id) ?? EMPTY_FACTS}
          app={appByChargeId.get(detailCharge.id)}
          activeStudents={activeStudents}
          onClose={() => setDetailId(null)}
          onEdit={() => { setDetailId(null); setWizard({ open: true, editing: detailCharge }) }}
          onPublish={() => publishCharge(detailCharge)}
          onCloseCollection={() => closeCharge(detailCharge)}
          onArchive={() => archiveCharge(detailCharge)}
          onDelete={() => setDeleteTarget(detailCharge)}
          onCollect={onCollect}
        />
      )}
    </>
  )
}

// ─── One collection row + state-aware action menu ──────────────────────

function CollectionRow({
  charge, facts, app, hasLinkedForm: _hasLinkedForm, onOpen, onEdit, onPublish, onClose, onArchive, onDelete, onCollect,
}: {
  charge: AdditionalCharge
  facts: ChargeFacts
  app?: SchoolApplication
  hasLinkedForm: boolean
  onOpen: () => void
  onEdit: () => void
  onPublish: () => void
  onClose: () => void
  onArchive: () => void
  onDelete: () => void
  onCollect?: () => void
}) {
  // ── State-aware action menu (§16): only meaningful actions per state ──
  const actions: Array<{ label: string; icon: ReactNode; onSelect: () => void; danger?: boolean }> = []
  if (charge.status === 'Draft') {
    actions.push(
      { label: 'Edit draft', icon: <PencilLine className="h-3.5 w-3.5" />, onSelect: onEdit },
      { label: 'Publish now', icon: <Send className="h-3.5 w-3.5" />, onSelect: onPublish },
      { label: 'Delete draft', icon: <Trash2 className="h-3.5 w-3.5" />, onSelect: onDelete, danger: true },
    )
  } else if (charge.status === 'Active') {
    if (onCollect) {
      actions.push({ label: 'Record payment', icon: <Wallet className="h-3.5 w-3.5" />, onSelect: onCollect })
    }
    actions.push(
      { label: 'Edit safe details', icon: <PencilLine className="h-3.5 w-3.5" />, onSelect: onEdit },
      { label: 'Close collection', icon: <XCircle className="h-3.5 w-3.5" />, onSelect: onClose },
    )
  } else if (charge.status === 'Closed') {
    actions.push({ label: 'Archive', icon: <Archive className="h-3.5 w-3.5" />, onSelect: onArchive })
  }
  // Every state: view status (open drawer).

  return (
    <div className="relative flex items-start justify-between gap-3 px-4 py-2.5 hover:bg-muted/30 transition-colors">
      <button
        type="button"
        onClick={onOpen}
        className="flex items-start gap-3 min-w-0 flex-1 text-left"
        aria-label={`Open ${charge.name} payment status`}
      >
        {/* Left — category icon chip + name + chips + meta line */}
        <div className="flex items-start gap-3 min-w-0 flex-1">
          <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', categoryTone(charge.category))}>
            <CategoryIcon category={charge.category} className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 min-w-0">
              <p className={cn('text-xs font-semibold truncate', charge.status !== 'Active' && charge.status !== 'Draft' && 'text-muted-foreground')}>{charge.name}</p>
              {charge.status === 'Draft' && (
                <MiniChip className="bg-slate-500/10 text-slate-600 dark:text-slate-300 ring-1 ring-inset ring-slate-400/30">Draft</MiniChip>
              )}
              <MiniChip className={charge.mandatory ? 'bg-slate-500/10 text-slate-600 dark:text-slate-300' : 'bg-muted text-muted-foreground'}>
                {charge.mandatory ? 'Mandatory' : 'Optional'}
              </MiniChip>
              {charge.allowCustomAmount && (
                <MiniChip className="bg-violet-500/10 text-violet-700 dark:text-violet-300">Custom amount</MiniChip>
              )}
            </div>
            <p className="text-[10px] text-muted-foreground mt-0.5 truncate">
              <span className="font-medium">{charge.category}</span>
              {' · '}{app ? `Linked form · ${app.title}` : charge.status === 'Draft' ? 'Draft — not published yet' : 'Standalone'}
              {' · '}{classLabels(charge.applicableClassIds)}
              {charge.studentIds?.length ? ` · ${charge.studentIds.length} students` : charge.status !== 'Draft' ? ` · ${facts.students} student${facts.students === 1 ? '' : 's'}` : ''}
              {charge.dueDate ? ` · due ${formatDate(charge.dueDate)}` : ' · no due date'}
            </p>
            {/* Mobile-only figures — the right rail is hidden below sm */}
            <p className="sm:hidden mt-1 text-[10px] text-muted-foreground tabular-nums">
              {charge.status === 'Draft'
                ? 'No payments while in draft'
                : `${formatINR(facts.collected)} collected · ${facts.txns.length} payment${facts.txns.length === 1 ? '' : 's'}`}
            </p>
          </div>
        </div>

        {/* Right — labelled figures, progress, status */}
        <div className="hidden sm:block shrink-0 w-36 lg:w-40 text-right">
          {charge.status === 'Draft' ? (
            <p className="text-[10px] text-muted-foreground leading-tight pt-1.5">
              {charge.allowCustomAmount
                ? <>open amount{charge.targetAmount ? ` · target ${formatINR(charge.targetAmount)}` : ''}</>
                : <>{formatINR(charge.amount)} per student</>}
              <span className="block mt-0.5">publish to start collecting</span>
            </p>
          ) : (
            <>
              <p className={cn('text-sm font-bold tabular-nums leading-tight truncate', facts.collected > 0 && 'text-emerald-600 dark:text-emerald-400')}>
                {formatINR(facts.collected)}{' '}
                <span className="text-[9px] font-semibold text-muted-foreground">collected</span>
              </p>
              <p className="text-[9px] text-muted-foreground truncate">
                {charge.allowCustomAmount
                  ? charge.targetAmount
                    ? <>of {formatINR(charge.targetAmount)} target</>
                    : 'open amount'
                  : <>of {formatINR(facts.expected)} expected</>}
              </p>
              {facts.pct != null && (
                <div className="mt-1.5 flex items-center gap-1.5">
                  <div aria-hidden className="h-1.5 flex-1 rounded-full bg-muted overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${facts.pct}%` }}
                      transition={{ duration: 0.5, ease: 'easeOut' }}
                      className="h-full rounded-full bg-emerald-500"
                    />
                  </div>
                  <span className="w-7 text-right text-[9px] font-semibold text-muted-foreground tabular-nums">{facts.pct}%</span>
                </div>
              )}
            </>
          )}
          <div className="mt-1.5 flex items-center justify-end gap-1.5">
            <StatusChip status={charge.status} />
            <span className="text-[10px] text-muted-foreground tabular-nums">
              {charge.status === 'Draft' ? '—' : `${facts.txns.length} payment${facts.txns.length === 1 ? '' : 's'}`}
            </span>
          </div>
        </div>
      </button>

      {/* Kebab — lifecycle actions */}
      <div className="shrink-0 relative z-10">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-colors"
              aria-label={`Actions for ${charge.name}`}
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52 z-[70]">
            <DropdownMenuItem onSelect={onOpen} className="text-[11px]">
              <FileText className="h-3.5 w-3.5" /> View status
            </DropdownMenuItem>
            {actions.length > 0 && <DropdownMenuSeparator />}
            {actions.map((a) => (
              <Fragment key={a.label}>
                <DropdownMenuItem
                  onSelect={a.onSelect}
                  className={cn('text-[11px]', a.danger && 'text-rose-600 focus:text-rose-600 dark:text-rose-400 dark:focus:text-rose-400')}
                >
                  {a.icon} {a.label}
                </DropdownMenuItem>
              </Fragment>
            ))}
            {charge.status === 'Archived' && actions.length === 0 && (
              <p className="px-2 py-1.5 text-[10px] text-muted-foreground">Permanent historical record</p>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}

// ─── Collection wizard (create + edit) ─────────────────────────────────

function CollectionWizardDialog({
  editing, activeStudents, onClose,
}: {
  editing?: AdditionalCharge
  activeStudents: StudentRecord[]
  onClose: () => void
}) {
  const createAdditionalCharge = useFeeStore((s) => s.createAdditionalCharge)
  const updateAdditionalCharge = useFeeStore((s) => s.updateAdditionalCharge)

  const [w, setW] = useState<WizardState>(() => editing ? wizardFromCharge(editing) : freshWizard())
  const patch = (p: Partial<WizardState>) => setW((f) => ({ ...f, ...p }))

  const isEditActive = editing?.status === 'Active'
  // Money lock: amount frozen once payments exist (the store enforces too).
  const boundPayments = useFeeStore((s) => (editing ? s.transactions.filter((t) => t.additionalChargeId === editing.id).length : 0))
  const amountLocked = isEditActive && boundPayments > 0

  const _toggleClass = (id: string) => {
    const next = w.applicableClassIds.includes(id)
      ? w.applicableClassIds.filter((c) => c !== id)
      : [...w.applicableClassIds, id]
    patch({ applicableClassIds: next })
  }
  const toggleStudent = (id: string) => {
    const next = w.studentIds.includes(id)
      ? w.studentIds.filter((s) => s !== id)
      : [...w.studentIds, id]
    patch({ studentIds: next })
  }

  const candidates = useMemo(
    () => wizardCandidateStudents({ applicableClassIds: w.applicableClassIds }, activeStudents),
    [w.applicableClassIds, activeStudents],
  )
  const scopedCount = w.studentIds.length
    ? w.studentIds.length
    : activeStudents.filter((s) => w.applicableClassIds.includes(s.classId)).length

  const handleSave = (publish: boolean) => {
    if (!w.name.trim()) { toast.error('Give this collection a name.'); return }
    if (!w.customAmount && !(w.amount > 0)) { toast.error('Enter the per-student amount.'); return }
    if (w.customAmount && w.targetAmount > 0 && !(w.amount >= 0)) { toast.error('The suggested amount cannot be negative.'); return }
    if (!publish && !w.applicableClassIds.length && !w.studentIds.length) {
      // Draft without scope is allowed (Principal still picking targets).
    } else if (publish && !w.applicableClassIds.length && !w.studentIds.length) {
      toast.error('Select at least one class (or specific students) before publishing.')
      return
    }
    if (!w.dueDate) { toast.error('Set a payment due date.'); return }

    if (editing) {
      const r = updateAdditionalCharge(editing.id, {
        name: w.name,
        category: w.category,
        description: w.description,
        amount: w.amount,
        applicableClassIds: w.applicableClassIds,
        studentIds: w.studentIds,
        dueDate: w.dueDate,
        startDate: w.startDate,
        mandatory: w.mandatory,
        allowCustomAmount: w.customAmount,
        targetAmount: w.targetAmount,
        instructions: w.instructions,
      }, ACTOR)
      if (!r.success) { toast.error('Could not save changes', { description: r.error }); return }
      if (publish && editing.status === 'Draft') {
        const p = useFeeStore.getState().publishAdditionalCharge(editing.id, ACTOR)
        if (!p.success) { toast.error('Saved — but publishing failed', { description: p.error }); onClose(); return }
        toast.success('Collection published', { description: `"${w.name}" is now collecting.` })
      } else {
        toast.success('Changes saved')
      }
      onClose()
      return
    }
    const r = createAdditionalCharge({
      name: w.name,
      category: w.category,
      amount: w.amount,
      academicYear: CURRENT_YEAR,
      applicableClassIds: w.applicableClassIds,
      studentIds: w.studentIds.length ? w.studentIds : undefined,
      dueDate: w.dueDate,
      startDate: w.startDate || undefined,
      mandatory: w.mandatory,
      description: w.description || undefined,
      instructions: w.instructions || undefined,
      allowCustomAmount: w.customAmount || undefined,
      targetAmount: w.customAmount && w.targetAmount > 0 ? w.targetAmount : undefined,
      status: publish ? 'Active' : 'Draft',
      actor: ACTOR,
    })
    if (!r.success || !r.charge) { toast.error('Could not create the collection', { description: r.error }); return }
    toast.success(publish ? 'Collection published' : 'Draft collection created', {
      description: publish
        ? `"${w.name}" is now an obligation for its scoped students.`
        : `"${w.name}" is saved as a draft — publish it when you are ready.`,
    })
    onClose()
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-lg max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? `Edit — ${editing.name}` : 'New Collection'}</DialogTitle>
          <DialogDescription>
            {editing
              ? isEditActive
                ? 'Safe details only — name, amount and terms are locked while the collection is live.'
                : 'Draft collections are fully editable and can be deleted until published.'
              : 'A special school charge — tour, event, workshop, fund or material. No form is required.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Identity */}
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="coll-name" className="text-xs">Collection name</Label>
              <Input
                id="coll-name"
                className="h-8 text-xs"
                placeholder="e.g. Educational Tour — Jaipur"
                value={w.name}
                disabled={isEditActive}
                onChange={(e) => patch({ name: e.target.value })}
              />
            </div>
            <div>
              <Label className="text-xs">Type</Label>
              <div className="mt-1.5 grid grid-cols-4 gap-1.5">
                {CHARGE_CATEGORIES.map((c) => {
                  const selected = w.category === c.value
                  return (
                    <button
                      key={c.value}
                      type="button"
                      onClick={() => patch({ category: c.value })}
                      aria-pressed={selected}
                      className={cn(
                        'flex flex-col items-center gap-1 rounded-lg border px-1.5 py-2 transition-all',
                        selected
                          ? 'border-primary bg-primary/5 ring-1 ring-primary/20'
                          : 'border-border hover:border-primary/40',
                      )}
                      aria-label={`${c.value} — ${c.hint}`}
                    >
                      <c.icon className={cn('h-4 w-4', selected ? 'text-primary' : 'text-muted-foreground')} />
                      <span className="text-[9.5px] font-medium leading-tight text-center">{c.value}</span>
                    </button>
                  )
                })}
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="coll-desc" className="text-xs">Description <span className="text-muted-foreground font-normal">(shown to parents)</span></Label>
              <Textarea
                id="coll-desc"
                className="min-h-[56px] text-xs"
                placeholder="What this charge covers, opt-out rules…"
                value={w.description}
                onChange={(e) => patch({ description: e.target.value })}
              />
            </div>
          </div>

          {/* Money */}
          <div className="rounded-lg border border-border p-3 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold">Fixed amount per student</p>
                <p className="text-[10px] text-muted-foreground">Turn off for donation-style drives with custom contributions.</p>
              </div>
              <Switch
                checked={!w.customAmount}
                onCheckedChange={(fixed) => patch({ customAmount: !fixed })}
                disabled={isEditActive}
                aria-label="Fixed amount per student"
              />
            </div>
            {w.customAmount ? (
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label className="text-xs">Suggested amount</Label>
                  <MoneyInput value={w.amount} onChange={(v) => patch({ amount: v ?? 0 })} className="h-8 text-xs" disabled={amountLocked} />
                </div>
                <div className="grid gap-1.5">
                  <Label className="text-xs">Overall target <span className="text-muted-foreground font-normal">(optional)</span></Label>
                  <MoneyInput value={w.targetAmount} onChange={(v) => patch({ targetAmount: v ?? 0 })} className="h-8 text-xs" />
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label className="text-xs">Amount per student</Label>
                  <MoneyInput value={w.amount} onChange={(v) => patch({ amount: v ?? 0 })} className="h-8 text-xs" disabled={amountLocked} />
                  {amountLocked && <p className="text-[10px] text-amber-600 dark:text-amber-400">Locked — payments exist against this collection.</p>}
                </div>
                <div className="grid gap-1.5">
                  <Label className="text-xs">Expected total</Label>
                  <p className="h-8 flex items-center text-xs font-semibold tabular-nums text-muted-foreground border border-dashed border-border rounded-md px-2.5">
                    {w.applicableClassIds.length || w.studentIds.length
                      ? formatINR(w.customAmount ? w.targetAmount : w.amount * scopedCount)
                      : 'select scope'}
                  </p>
                </div>
              </div>
            )}
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold">Mandatory for scoped students</p>
                <p className="text-[10px] text-muted-foreground">Optional charges can be declined by the payer.</p>
              </div>
              <Switch
                checked={w.mandatory}
                onCheckedChange={(v) => patch({ mandatory: v })}
                disabled={isEditActive}
                aria-label="Mandatory for scoped students"
              />
            </div>
          </div>

          {/* Scope */}
          <div className="rounded-lg border border-border p-3 space-y-3">
            <div>
              <Label className="text-xs">Applicable classes</Label>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {UNIQUE_CLASSES.map((c) => {
                  const _selected = w.applicableClassIds.includes(c.id)
                  // Classes share ids across sections — toggling one toggles all sections of the class name.
                  const idsOfName = ACADEMIC_CLASSES.filter((ac) => ac.name === c.name).map((ac) => ac.id)
                  const isOn = idsOfName.every((id) => w.applicableClassIds.includes(id))
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => {
                        const next = isOn
                          ? w.applicableClassIds.filter((id) => !idsOfName.includes(id))
                          : Array.from(new Set([...w.applicableClassIds, ...idsOfName]))
                        patch({ applicableClassIds: next })
                      }}
                      aria-pressed={isOn}
                      className={cn(
                        'h-7 px-2.5 rounded-full text-[11px] font-medium border transition-all',
                        isOn ? 'border-primary bg-primary/5 text-primary ring-1 ring-primary/20' : 'border-border text-muted-foreground hover:border-primary/40',
                      )}
                    >
                      {c.name}
                    </button>
                  )
                })}
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between">
                <Label className="text-xs">Specific students <span className="text-muted-foreground font-normal">(optional override)</span></Label>
                <span className="text-[10px] text-muted-foreground tabular-nums">
                  {w.studentIds.length ? `${w.studentIds.length} selected` : `${scopedCount} in scope`}
                </span>
              </div>
              {candidates.length > 0 && (
                <div className="mt-1.5 max-h-28 overflow-y-auto rounded-md border border-border divide-y divide-border/60">
                  {candidates.map((s) => (
                    <label key={s.id} className="flex items-center gap-2 px-2.5 py-1.5 hover:bg-muted/30 cursor-pointer">
                      <input
                        type="checkbox"
                        className="h-3.5 w-3.5 accent-primary"
                        checked={w.studentIds.includes(s.id)}
                        onChange={() => toggleStudent(s.id)}
                        aria-label={`Include ${s.name}`}
                      />
                      <span className="text-[11px] font-medium truncate">{s.name}</span>
                      <span className="ml-auto text-[9px] text-muted-foreground shrink-0">{s.className} — {s.section}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Schedule */}
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label className="text-xs">Start date <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <DatePicker value={w.startDate || undefined} onChange={(d) => patch({ startDate: d ?? '' })} className="h-8 text-xs" />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">Due date</Label>
              <DatePicker value={w.dueDate || undefined} onChange={(d) => patch({ dueDate: d ?? '' })} className="h-8 text-xs" />
            </div>
          </div>

          {/* Instructions */}
          <div className="grid gap-1.5">
            <Label htmlFor="coll-instructions" className="text-xs">Instructions for payers <span className="text-muted-foreground font-normal">(optional)</span></Label>
            <Textarea
              id="coll-instructions"
              className="min-h-[48px] text-xs"
              placeholder="Where/how to pay, office timings, contact for queries…"
              value={w.instructions}
              onChange={(e) => patch({ instructions: e.target.value })}
            />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={onClose}>Cancel</Button>
          {(!editing || editing.status === 'Draft') ? (
            <>
              <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => handleSave(false)}>
                <Edit3 className="h-3.5 w-3.5" /> Save as draft
              </Button>
              <Button size="sm" className="h-8 text-xs" onClick={() => handleSave(true)}>
                <CheckCircle2 className="h-3.5 w-3.5" /> Save &amp; publish
              </Button>
            </>
          ) : (
            <Button size="sm" className="h-8 text-xs" onClick={() => handleSave(false)}>
              <CheckCircle2 className="h-3.5 w-3.5" /> Save changes
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const UNIQUE_CLASSES = (() => {
  const seen = new Set<string>()
  return ACADEMIC_CLASSES.filter((c) => {
    if (seen.has(c.name)) return false
    seen.add(c.name)
    return true
  })
})()

// ─── Collection status drawer ──────────────────────────────────────────

type DetailTab = 'students' | 'payments'

const DETAIL_TABS: Array<{ value: DetailTab; label: string }> = [
  { value: 'students', label: 'Students' },
  { value: 'payments', label: 'Payments' },
]

function MiniTile({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="min-w-0 rounded-lg bg-muted/30 px-2 py-1.5">
      <p className="text-[9px] uppercase font-semibold tracking-wider text-muted-foreground truncate">{label}</p>
      <p className={cn('mt-0.5 truncate text-xs font-bold tabular-nums', accent && 'text-emerald-600 dark:text-emerald-400')}>{value}</p>
    </div>
  )
}

function CollectionStatusSheet({
  charge, facts, app, activeStudents, onClose, onEdit, onPublish, onCloseCollection, onArchive, onDelete, onCollect,
}: {
  charge: AdditionalCharge
  facts: ChargeFacts
  app?: SchoolApplication
  activeStudents: StudentRecord[]
  onClose: () => void
  onEdit: () => void
  onPublish: () => void
  onCloseCollection: () => void
  onArchive: () => void
  onDelete: () => void
  onCollect?: () => void
}) {
  const [tab, setTab] = useState<DetailTab>('students')
  const submissions = useApplicationsStore((s) => s.submissions)
  const linkedSubs = useMemo(
    () => app ? submissions.filter((sub) => sub.applicationId === app.id) : [],
    [app, submissions],
  )

  const isCustom = charge.allowCustomAmount === true
  const scoped = useMemo(() => scopedStudentsFor(charge, activeStudents), [charge, activeStudents])

  // Per-student payment state derived from the bound transactions.
  const studentStates = useMemo(() => {
    const map = new Map<string, { paid: number; verifying: boolean }>()
    for (const t of facts.txns) {
      const cur = map.get(t.studentId) ?? { paid: 0, verifying: false }
      if (t.status === 'Success' || t.status === 'Under Verification') cur.paid += t.amount
      if (t.status === 'Under Verification') cur.verifying = true
      map.set(t.studentId, cur)
    }
    return map
  }, [facts.txns])

  const paidCount = scoped.filter((s) => {
    const st = studentStates.get(s.id)
    const paid = st?.paid ?? 0
    return isCustom ? paid > 0 : paid >= charge.amount
  }).length

  // Bound payments, newest first (Payments tab).
  const payments = useMemo(
    () => [...facts.txns].sort((a, b) => b.date.localeCompare(a.date) || b.receiptNo.localeCompare(a.receiptNo)),
    [facts.txns],
  )

  // Compact meta rows — record context without a separate management tab.
  const metaRows: Array<{ label: string; value: string }> = []
  if (charge.description) metaRows.push({ label: 'Description', value: charge.description })
  if (charge.instructions) metaRows.push({ label: 'Instructions', value: charge.instructions })
  if (charge.reference) metaRows.push({ label: 'Reference', value: charge.reference })
  metaRows.push({
    label: 'Created by',
    value: `${charge.createdBy}${charge.createdAt ? ` · ${formatDate(charge.createdAt)}` : ''}`,
  })
  metaRows.push({ label: 'Session', value: charge.academicYear })
  metaRows.push({ label: 'Due date', value: formatDate(charge.dueDate) })
  if (charge.status === 'Closed') {
    metaRows.push({
      label: 'Closed',
      value: `${charge.closedAt ? formatDate(charge.closedAt) : '—'}${charge.closeNote ? ` — ${charge.closeNote}` : ''}`,
    })
  }
  if (charge.status === 'Cancelled') {
    metaRows.push({ label: 'Cancelled', value: charge.cancelReason ?? 'No reason recorded' })
  }
  if (charge.status === 'Archived') {
    metaRows.push({
      label: 'Archived',
      value: `${charge.archivedAt ? formatDate(charge.archivedAt) : '—'}${charge.archiveNote ? ` — ${charge.archiveNote}` : ''}`,
    })
  }

  const expectedDisplay = charge.status === 'Draft'
    ? isCustom
      ? charge.targetAmount ? formatINR(charge.targetAmount) : 'Open'
      : formatINR(charge.amount * scoped.length)
    : isCustom
      ? charge.targetAmount && charge.targetAmount > 0 ? formatINR(charge.targetAmount) : 'Open'
      : formatINR(facts.expected)
  const pendingDisplay = facts.expected > 0
    ? formatINR(Math.max(0, facts.expected - facts.collected))
    : isCustom ? '—' : formatINR(0)

  return (
    <Sheet open onOpenChange={(o) => { if (!o) onClose() }}>
      <SheetContent side="right" className="w-full sm:max-w-md p-0 gap-0 flex flex-col">
        {/* Header — icon chip + name + status + source line */}
        <SheetHeader className="space-y-0 border-b border-border/60 px-4 pb-3 pt-4 text-left">
          <div className="flex items-start gap-3 pr-8">
            <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', categoryTone(charge.category))}>
              <CategoryIcon category={charge.category} className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 min-w-0">
                <SheetTitle className="truncate text-sm font-bold leading-tight">{charge.name}</SheetTitle>
                <StatusChip status={charge.status} />
              </div>
              <SheetDescription className="mt-0.5 truncate text-[10px] text-muted-foreground">
                {app ? `Linked form · ${app.title}` : charge.status === 'Draft' ? 'Draft — not published yet' : 'Standalone'} · {charge.category}
              </SheetDescription>
            </div>
          </div>
        </SheetHeader>

        {/* Summary strip — 4 labelled mini tiles + progress */}
        <div className="border-b border-border/60 px-4 pb-2.5 pt-3">
          <div className="grid grid-cols-4 gap-1.5">
            <MiniTile label="Expected" value={expectedDisplay} />
            <MiniTile label="Collected" value={charge.status === 'Draft' ? '—' : formatINR(facts.collected)} accent={facts.collected > 0} />
            <MiniTile label="Pending" value={charge.status === 'Draft' ? '—' : pendingDisplay} />
            <MiniTile label="Students" value={String(charge.status === 'Draft' ? scoped.length : facts.students)} />
          </div>
          {charge.status !== 'Draft' && facts.pct != null && (
            <div className="mt-2 flex items-center gap-1.5">
              <div aria-hidden className="h-1.5 flex-1 rounded-full bg-muted overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${facts.pct}%` }}
                  transition={{ duration: 0.5, ease: 'easeOut' }}
                  className="h-full rounded-full bg-emerald-500"
                />
              </div>
              <span className="w-7 text-right text-[9px] font-semibold text-muted-foreground tabular-nums">{facts.pct}%</span>
            </div>
          )}
        </div>

        {/* Linked form block (§29/§36) — responses + payments at a glance */}
        {app && (
          <div className="border-b border-border/60 px-4 py-2.5">
            <div className="flex items-center gap-2.5">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-sky-500/10 text-sky-600 dark:text-sky-400 ring-1 ring-sky-500/20">
                <FileText className="h-3.5 w-3.5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[11px] font-semibold">{app.title}</p>
                <p className="text-[9.5px] text-muted-foreground truncate">
                  {linkedSubs.length} response{linkedSubs.length === 1 ? '' : 's'} · deadline {app.deadline ? formatDate(app.deadline) : '—'} · form handles responses, this collection handles the money
                </p>
              </div>
              <span className="shrink-0 text-[9px] uppercase tracking-wider text-muted-foreground">Linked form</span>
            </div>
          </div>
        )}

        {/* Compact segmented tab row + export (§37 — take the answer outside the app) */}
        <div className="flex items-center gap-1 border-b border-border/60 px-4 py-2" role="tablist" aria-label="Collection detail tabs">
          {DETAIL_TABS.map((t) => (
            <button
              key={t.value}
              type="button"
              role="tab"
              aria-selected={tab === t.value}
              onClick={() => setTab(t.value)}
              className={cn(
                'rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors',
                tab === t.value ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/50',
              )}
            >
              {t.label}
            </button>
          ))}
          {charge.status !== 'Draft' && (
            <div className="ml-auto">
              <CollectionExportMenu
                compact
                data={{
                  charge,
                  scoped,
                  studentStates,
                  payments,
                  app,
                  paidCount,
                  actor: ACTOR,
                }}
              />
            </div>
          )}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 py-3">
          {tab === 'students' && (
            <div>
              <p className="pb-1.5 text-[10px] text-muted-foreground">
                {charge.status === 'Draft'
                  ? 'Draft scope preview — publish to make it an obligation.'
                  : `${paidCount} of ${scoped.length} paid${isCustom ? ' · any contribution counts' : ''}`}
              </p>
              <div className="divide-y divide-border/60">
                {scoped.map((s) => {
                  const st = studentStates.get(s.id)
                  const paid = st?.paid ?? 0
                  const isPaid = isCustom ? paid > 0 : paid >= charge.amount
                  return (
                    <div key={s.id} className="flex items-center gap-2.5 py-2">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-[9px] font-bold text-muted-foreground">
                        {initialsOf(s.name)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium">{s.name}</p>
                        <p className="text-[9px] text-muted-foreground">{s.className}{paid > 0 ? ` · paid ${formatINR(paid)}` : ''}</p>
                      </div>
                      {charge.status === 'Draft' ? (
                        <MiniChip className="bg-muted text-muted-foreground">Draft</MiniChip>
                      ) : isPaid ? (
                        <MiniChip className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">Paid</MiniChip>
                      ) : st?.verifying ? (
                        <MiniChip className="bg-amber-500/10 text-amber-700 dark:text-amber-300">Verifying</MiniChip>
                      ) : (
                        <MiniChip className="bg-muted text-muted-foreground">Not paid</MiniChip>
                      )}
                    </div>
                  )
                })}
                {scoped.length === 0 && (
                  <p className="py-6 text-center text-xs text-muted-foreground">No students match this collection&apos;s scope.</p>
                )}
              </div>
            </div>
          )}

          {tab === 'payments' && (
            <div>
              {payments.length > 0 ? (
                <div className="divide-y divide-border/60">
                  {payments.map((t) => (
                    <div key={t.id} className="flex items-center gap-2.5 py-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium">{t.studentName}</p>
                        <p className="font-mono text-[10px] text-muted-foreground">{t.receiptNo}</p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-xs font-bold tabular-nums">{formatINR(t.amount)}</p>
                        <p className="mt-0.5 text-[9px] text-muted-foreground">{t.mode} · {formatDate(t.date)}</p>
                      </div>
                      <FeeStatusBadge status={t.status} />
                    </div>
                  ))}
                </div>
              ) : (
                <p className="py-6 text-center text-xs text-muted-foreground">
                  {charge.status === 'Draft'
                    ? 'No payments can exist while the collection is a draft.'
                    : 'No payments recorded against this collection yet.'}
                </p>
              )}
            </div>
          )}

          {/* Record context — quiet meta block below the tab content */}
          {metaRows.length > 0 && (
            <div className="mt-4 rounded-lg bg-muted/30 px-3 py-2.5">
              <div className="divide-y divide-border/40">
                {metaRows.map((r) => (
                  <div key={r.label} className="py-1.5 first:pt-0 last:pb-0">
                    <p className="text-[9px] uppercase font-semibold tracking-wider text-muted-foreground">{r.label}</p>
                    <p className="mt-0.5 break-words text-[11px] font-medium">{r.value}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Lifecycle footer — state-aware (§5) */}
        <div className="border-t border-border/60 px-4 py-3 flex items-center gap-2 flex-wrap">
          {charge.status === 'Draft' && (
            <>
              <Button size="sm" className="h-7 text-[11px] gap-1" onClick={onPublish}>
                <Send className="h-3 w-3" /> Publish
              </Button>
              <Button variant="outline" size="sm" className="h-7 text-[11px] gap-1" onClick={onEdit}>
                <PencilLine className="h-3 w-3" /> Edit
              </Button>
              <Button variant="outline" size="sm" className="h-7 text-[11px] gap-1 ml-auto text-rose-600 hover:text-rose-700 dark:text-rose-400" onClick={onDelete}>
                <Trash2 className="h-3 w-3" /> Delete draft
              </Button>
            </>
          )}
          {charge.status === 'Active' && (
            <>
              {onCollect && (
                <Button size="sm" className="h-7 text-[11px] gap-1" onClick={onCollect}>
                  <Wallet className="h-3 w-3" /> Record payment
                </Button>
              )}
              <Button variant="outline" size="sm" className="h-7 text-[11px] gap-1" onClick={onEdit}>
                <PencilLine className="h-3 w-3" /> Edit details
              </Button>
              <Button variant="outline" size="sm" className="h-7 text-[11px] gap-1 ml-auto" onClick={onCloseCollection}>
                <Lock className="h-3 w-3" /> Close collection
              </Button>
            </>
          )}
          {charge.status === 'Closed' && (
            <Button variant="outline" size="sm" className="h-7 text-[11px] gap-1" onClick={onArchive}>
              <Archive className="h-3 w-3" /> Archive
            </Button>
          )}
          {(charge.status === 'Archived' || charge.status === 'Cancelled') && (
            <p className="text-[10px] text-muted-foreground flex items-center gap-1.5">
              <IndianRupee className="h-3 w-3" /> Payment history is permanent and stays readable.
            </p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
