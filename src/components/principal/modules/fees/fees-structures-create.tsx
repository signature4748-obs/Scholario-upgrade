'use client'

/**
 * FeesStructuresCreateDialog — create a DRAFT fee structure via the
 * canonical server API (Phase 7-D).
 *
 * CONTRACT (POST /api/fees/structures):
 *   · classId   — MUST be a REAL Class row of this school (FK re-validated
 *                 in-tenant) → the class picker is fed by GET /api/classes,
 *                 never the mock ACADEMIC_CLASSES constant.
 *   · className / classLevel — derived from the selected class row.
 *   · heads[]   — ≤60 entries; each { catalogueId?, name, category,
 *                 amount, frequency, mandatory }. Heads can be picked from
 *                 the MasterFeeHead catalogue (GET /api/fees/catalogue —
 *                 catalogueIds are batch FK-validated) or typed as custom
 *                 heads (no catalogueId).
 *   · amount    — STRING as typed (≤2 decimals, 0–500000); the server zod
 *                 (z.coerce.number()) parses it. No float arithmetic here.
 *
 * The POST always creates a DRAFT (status='draft', version=1). Publishing
 * is a separate server action (POST .../publish) from the detail drawer.
 * A 409 surfaces verbatim when a current structure already exists for the
 * selected class. NOTE: the server contract has no effective-date input
 * (effectiveFrom is set at publish time) and no scheduled status.
 */

import { useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Plus, Loader2, AlertTriangle, Info } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { toast } from 'sonner'
import { useDismissOnEscape } from '@/hooks/use-dismiss-on-escape'
import {
  useFeeClasses,
  useFeeCatalogue,
  useCreateFeeStructure,
  parseAmountInput,
  MAX_HEADS,
  type FeeHeadInput,
} from './fees-structures-hooks'
import { DraftHeadsEditor, newRowKey, type DraftHead } from './fees-structures-shared'

export interface CreateDialogProps {
  open: boolean
  onClose: () => void
  /** Receives the created (draft) structure id — the parent opens the detail drawer. */
  onCreated: (id: string) => void
}

export function FeesStructuresCreateDialog({ open, onClose, onCreated }: CreateDialogProps) {
  const { classes, loading: classesLoading, error: classesError } = useFeeClasses()
  const { catalogue } = useFeeCatalogue()
  const { create, loading } = useCreateFeeStructure()

  const [classId, setClassId] = useState('')
  const [heads, setHeads] = useState<DraftHead[]>([])
  const [headErrors, setHeadErrors] = useState<Record<string, string>>({})

  // Reset the form whenever the dialog opens.
  useEffect(() => {
    if (open) {
      setClassId('')
      setHeads([])
      setHeadErrors({})
    }
  }, [open])

  useDismissOnEscape(() => {
    if (!loading) onClose()
  }, open)

  const selectedClass = useMemo(() => classes.find((c) => c.id === classId) ?? null, [classes, classId])

  const patchHead = (key: string, patch: Partial<DraftHead>) => {
    setHeads((prev) => prev.map((h) => (h.key === key ? { ...h, ...patch } : h)))
  }
  const removeHead = (key: string) => {
    setHeads((prev) => prev.filter((h) => h.key !== key))
    setHeadErrors((prev) => {
      if (!prev[key]) return prev
      const next = { ...prev }
      delete next[key]
      return next
    })
  }
  const addHead = (head: Omit<DraftHead, 'key'>) => {
    setHeads((prev) => [...prev, { ...head, key: newRowKey() }])
  }

  const validate = (): FeeHeadInput[] | null => {
    const errors: Record<string, string> = {}
    const seen = new Set<string>()
    const out: FeeHeadInput[] = []
    for (const h of heads) {
      const name = h.name.trim()
      if (!name) {
        errors[h.key] = 'Name is required'
        continue
      }
      const lower = name.toLowerCase()
      if (seen.has(lower)) {
        errors[h.key] = 'Duplicate head name'
        continue
      }
      seen.add(lower)
      const amount = parseAmountInput(h.amount)
      if (!amount.ok) {
        errors[h.key] = amount.error
        continue
      }
      out.push({
        catalogueId: h.catalogueId,
        name,
        category: h.category || 'Other',
        amount: amount.value,
        frequency: h.frequency || 'Monthly',
        mandatory: h.mandatory,
        active: h.active,
      })
    }
    setHeadErrors(errors)
    if (Object.keys(errors).length > 0) {
      toast.error('Some fee heads need attention', { description: 'Fix the highlighted rows before saving.' })
      return null
    }
    return out
  }

  const handleCreate = async () => {
    if (!selectedClass) {
      toast.error('Please select a class')
      return
    }
    if (heads.length === 0) {
      toast.error('Add at least one fee head', { description: 'A structure needs at least one head before it can be drafted.' })
      return
    }
    if (heads.length > MAX_HEADS) {
      toast.error(`A fee structure may have at most ${MAX_HEADS} heads`)
      return
    }
    const headInputs = validate()
    if (!headInputs) return
    try {
      const created = await create({
        classId: selectedClass.id,
        className: selectedClass.name,
        classLevel: selectedClass.gradeLevel || 'Primary',
        heads: headInputs,
      })
      toast.success('Draft structure created', {
        description: `${created.className} is now a draft (v${created.version}). Publish it when ready.`,
      })
      onCreated(created.id)
    } catch (e) {
      // 409 (a current structure already exists for the class), FK 404s,
      // zod 422s — the server publicMessage surfaces verbatim.
      toast.error('Could not create structure', { description: (e as { message?: string })?.message ?? undefined })
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          role="dialog"
          aria-modal="true"
          aria-label="New fee structure"
          className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => {
            if (!loading) onClose()
          }}
        >
          <motion.div
            initial={{ scale: 0.96, opacity: 0, y: 8 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.96, opacity: 0, y: 8 }}
            transition={{ type: 'spring', stiffness: 350, damping: 30 }}
            className="bg-card border border-border rounded-xl shadow-2xl max-w-2xl w-full max-h-[92vh] overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="px-5 py-4 border-b border-border bg-gradient-to-br from-emerald-500/5 via-transparent to-transparent">
              <div className="flex items-center gap-2.5">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 ring-1 ring-emerald-500/20">
                  <Plus className="h-4 w-4" />
                </span>
                <div>
                  <h3 className="text-sm font-bold">New Fee Structure</h3>
                  <p className="text-[11px] text-muted-foreground">
                    Creates a draft on the server — publish it from the detail drawer when ready.
                  </p>
                </div>
              </div>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {/* Class picker — REAL server classes (FK-validated in-tenant) */}
              <div className="space-y-1.5">
                <Label htmlFor="create-class" className="text-xs">Class</Label>
                {classesLoading ? (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground h-8">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading classes…
                  </div>
                ) : classesError ? (
                  <div className="rounded-md border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs text-rose-700 dark:text-rose-300" role="alert">
                    {classesError}
                  </div>
                ) : classes.length === 0 ? (
                  <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-300" role="alert">
                    No classes found for this school — create classes first.
                  </div>
                ) : (
                  <Select value={classId} onValueChange={setClassId}>
                    <SelectTrigger id="create-class" className="h-9 text-xs w-full" aria-label="Select class">
                      <SelectValue placeholder="Select class" />
                    </SelectTrigger>
                    <SelectContent>
                      {classes.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}{c.section ? ` · ${c.section}` : ''}{c.stream ? ` · ${c.stream}` : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                {selectedClass && (
                  <p className="text-[10px] text-muted-foreground">
                    Level: <span className="font-medium text-foreground">{selectedClass.gradeLevel || 'Primary'}</span>
                    {' '}· The server creates the draft bound to this class.
                  </p>
                )}
              </div>

              {/* One-current-per-class hint (the 409 contract) */}
              <div className="rounded-md border border-sky-500/30 bg-sky-500/5 px-3 py-2 flex items-start gap-2">
                <Info className="h-3.5 w-3.5 text-sky-600 dark:text-sky-400 mt-0.5 shrink-0" aria-hidden />
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  A class can have only one <span className="font-semibold text-foreground">current</span> structure —
                  the server rejects the create (409) if one already exists. Archive it first, or amend the draft.
                </p>
              </div>

              {/* Heads editor (shared with the draft drawer) */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Fee heads</h4>
                  <span className="text-[10px] text-muted-foreground tabular-nums">{heads.length}/{MAX_HEADS}</span>
                </div>
                {catalogue.length === 0 && (
                  <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3" aria-hidden />
                    The master catalogue is empty — heads added here are custom (no catalogue binding).
                  </p>
                )}
                <DraftHeadsEditor
                  heads={heads}
                  errors={headErrors}
                  catalogue={catalogue}
                  onPatch={patchHead}
                  onRemove={removeHead}
                  onAdd={addHead}
                />
              </div>
            </div>

            {/* Footer */}
            <div className="border-t border-border bg-muted/30 px-5 py-3 flex items-center justify-end gap-2">
              <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={onClose} disabled={loading}>
                Cancel
              </Button>
              <Button
                size="sm"
                className="h-8 text-xs gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
                onClick={() => void handleCreate()}
                disabled={loading || !selectedClass || heads.length === 0}
              >
                {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                Create draft
              </Button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
