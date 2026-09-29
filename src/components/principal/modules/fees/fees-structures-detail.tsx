'use client'

/**
 * FeesStructuresDetailDrawer — Slide-from-right drawer for editing a
 * single Fee Structure with full versioning workflow.
 *
 * Header:
 *   - Structure name + academic level + academic year + current version
 *     + status + effective date + last updated + updated by
 *
 * Actions:
 *   - Edit (toggle edit mode) · Create New Version · View History ·
 *     Duplicate · Archive · Roll back · Delete (with safeguards)
 *
 * Fee Head Table:
 *   - Each fee head as a row with Name, Amount, Frequency,
 *     Mandatory/Optional, Active, Actions (remove)
 *   - Edit mode: inline editing with validation (name required, amount
 *     >= 0, no duplicates)
 *   - Add Head form: Name, Amount, Frequency, Mandatory, Description
 *
 * Footer:
 *   - When not editing: View History · Duplicate · Edit
 *   - When editing: Discard · Save as Draft · Schedule · Publish New Version
 *
 * On publish/schedule, opens the confirm dialog (FeesStructuresConfirmDialog)
 * with the OLD vs NEW heads diff. On confirm, calls
 * publishFeeStructureVersion / scheduleFeeStructureVersion.
 */

import { useState, useMemo, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ArrowLeft, Pencil, Plus, History, Copy, Trash2, X, Check,
  Layers, Calendar, User, Archive, FileText, AlertCircle,
  CheckCircle2, Save, Sparkles, ShieldAlert, Award, Lock,
  CalendarCheck2, Eye,
  // PHASE 7 — Re-link from catalogue row action icons.
  Link2, Link2Off, Search, } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  useFeeStore,
  type FeeStructureConfig,
  type FeeHead,
  type FeeHeadCategory,
  type FeeChangeLog,
  type ExamFeeEntry,
  type ExamFeeSchedule,
  computeHeadsTotal,
  computeExamFeeTotal,
  CURRENT_ACADEMIC_YEAR,
} from '@/lib/store/fee-store'
import { useSchoolSettingsStore } from '@/lib/store/school-settings-store'
import { useStudentsStore } from '@/lib/store/students-store'
import { formatINR, formatDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import {
  structureEditWindowLive,
  STRUCTURE_APPROVAL_THRESHOLD,
  type StructureRevision,
} from '@/lib/store/fee-store'
import { FeesStructuresConfirmDialog } from './fees-structures-confirm'
import { FeesStructuresHistoryDialog } from './fees-structures-history'
import { VersionStatusPill } from './fees-structures-shared'
// SaaS-STAGE-1 — the active academic session is DERIVED (read-only) and
// effective permissions come from the school configuration (never
// hard-coded role checks in the UI).
// SaaS-STAGE-2A (Task 7-b) — permissions now resolve from the ACTIVE
// TENANT's config via useEffectiveFeeCapabilities (per-school capability
// gating); getEffectivePermissions('principal') without a config is gone.
import { useAcademicSession } from '@/lib/academic-session'
import { useEffectiveFeeCapabilities } from '@/lib/tenant/store'
// Canonical monetary input — permanently fixes the leading-zero bug
// (select-all-and-type, paste, clearing, leading "04…") on every amount
// field in this editor.
import { MoneyInput } from './money-input'
// EXAM INTEGRATION — the exam types offered in the Examination Fee
// Schedule come from the Examination module (source of truth). This
// drawer never invents its own exam definitions.
import { useExamTypeDefinitions } from './fees-exam-types'
// PHASE 6 — catalogue-aware Add-Head form. The picker lists every
// non-archived master catalogue entry and prefills name/amount/frequency/
// category/GST fields on pick. Lets the principal opt out and type a
// custom name (with a visible "Custom head (not in catalogue)" indicator).
import { FeeHeadCataloguePicker } from './fee-head-catalogue-picker'
import {
  CategoryBadge,
  FrequencyBadge,
  GstBadge,
  CatalogueBoundPill,
  CustomHeadPill,
  // PHASE 7 — shared catalogue helpers used by the new Re-link popover.
  CATEGORY_ICONS,
  CATEGORY_CHIPS,
  CATEGORY_ORDER,
  AmountBadge,
} from './fees-catalogue-shared'
import { toast } from 'sonner'
import { useDismissOnEscape } from '@/hooks/use-dismiss-on-escape'

type Frequency = FeeHead['frequency']
const FREQUENCIES: Frequency[] = ['Annual', 'Half-Yearly', 'Quarterly', 'Monthly', 'Per Term', 'One-Time']

/** Compact mm:ss / h m countdown for the temporary editing window badge. */
function formatCountdownShort(ms: number): string {
  if (ms <= 0) return '0m'
  const totalMin = Math.floor(ms / 60000)
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  if (h <= 0) return `${m}m`
  return `${h}h ${m}m`
}

export interface DetailDrawerProps {
  open: boolean
  /** The structure to view/edit. Optional in `mode='create'` — a blank
   *  template is built internally so the same drawer component serves as
   *  the creation form. */
  structure?: FeeStructureConfig | null
  mode?: 'view' | 'create'
  onClose: () => void
  onStructureDeleted?: (structureId: string) => void
  /** Called after `createFeeStructure` succeeds in create mode. The
   *  parent typically closes create-mode and re-opens the drawer in view
   *  mode with the newly-returned id. */
  onCreated?: (id: string) => void
  /** Cross-module navigation ("Go to Examinations" from the exam fee
   *  empty state). Passed down from the Principal panel. */
  onNavigate?: (moduleKey: string) => void
}

export function FeesStructuresDetailDrawer({ open, structure, mode = 'view', onClose, onStructureDeleted, onCreated, onNavigate }: DetailDrawerProps) {
  const isCreateMode = mode === 'create'
  // For create mode, build a blank template so the same DetailDrawerInner
  // (which expects a non-null `structure`) can render the form. The
  // template carries no heads / exam fees — the user adds them inline.
  const blankStructure: FeeStructureConfig = isCreateMode
    ? {
        id: '__create__',
        category: '',
        className: '',
        classLevel: '',
        annual: 0,
        components: [],
        effectiveFrom: new Date().toISOString().split('T')[0],
        version: 0,
      }
    : structure!
  if (!isCreateMode && !structure) return null
  return (
    <DetailDrawerInner
      open={open}
      structure={blankStructure}
      mode={mode}
      onClose={onClose}
      onStructureDeleted={onStructureDeleted}
      onCreated={onCreated}
      onNavigate={onNavigate}
      isCreateMode={isCreateMode}
    />
  )
}

function DetailDrawerInner({
  open,
  structure,
  onClose,
  onCreated,
  onNavigate,
  isCreateMode,
}: DetailDrawerProps & { structure: FeeStructureConfig; isCreateMode: boolean }) {
  const versions = useFeeStore((s) => s.versions)
  const changeLog = useFeeStore((s) => s.changeLog)
  const publishFeeStructureVersion = useFeeStore((s) => s.publishFeeStructureVersion)
  const scheduleFeeStructureVersion = useFeeStore((s) => s.scheduleFeeStructureVersion)
  const archiveFeeStructureVersion = useFeeStore((s) => s.archiveFeeStructureVersion)
  const revertFeeStructureVersion = useFeeStore((s) => s.revertFeeStructureVersion)
  const createFeeStructure = useFeeStore((s) => s.createFeeStructure)
  // STRUCT-REV — controlled mid-session revision workflow.
  const structureEditWindow = useFeeStore((s) => s.structureEditWindow)
  const structureRevisions = useFeeStore((s) => s.structureRevisions)
  const requestStructureEditWindow = useFeeStore((s) => s.requestStructureEditWindow)
  const closeStructureEditWindow = useFeeStore((s) => s.closeStructureEditWindow)
  const createStructureRevision = useFeeStore((s) => s.createStructureRevision)
  const publishStructureRevision = useFeeStore((s) => s.publishStructureRevision)
  const cancelStructureRevision = useFeeStore((s) => s.cancelStructureRevision)
  // EXAM INTEGRATION — the exam types available to the Examination Fee
  // Schedule, fetched from the Examination module (source of truth).
  const { types: examTypeDefs, loading: examTypesLoading } = useExamTypeDefinitions()
  // SaaS-STAGE-1 — session is DERIVED (read-only) and permissions come
  // from the school configuration. Publish-disabled schools can still
  // edit + save drafts; publish/archive actions are gated below.
  // SaaS-STAGE-2A (Task 7-b) — resolved per ACTIVE tenant; when
  // fee_structure_edit is off the whole editor is READ-ONLY, and
  // fee_structure_delete is ALWAYS false for principals (platform-reserved:
  // the permanent-delete UI has been removed entirely).
  const session = useAcademicSession()
  const perms = useEffectiveFeeCapabilities()
  const canEdit = perms.fee_structure_edit
  // PHASE 7 — Re-link from catalogue row action. Wires the existing
  // `linkHeadToCatalogue` store action (added in Phase 6 for the
  // Normalize drawer) to a compact per-row popover trigger in the
  // FeeHeadRow edit mode. Lets the principal surface the single-head
  // link action without leaving the structure detail drawer (worklog
  // Phase 5 next-round priority (f)).
  const linkHeadToCatalogue = useFeeStore((s) => s.linkHeadToCatalogue)

  // Edit-mode state
  const [editing, setEditing] = useState(false)
  const [workingHeads, setWorkingHeads] = useState<FeeHead[]>([])
  // STRUCT-REV — while NOT editing, the working copy always mirrors the
  // LIVE structure (e.g. right after a revision publishes, the table must
  // show the new amounts — never a stale pre-publish snapshot).
  useEffect(() => {
    if (!editing) setWorkingHeads(structure.components.map((h) => ({ ...h })))
  }, [structure.id, structure.components, structure.version, editing])
  const [showAddHead, setShowAddHead] = useState(false)
  // FEE-EXAM: parallel working state for the examination fee schedule.
  // Backed by `structure.examFeeSchedule` on open; committed to the live
  // structure (and the new version snapshot) via publishFeeStructureVersion
  // / scheduleFeeStructureVersion when the Principal publishes.
  const [workingExamSchedule, setWorkingExamSchedule] = useState<ExamFeeSchedule>([])
  const [showAddExamFee, setShowAddExamFee] = useState(false)

  // Dialogs
  const [confirmMode, setConfirmMode] = useState<'publish' | 'schedule' | 'revision' | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)

  // Escape closes the drawer (backdrop click already does), but never
  // while a nested overlay is open — the add-head / add-exam-fee forms and
  // the confirm / history dialogs stay in charge of their own dismissal.
  useDismissOnEscape(() => {
    if (showAddHead || showAddExamFee || confirmMode !== null || historyOpen) return
    onClose()
  })

  // FEE-PER-CLASS — create-mode form state. Only used when
  // `isCreateMode=true`. The drawer opens with a blank template; the
  // user picks a class from the school's configured classes
  // (ACADEMIC_CLASSES via useStudentsStore.classes), optionally
  // specifies an academic year + effective date, and adds fee heads /
  // exam fees before clicking Save Draft (or Publish New Version). No
  // record is written until Save Draft is clicked — Cancel with
  // unsaved entries shows a "Discard unsaved changes?" confirmation.
  //
  // The structure's `className` and `classLevel` are derived from the
  // selected class (`schoolClasses.find(c => c.id === createClassId)`)
  // — there is NO separate "Structure Name" field. The drawer title
  // shows the class's `name` (e.g. "Class 10") and the subtitle shows
  // the class's `level` + AY (e.g. "Secondary · AY 2025-2026").
  //
  // Defaults are intentionally EMPTY for `createClassId` (the create-mode
  // header shows a placeholder option "Select class"). SaaS-STAGE-1: the
  // academic session is NOT an input at all — it is derived read-only from
  // the active session (lib/academic-session.ts) and stamped on save.
  // Effective date still defaults to today.
  const [createClassId, setCreateClassId] = useState<string>('')
  const [createEffectiveDate, setCreateEffectiveDate] = useState<string>(new Date().toISOString().split('T')[0])
  const [createNotes, setCreateNotes] = useState('')
  const [createSubmitting, setCreateSubmitting] = useState(false)

  // FEE-PER-CLASS — the school's configured classes (ACADEMIC_CLASSES
  // from `src/lib/mock/academic/classes.ts`, surfaced via the students
  // store). Used to populate the create-mode Class select. Each entry
  // has: id, name (e.g. "Class 11"), grade, level (e.g. "Senior
  // Secondary"), and an optional stream (only for Class 11/12 Science
  // classes — surfaced as a "Science-PCM" / "Science-PCB" suffix in
  // the option label).
  const schoolClasses = useStudentsStore((s) => s.classes)
  const selectedClass = useMemo(
    () => schoolClasses.find((c) => c.id === createClassId) ?? null,
    [schoolClasses, createClassId],
  )

  // When the structure changes (or edit mode is entered), refresh working heads
  useEffect(() => {
    if (open) {
      setWorkingHeads(structure.components.map((h) => ({ ...h })))
      // FEE-EXAM: snapshot the current exam fee schedule into the working
      // state so the editor starts from the live values.
      setWorkingExamSchedule((structure.examFeeSchedule ?? []).map((e) => ({ ...e })))
      // FEE-CREATE-DRAWER — in create mode the drawer IS the editor from
      // the start (there is no separate "Edit" toggle), so `editing` is
      // forced on. In view mode, `editing` starts false and the user
      // clicks Edit to enter edit mode (existing behaviour, unchanged).
      setEditing(isCreateMode)
      setShowAddHead(false)
      setShowAddExamFee(false)
      setConfirmMode(null)
      setHistoryOpen(false)
      // FEE-PER-CLASS — reset the create-mode form whenever the drawer
      // opens (or re-opens) in create mode. Defaults: empty class id
      // (the inline select shows its placeholder "Select class"), empty
      // academic year, effective date = today, no notes.
      if (isCreateMode) {
        setCreateClassId('')
        setCreateEffectiveDate(new Date().toISOString().split('T')[0])
        setCreateNotes('')
        setCreateSubmitting(false)
      }
    }
  }, [open, structure.id, isCreateMode])

  // SaaS-STAGE-2A (Task 7-b) — the permanent-delete action is REMOVED from
  // the principal UI (fee_structure_delete is ALWAYS false for school
  // roles; the store denies it at action time too). handleDelete /
  // confirmDelete / the delete confirmation dialog are gone; the quick
  // action bar carries a disabled "Permanent delete · Platform reserved"
  // row instead. `onStructureDeleted` stays in the props contract for the
  // platform-actor path but is no longer invoked from this UI.

  // Versions for this structure (newest first)
  const structureVersions = useMemo(() => {
    return versions
      .filter((v) => v.structureId === structure.id)
      .sort((a, b) => b.version - a.version)
  }, [versions, structure.id])

  const currentVersion = structureVersions.find((v) => v.status === 'current')
  const scheduledVersions = structureVersions.filter((v) => v.status === 'scheduled')
  const draftVersions = structureVersions.filter((v) => v.status === 'draft')
  const _archivedVersions = structureVersions.filter((v) => v.status === 'archived')

  // ─── STRUCT-REV — locked-state derivation (PART 7/8/9) ─────────────
  // A published CURRENT-session structure is locked: edits require a
  // temporary editing window and publishing becomes a 60%-approval
  // revision. Drafts and other-session structures use the normal flow.
  const liveEditWindow = structureEditWindowLive(structureEditWindow, structure.id)
  const isLockedCurrent = !isCreateMode
    && !!currentVersion
    && (structure.academicYear ?? CURRENT_ACADEMIC_YEAR) === CURRENT_ACADEMIC_YEAR
  const structureRevision = useMemo(() => {
    return structureRevisions.find(
      (r) => r.structureId === structure.id && (r.status === 'Pending Approval' || r.status === 'Threshold Reached'),
    )
  }, [structureRevisions, structure.id])

  const structureChangeLog = useMemo(() => {
    return changeLog.filter((l) => l.structureId === structure.id)
  }, [changeLog, structure.id])

  // Affected students — FEE-PER-CLASS: tries an EXACT className match
  // first (so a Class 9 structure reports only Class 9 students, not
  // all Secondary students). Falls back to classLevel substring
  // matching when no student has an exact className match (e.g. a
  // custom structure with a non-class className).
  const affectedStudents = useMemo(() => {
    const students = useStudentsStore.getState().students.filter((s) => s.status === 'Active')
    if (structure.className) {
      const exact = students.filter((s) => s.className === structure.className)
      if (exact.length > 0) return exact.length
    }
    return students.filter((s) => {
      const level =
        s.className.includes('11') || s.className.includes('12') ? 'Senior Secondary' :
        s.className.includes('9') || s.className.includes('10') ? 'Secondary' :
        s.className.match(/Class [6-8]/) ? 'Middle' :
        s.className.match(/Class [1-5]/) ? 'Primary' : 'Pre-Primary'
      return level === structure.classLevel
    }).length
  }, [structure.className, structure.classLevel])

  // Diff for the confirm dialog
  const oldHeads = structure.components
  const newHeads = workingHeads
  const workingTotal = computeHeadsTotal(workingHeads)
  // FEE-EXAM: per-exam fees total (active entries only) — shown in the
  // Exam Fee Schedule section footer + alongside the recurring total in
  // the edit-mode callout. NOT added to `workingTotal` (which is the
  // recurring-only total that publishes into the cached `annual` field);
  // the student's `totalApplicable` adds it separately in `computeAccount`.
  const workingExamFeeTotal = computeExamFeeTotal(workingExamSchedule)

  // ─── Actions ───────────────────────────────────────────────────

  const handleStartEdit = () => {
    // SaaS-STAGE-2A (Task 7-b) — read-only when the school's configuration
    // disables fee_structure_edit (the store rejects the write anyway).
    if (!perms.fee_structure_edit) return
    setWorkingHeads(structure.components.map((h) => ({ ...h })))
    setWorkingExamSchedule((structure.examFeeSchedule ?? []).map((e) => ({ ...e })))
    setEditing(true)
  }

  const handleDiscard = () => {
    setWorkingHeads(structure.components.map((h) => ({ ...h })))
    setWorkingExamSchedule((structure.examFeeSchedule ?? []).map((e) => ({ ...e })))
    setEditing(false)
    setShowAddHead(false)
    setShowAddExamFee(false)
  }

  const handlePublish = () => setConfirmMode(isLockedCurrent ? 'revision' : 'publish')
  const handleSchedule = () => setConfirmMode('schedule')

  // STRUCT-REV (PART 10) — open the temporary editing window with a clear
  // explanation of WHY the structure is locked.
  const handleRequestEdit = () => {
    // SaaS-STAGE-2A (Task 7-b) — the temporary editing window is an EDIT
    // capability: never open it when fee_structure_edit is disabled.
    if (!perms.fee_structure_edit) {
      toast.error('Read-only', {
        description: 'Fee structure editing is disabled for your school by the platform configuration.',
      })
      return
    }
    const res = requestStructureEditWindow(structure.id, 'Principal')
    if (!res.success) {
      toast.error('Cannot open editing window', { description: res.error })
      return
    }
    toast.success('Temporary editing window open', {
      description: 'You can now edit this structure for 3 hours. Saving creates a PROPOSED version that needs 60% guardian acknowledgement — it never overwrites the published one.',
    })
  }

  const handleConfirmPublish = (reason: string, effectiveFrom: string) => {
    if (!currentVersion) return
    // FEE-EXAM: pass the working exam fee schedule as the 6th parameter
    // so the new version snapshots it (alongside the regular heads) and
    // the live FeeStructureConfig is updated in lockstep.
    const newVersionId = publishFeeStructureVersion(structure.id, workingHeads, effectiveFrom, reason, 'Principal', workingExamSchedule)
    if (newVersionId) {
      toast.success('New version published', {
        description: `${structure.className} v${(currentVersion?.version ?? 0) + 1} is now current. Parents notified via Push + SMS + Email.`,
      })
      setEditing(false)
      setConfirmMode(null)
    } else {
      toast.error('Failed to publish new version')
      setConfirmMode(null)
    }
  }

  const handleConfirmSchedule = (reason: string, effectiveFrom: string) => {
    const newVersionId = scheduleFeeStructureVersion(structure.id, workingHeads, effectiveFrom, reason, 'Principal', workingExamSchedule)
    if (newVersionId) {
      toast.success('New version scheduled', {
        description: `${structure.className} v${(currentVersion?.version ?? 0) + 1} scheduled for ${effectiveFrom}. Parents notified.`,
      })
      setEditing(false)
      setConfirmMode(null)
    } else {
      toast.error('Failed to schedule new version')
      setConfirmMode(null)
    }
  }

  // STRUCT-REV (PART 9/11/12) — the mid-session path: the working heads
  // become a PROPOSED version pending 60% guardian acknowledgement. The
  // published version keeps applying; nothing is overwritten.
  const handleConfirmRevision = (reason: string, effectiveFrom: string) => {
    const res = createStructureRevision({
      structureId: structure.id,
      proposedHeads: workingHeads,
      effectiveFrom,
      reason,
      actor: 'Principal',
    })
    if (!res.success) {
      toast.error('Could not submit revision', { description: res.error })
      setConfirmMode(null)
      return
    }
    const rev = res.revision!
    toast.success(`Revision v${rev.toVersion} submitted for acknowledgement`, {
      description: `${rev.affectedStudentIds.length} students/guardians notified. The published v${rev.fromVersion} continues to apply until 60% approve.`,
    })
    // Reset the working copy — the table must keep showing the PUBLISHED
    // heads; the proposal lives in the RevisionPanel above it.
    setWorkingHeads(structure.components.map((h) => ({ ...h })))
    setWorkingExamSchedule((structure.examFeeSchedule ?? []).map((e) => ({ ...e })))
    setEditing(false)
    setShowAddHead(false)
    setShowAddExamFee(false)
    setConfirmMode(null)
  }

  const handleDuplicate = () => {
    // Permission guard mirrors the store: createFeeStructure is store-denied
    // without fee_structure_edit — the button is hidden in that state, so a
    // call reaching here is a direct invocation. Honest denial, never a
    // silent no-op.
    if (!perms.fee_structure_edit) {
      toast.error('Duplicate unavailable', {
        description: 'Fee structure editing is disabled for your school by the platform configuration.',
      })
      return
    }
    const newId = createFeeStructure({
      category: `${structure.category} (Copy)`,
      className: `${structure.className} — Draft Copy`,
      classLevel: structure.classLevel,
      heads: structure.components.map((h) => ({ ...h, id: `FH-${Date.now().toString(36)}-${h.id}` })),
      effectiveFrom: new Date().toISOString().split('T')[0],
      notes: `Duplicated from ${structure.id} v${structure.version}`,
      actor: 'Principal',
      // FEE-EXAM: copy the exam fee schedule onto the duplicated draft so
      // the new structure starts with the same per-exam fees.
      examFeeSchedule: (structure.examFeeSchedule ?? []).map((e) => ({
        ...e,
        id: `EF-${Date.now().toString(36)}-${e.id}`,
      })),
    })
    if (newId) {
      toast.success('Structure duplicated as draft', { description: `New structure created with id ${newId}.` })
      onClose()
    }
  }

  const handleArchiveCurrent = () => {
    if (!currentVersion) return
    // Safety: archiving current requires a confirmation
    if (!confirm(`Archive the CURRENT version (v${currentVersion.version}) of ${structure.className}?\n\nThis will leave the structure with NO current version — only do this if you have published a replacement.`)) return
    archiveFeeStructureVersion(currentVersion.id, 'Principal')
    toast.info('Version archived', { description: `v${currentVersion.version} of ${structure.className} archived.` })
  }

  const handleRevert = (targetVersionId: string) => {
    const target = structureVersions.find((v) => v.id === targetVersionId)
    if (!target) return
    const reason = prompt(`Roll back ${structure.className} to Version ${target.version}?\n\nThis will create a NEW version with the heads from v${target.version}. The current version will be archived.\n\nReason (required):`)
    if (!reason || reason.trim().length < 5) {
      toast.error('Reason is required (min 5 chars)')
      return
    }
    const newId = revertFeeStructureVersion(structure.id, targetVersionId, reason.trim(), 'Principal')
    if (newId) {
      toast.success('Rolled back successfully', {
        description: `${structure.className} rolled back to v${target.version}. New version v${(currentVersion?.version ?? 0) + 1} is now current.`,
      })
      setHistoryOpen(false)
    }
  }

  const handleArchiveVersion = (versionId: string) => {
    archiveFeeStructureVersion(versionId, 'Principal')
    toast.info('Version archived', { description: `Version archived from ${structure.className}.` })
    setHistoryOpen(false)
  }

  // ─── FEE-PER-CLASS — create-mode handlers ───────────────────────────
  //
  // Create mode is a one-way street: the drawer opens with a blank
  // template, the user picks a class from the school's configured
  // classes + (optionally) adds fee heads and exam fees, then clicks
  // Save Draft (creates a v1 draft, transitions to view mode) or
  // Publish New Version (creates a v1 draft + publishes v2 as current,
  // then transitions to view mode). Cancel confirms before discarding
  // any unsaved entries. There is NO "Structure Name" field — the
  // structure's `className` and `classLevel` are derived from the
  // selected class (`selectedClass`).

  const createValid = useMemo(() => {
    if (!isCreateMode) return true
    return (
      !!selectedClass &&
      createClassId.trim().length > 0 &&
      !!createEffectiveDate
    )
  }, [isCreateMode, selectedClass, createClassId, createEffectiveDate])

  // True if the user has entered anything since opening the create-mode
  // drawer — used by Cancel to decide whether to prompt for discard.
  // FEE-PER-CLASS — comparison is against the EMPTY defaults (the class
  // select / academic year inputs start blank), so any non-empty value
  // counts as an edit.
  const createHasEdits = useMemo(() => {
    if (!isCreateMode) return false
    return (
      createClassId.trim().length > 0 ||
      createEffectiveDate !== new Date().toISOString().split('T')[0] ||
      createNotes.trim().length > 0 ||
      workingHeads.length > 0 ||
      workingExamSchedule.length > 0
    )
  }, [isCreateMode, createClassId, createEffectiveDate, createNotes, workingHeads, workingExamSchedule])

  // FEE-PER-CLASS — notes are folded into the `notes` prop. SaaS-STAGE-1:
  // the Academic Year is NO LONGER typed by the user — it is derived from
  // the active session and passed as `academicYear` to createFeeStructure
  // (stamped on the structure + every version snapshot).
  const buildCreateNotes = () => {
    const parts: string[] = []
    if (createNotes.trim()) parts.push(createNotes.trim())
    return parts.length > 0 ? parts.join(' · ') : undefined
  }

  const handleCancelCreate = () => {
    if (createHasEdits) {
      if (!window.confirm('Discard unsaved changes? Your entries will be lost.')) return
    }
    onClose()
  }

  const handleSaveDraft = () => {
    if (!selectedClass) { toast.error('Please select a class'); return }
    if (!createEffectiveDate) { toast.error('Effective date is required'); return }
    setCreateSubmitting(true)
    setTimeout(() => {
      const newId = createFeeStructure({
        category: selectedClass.level,
        className: selectedClass.name,
        classLevel: selectedClass.level,
        heads: workingHeads,
        effectiveFrom: createEffectiveDate,
        notes: buildCreateNotes(),
        actor: 'Principal',
        examFeeSchedule: workingExamSchedule.length > 0 ? workingExamSchedule : undefined,
        academicYear: session.id,
      })
      setCreateSubmitting(false)
      if (newId) {
        toast.success('Draft structure created', {
          description: `${selectedClass.name} is now a draft. Add fee heads and publish when ready.`,
        })
        onCreated?.(newId)
      } else {
        toast.error('Could not create structure', { description: 'The store returned no id — please try again.' })
      }
    }, 200)
  }

  const handlePublishNew = () => {
    if (!selectedClass) { toast.error('Please select a class'); return }
    if (!createEffectiveDate) { toast.error('Effective date is required'); return }
    setCreateSubmitting(true)
    setTimeout(() => {
      // Step 1 — create the structure (writes a v1 draft).
      const newId = createFeeStructure({
        category: selectedClass.level,
        className: selectedClass.name,
        classLevel: selectedClass.level,
        heads: workingHeads,
        effectiveFrom: createEffectiveDate,
        notes: buildCreateNotes(),
        actor: 'Principal',
        examFeeSchedule: workingExamSchedule.length > 0 ? workingExamSchedule : undefined,
        academicYear: session.id,
      })
      if (!newId) {
        setCreateSubmitting(false)
        toast.error('Could not create structure')
        return
      }
      // Step 2 — publish a new current version (creates v2 with
      // status=current; the v1 draft stays as a draft snapshot of
      // the same heads + exam fees). The parent then transitions to
      // view mode via onCreated(newId).
      const reason = `Initial publish — ${selectedClass.name}`
      const publishId = publishFeeStructureVersion(
        newId,
        workingHeads,
        createEffectiveDate,
        reason,
        'Principal',
        workingExamSchedule.length > 0 ? workingExamSchedule : undefined,
      )
      setCreateSubmitting(false)
      if (publishId) {
        toast.success('Fee structure published', {
          description: `${selectedClass.name} is now current. Parents notified via Push + SMS + Email.`,
        })
      } else {
        toast.error('Draft created but publish failed', { description: 'Open the structure to publish manually.' })
      }
      onCreated?.(newId)
    }, 200)
  }

  // ─── Inline editing helpers ────────────────────────────────────

  const updateWorkingHead = (id: string, patch: Partial<FeeHead>) => {
    setWorkingHeads((prev) => prev.map((h) => h.id === id ? { ...h, ...patch } : h))
  }

  const removeWorkingHead = (id: string) => {
    setWorkingHeads((prev) => prev.filter((h) => h.id !== id))
  }

  const addWorkingHead = (head: Omit<FeeHead, 'id'>) => {
    const newHead: FeeHead = { ...head, id: `FH-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}` }
    setWorkingHeads((prev) => [...prev, newHead])
    setShowAddHead(false)
  }

  // ─── FEE-EXAM: inline exam fee schedule editing helpers ───────────
  const updateWorkingExamFee = (id: string, patch: Partial<ExamFeeEntry>) => {
    setWorkingExamSchedule((prev) => prev.map((e) => e.id === id ? { ...e, ...patch } : e))
  }

  const removeWorkingExamFee = (id: string) => {
    setWorkingExamSchedule((prev) => prev.filter((e) => e.id !== id))
  }

  const addWorkingExamFee = (entry: Omit<ExamFeeEntry, 'id'>) => {
    const newEntry: ExamFeeEntry = { ...entry, id: `EF-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}` }
    setWorkingExamSchedule((prev) => [...prev, newEntry])
    setShowAddExamFee(false)
  }

  // ─── Validation ────────────────────────────────────────────────

  const validationIssues = useMemo(() => {
    const issues: string[] = []
    const names = workingHeads.map((h) => h.name.trim().toLowerCase())
    const seen = new Set<string>()
    for (const n of names) {
      if (!n) {
        issues.push('All fee heads must have a name')
        break
      }
      if (seen.has(n)) {
        issues.push(`Duplicate fee head name: "${n}"`)
        break
      }
      seen.add(n)
    }
    for (const h of workingHeads) {
      if (h.amount < 0) {
        issues.push(`Amount for "${h.name}" must be ≥ 0`)
        break
      }
    }
    // FEE-EXAM: validate the exam fee schedule too — exam type required,
    // amount ≥ 0, no duplicate exam types within the same structure.
    const examTypes = workingExamSchedule.map((e) => e.examType.trim().toLowerCase())
    const examSeen = new Set<string>()
    for (const t of examTypes) {
      if (!t) {
        issues.push('All exam fee entries must have an exam type')
        break
      }
      if (examSeen.has(t)) {
        issues.push(`Duplicate exam fee type: "${t}"`)
        break
      }
      examSeen.add(t)
    }
    for (const e of workingExamSchedule) {
      if (typeof e.amount !== 'number' || e.amount < 0) {
        issues.push(`Exam fee amount for "${e.examType}" must be ≥ 0`)
        break
      }
    }
    return issues
  }, [workingHeads, workingExamSchedule])

  const hasEdits = useMemo(() => {
    if (workingHeads.length !== structure.components.length) return true
    for (let i = 0; i < workingHeads.length; i++) {
      const a = workingHeads[i]
      const b = structure.components.find((h) => h.id === a.id)
      if (!b) return true
      if (a.name !== b.name || a.amount !== b.amount || a.mandatory !== b.mandatory || a.active !== b.active || a.frequency !== b.frequency) return true
    }
    // FEE-EXAM: also compare the exam fee schedule to the live snapshot.
    const liveExam = structure.examFeeSchedule ?? []
    if (workingExamSchedule.length !== liveExam.length) return true
    for (let i = 0; i < workingExamSchedule.length; i++) {
      const a = workingExamSchedule[i]
      const b = liveExam.find((e) => e.id === a.id)
      if (!b) return true
      if (a.examType !== b.examType || a.amount !== b.amount || a.mandatory !== b.mandatory || a.active !== b.active) return true
    }
    return false
  }, [workingHeads, structure.components, workingExamSchedule, structure.examFeeSchedule])

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        role="dialog"
        aria-modal="true"
        aria-label={isCreateMode ? 'Create fee structure' : `Fee structure — ${structure.className}`}
        className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-stretch justify-end"
        onClick={onClose}
      >
        <motion.div
          initial={{ x: '100%' }}
          animate={{ x: 0 }}
          exit={{ x: '100%' }}
          transition={{ type: 'spring', stiffness: 350, damping: 35 }}
          className="bg-card border-l border-border w-full max-w-3xl overflow-hidden flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          {isCreateMode ? (
            // FEE-PER-CLASS — compact create-mode header. The structure's
            // identity is derived from the selected class (no separate
            // "Structure Name" field). Title shows the class name (e.g.
            // "Class 10"); subtitle shows the level + AY (e.g.
            // "Secondary · AY 2025-2026"). The Class select pulls options
            // from the school's configured classes (ACADEMIC_CLASSES via
            // useStudentsStore.classes). Notes are NOT surfaced in the
            // create-mode UI per spec — they can be added later in edit
            // mode. Same visual density as the existing view header.
            <div className="border-b border-border bg-gradient-to-br from-emerald-500/5 to-transparent px-5 py-3.5">
              <div className="flex items-center justify-between gap-2 mb-2">
                <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1" onClick={handleCancelCreate}>
                  <ArrowLeft className="h-3.5 w-3.5" /> Back to Structures
                </Button>
                <Badge variant="outline" className="text-[10px] h-5 gap-1 bg-slate-500/10 text-slate-700 dark:text-slate-300 border-slate-500/20 shrink-0">
                  <Sparkles className="h-2.5 w-2.5" /> Draft
                </Badge>
              </div>
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3 min-w-0 flex-1">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 ring-1 ring-emerald-500/20">
                    <Plus className="h-5 w-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    {/* Title — class name when a class is selected,
                        "Create New Fee Structure" placeholder otherwise. */}
                    <h2 className="text-base font-bold truncate">
                      {selectedClass ? selectedClass.name : 'Create New Fee Structure'}
                    </h2>
                    {/* Subtitle — level + AY when a class is selected.
                        SaaS-STAGE-1: the session is DERIVED, never typed. */}
                    <p className="text-[11px] text-muted-foreground">
                      {selectedClass
                        ? `${selectedClass.level} · ${session.label}`
                        : 'Select a class to begin'}
                    </p>
                    {/* Compact inline metadata — Class select + READ-ONLY
                        session badge + Effective Date. The session comes
                        from the school's active academic session (the
                        Principal selects the CLASS; the SYSTEM supplies
                        the session). Wraps on narrow viewports. */}
                    <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
                      <select
                        value={createClassId}
                        onChange={(e) => setCreateClassId(e.target.value)}
                        className="h-7 text-xs rounded-md border border-border bg-background px-2 w-44 shrink-0"
                        autoFocus
                      >
                        <option value="">Select class</option>
                        {schoolClasses.map((c) => {
                          const label = c.stream
                            ? `${c.name} (Science-${c.stream})`
                            : c.name
                          return <option key={c.id} value={c.id}>{label}</option>
                        })}
                      </select>
                      <Badge
                        variant="outline"
                        className="h-7 text-[10px] gap-1 bg-muted/40 shrink-0"
                        title="Active academic session — read-only, supplied by the school configuration"
                      >
                        <CalendarCheck2 className="h-2.5 w-2.5" /> {session.label}
                      </Badge>
                      <Input
                        type="date"
                        value={createEffectiveDate}
                        onChange={(e) => setCreateEffectiveDate(e.target.value)}
                        className="h-7 text-xs w-36"
                      />
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-1 tabular-nums">
                      {workingHeads.length} heads · {workingExamSchedule.length} exam fees
                    </p>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-[9px] uppercase text-muted-foreground font-semibold tracking-wider">Working Total</p>
                  <p className="text-xl font-bold tabular-nums text-emerald-700 dark:text-emerald-300">{formatINR(workingTotal + workingExamFeeTotal, true)}</p>
                  <p className="text-[9px] text-muted-foreground">not yet saved</p>
                </div>
              </div>
            </div>
          ) : (
            <div className="border-b border-border bg-gradient-to-br from-emerald-500/5 to-transparent px-5 py-3.5">
              <div className="flex items-center justify-between gap-2 mb-2">
                <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1" onClick={onClose}>
                  <ArrowLeft className="h-3.5 w-3.5" /> Back to Structures
                </Button>
                <div className="flex items-center gap-1.5">
                  {currentVersion && <VersionStatusPill status={currentVersion.status} />}
                  <span className="text-[10px] text-muted-foreground font-mono">v{structure.version}</span>
                </div>
              </div>
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3 min-w-0">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 ring-1 ring-emerald-500/20">
                    <Layers className="h-5 w-5" />
                  </span>
                  <div className="min-w-0">
                    <h2 className="text-base font-bold truncate">{structure.className}</h2>
                    {/* SaaS-STAGE-1 — dedupe + snapshot: category and level are
                        the same value post FEE-PER-CLASS ("Pre-Primary ·
                        Pre-Primary · AY …" bug), and published structures keep
                        the session snapshot they were published under. */}
                    <p className="text-[11px] text-muted-foreground">
                      {[structure.classLevel, structure.category !== structure.classLevel ? structure.category : null]
                        .filter(Boolean)
                        .join(' · ')}
                      {' · '}{(structure.academicYear ?? CURRENT_ACADEMIC_YEAR).replace('-', '–')}
                    </p>
                    <p className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-2 flex-wrap">
                      <span className="inline-flex items-center gap-1"><Calendar className="h-2.5 w-2.5" /> Effective {formatDate(structure.effectiveFrom)}</span>
                      <span className="inline-flex items-center gap-1"><User className="h-2.5 w-2.5" /> {currentVersion?.createdBy ?? 'System'}</span>
                      <span className="tabular-nums">{structure.components.filter((c) => c.active).length} active heads</span>
                    </p>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-[9px] uppercase text-muted-foreground font-semibold tracking-wider">Annual Total</p>
                  <p className="text-xl font-bold tabular-nums text-emerald-700 dark:text-emerald-300">{formatINR(structure.annual, true)}</p>
                  <p className="text-[9px] text-muted-foreground">{affectedStudents} students impacted</p>
                </div>
              </div>
            </div>
          )}

          {/* Quick action bar — hidden in create mode (Edit / History /
              Duplicate / Archive / Delete all assume an existing
              structure; in create mode the bottom action bar carries the
              Cancel / Save Draft / Publish New Version controls). */}
          {!isCreateMode && (
            <div className="border-b border-border bg-muted/20 px-3 py-1.5 flex items-center gap-0.5 overflow-x-auto">
              {!editing ? (
                <>
                  {canEdit ? (
                    // Permission AVAILABLE — the legitimate controlled-edit
                    // actions render normally. Published current-session
                    // structures stay locked (PART 8/10): a temporary
                    // editing window is requested instead of unrestricted
                    // Edit.
                    <>
                      {isLockedCurrent && !liveEditWindow.live ? (
                        <Button
                          size="sm" variant="ghost"
                          className="h-7 text-xs gap-1 text-amber-600 hover:bg-amber-500/10"
                          onClick={handleRequestEdit}
                          title="Current fee structure is locked because it is already active for students"
                        >
                          <ShieldAlert className="h-3 w-3" /> Request Edit
                        </Button>
                      ) : (
                        <Button
                          size="sm" variant="ghost" className="h-7 text-xs gap-1"
                          onClick={handleStartEdit}
                          title="Edit heads and amounts"
                        >
                          <Pencil className="h-3 w-3" /> Edit
                        </Button>
                      )}
                      {isLockedCurrent && liveEditWindow.live && (
                        <Badge variant="outline" className="text-[9px] h-5 gap-1 bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20">
                          <ShieldAlert className="h-2.5 w-2.5" /> Edit window {formatCountdownShort(liveEditWindow.msLeft)}
                        </Badge>
                      )}
                      {isLockedCurrent && liveEditWindow.live && (
                        <Button size="sm" variant="ghost" className="h-7 text-xs gap-1 text-muted-foreground" onClick={() => { closeStructureEditWindow('Principal'); toast.info('Editing window closed — the structure is locked again.') }}>
                          <Lock className="h-3 w-3" /> End window
                        </Button>
                      )}
                    </>
                  ) : (
                    // Permission UNAVAILABLE — the UI must never imply the
                    // Principal can edit. NO Edit, NO Request Edit, NO
                    // edit-window controls: a plain "View only" state makes
                    // the platform permission visible at a glance.
                    <Badge
                      variant="outline"
                      data-testid="structure-view-only"
                      className="text-[9px] h-5 gap-1 bg-muted/60 text-muted-foreground border-border shrink-0"
                      title="Fee structure editing is disabled for your school by the platform configuration"
                    >
                      <Eye className="h-2.5 w-2.5" /> View Only
                    </Badge>
                  )}
                  <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={() => setHistoryOpen(true)}>
                    <History className="h-3 w-3" /> History
                  </Button>
                  {/* Duplicate CREATES a draft (an edit-capability action,
                      store-denied without fee_structure_edit) — it is hidden
                      when the school's configuration makes structures
                      read-only instead of presenting a silent no-op. */}
                  {canEdit && (
                    <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={handleDuplicate}>
                      <Copy className="h-3 w-3" /> Duplicate
                    </Button>
                  )}
                  {currentVersion && (
                    <Button
                      size="sm" variant="ghost" className="h-7 text-xs gap-1 text-amber-600"
                      onClick={handleArchiveCurrent}
                      disabled={!perms.fee_structure_archive}
                      title={perms.fee_structure_archive ? 'Archive the current version' : 'Archiving is disabled for your role by the school configuration'}
                    >
                      <Archive className="h-3 w-3" /> Archive
                    </Button>
                  )}
                  {/* SaaS-STAGE-2A (Task 7-b) — the permanent-delete button
                      is REPLACED by a disabled platform-reserved row:
                      fee_structure_delete is ALWAYS false for principals —
                      schools archive; the platform purges after the 30-day
                      retention window. */}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs gap-1 ml-auto text-muted-foreground/60 cursor-not-allowed"
                    disabled
                    title="Principals archive structures; the platform purges after the 30-day retention window"
                  >
                    <Lock className="h-3 w-3" /> Permanent delete · Platform reserved
                  </Button>
                  {scheduledVersions.length > 0 && (
                    <Badge variant="outline" className="text-[9px] h-5 gap-1 ml-1 bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20">
                      <Sparkles className="h-2.5 w-2.5" /> {scheduledVersions.length} ready to publish
                    </Badge>
                  )}
                  {draftVersions.length > 0 && (
                    <Badge variant="outline" className="text-[9px] h-5 gap-1 ml-1 bg-slate-500/10 text-slate-700 dark:text-slate-300 border-slate-500/20">
                      {draftVersions.length} draft{draftVersions.length === 1 ? '' : 's'}
                    </Badge>
                  )}
                </>
              ) : (
                <>
                  <Button size="sm" variant="ghost" className="h-7 text-xs gap-1 text-rose-600" onClick={handleDiscard}>
                    <X className="h-3 w-3" /> Discard
                  </Button>
                  {!isLockedCurrent && (
                    <Button
                      size="sm" variant="outline" className="h-7 text-xs gap-1"
                      onClick={() => setConfirmMode('schedule')}
                      disabled={!perms.fee_structure_publish}
                      title={perms.fee_structure_publish ? 'Schedule for a future effective date' : 'Publishing is disabled for your role by the school configuration'}
                    >
                      <Calendar className="h-3 w-3" /> Schedule
                    </Button>
                  )}
                  <Button
                    size="sm" className="h-7 text-xs gap-1 bg-emerald-600 hover:bg-emerald-700 text-white"
                    onClick={handlePublish}
                    disabled={!hasEdits || validationIssues.length > 0 || !perms.fee_structure_publish}
                    title={!perms.fee_structure_publish
                      ? 'Publishing is disabled for your role — you can edit and save drafts, but publishing requires the fee_structure_publish permission'
                      : undefined}
                  >
                    <Check className="h-3 w-3" /> {isLockedCurrent ? 'Submit Revision' : 'Publish New Version'}
                  </Button>
                </>
              )}
            </div>
          )}

          {/* Body */}
          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            {/* SaaS-STAGE-2A (Task 7-b) — READ-ONLY notice: when the school's
                platform configuration disables fee_structure_edit, the whole
                editing area is inert. Slim, never a banner. */}
            {!canEdit && (
              <div className="rounded-md border border-border/60 bg-muted/40 px-2.5 py-1.5 flex items-start gap-2">
                <Lock className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  <span className="font-medium text-foreground">Read-only</span> — fee structure editing is disabled for your school by the platform configuration
                </p>
              </div>
            )}

            {/* Validation banner */}
            {editing && validationIssues.length > 0 && (
              <div className="rounded-md border border-rose-500/30 bg-rose-500/5 px-2.5 py-1.5 flex items-start gap-2">
                <AlertCircle className="h-3.5 w-3.5 text-rose-600 shrink-0 mt-0.5" />
                <div className="text-[11px] text-rose-700 dark:text-rose-300">
                  {validationIssues.map((iss, i) => <p key={i}>{iss}</p>)}
                </div>
              </div>
            )}

            {/* Edit-mode callout — kept for normal edit mode only.
                FEE-CREATE-UI: removed the "Create Mode" banner entirely
                (the compact header now carries the metadata inputs +
                working total; the bottom action bar carries the status
                text + Save Draft / Publish buttons, so the create-mode
                drawer no longer needs an explanatory banner). */}
            {editing && !isCreateMode && (
              <div className="rounded-md border border-sky-500/30 bg-sky-500/5 px-3 py-2 flex items-start gap-2">
                <Pencil className="h-3.5 w-3.5 text-sky-600 shrink-0 mt-0.5" />
                <div className="text-[11px] text-muted-foreground">
                  <p className="font-semibold text-sky-700 dark:text-sky-300">Edit Mode</p>
                  <p className="mt-0.5">
                    Changes are NOT yet committed. Publishing creates a new immutable version with full audit trail — existing payments stay on the previous structure.
                  </p>
                  {hasEdits && (
                    <p className="mt-1 font-mono text-[10px]">
                      Working total: <span className="font-semibold text-foreground">{formatINR(workingTotal, true)}</span>
                      {workingTotal !== structure.annual && (
                        <span className={cn('ml-2', workingTotal > structure.annual ? 'text-rose-600' : 'text-emerald-600')}>
                          ({workingTotal > structure.annual ? '+' : ''}{formatINR(workingTotal - structure.annual, true)} vs current)
                        </span>
                      )}
                      {/* FEE-EXAM: show the per-exam fee schedule total
                          alongside the recurring total so the operator can
                          see both components of the student's annual
                          obligation while editing. */}
                      {workingExamFeeTotal > 0 && (
                        <span className="ml-2 text-muted-foreground">
                          · +{formatINR(workingExamFeeTotal, true)} exam fees
                        </span>
                      )}
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* STRUCT-REV — live revision panel (PART 12/14/15): progress
                toward the 60% acknowledgement threshold, publish when
                reached, cancel to keep the published structure active. */}
            {structureRevision && (
              <RevisionPanel
                revision={structureRevision}
                onPublish={() => {
                  const res = publishStructureRevision(structureRevision.id, 'Principal')
                  if (!res.success) {
                    toast.error('Cannot publish revision', { description: res.error })
                    return
                  }
                  toast.success(`Revision published — v${structureRevision.toVersion} is now current`, {
                    description: `${structureRevision.className} guardians and staff notified. Historical transactions keep their original amounts.`,
                  })
                }}
                onCancel={(reason) => {
                  const res = cancelStructureRevision(structureRevision.id, 'Principal', reason)
                  if (res.success) toast.info('Revision cancelled — the published version continues to apply.')
                  else toast.error('Cannot cancel', { description: res.error })
                }}
              />
            )}

            {/* Fee Head Table */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-[11px] font-semibold flex items-center gap-1.5">
                  <FileText className="h-3 w-3" /> Fee Heads
                  <Badge variant="outline" className="text-[9px] h-4 px-1 ml-1">{workingHeads.length}</Badge>
                </p>
                {editing && canEdit && (
                  <Button size="sm" variant="outline" className="h-6 text-[10px] gap-1" onClick={() => setShowAddHead(true)}>
                    <Plus className="h-3 w-3" /> Add Head
                  </Button>
                )}
              </div>

              <div className="rounded-md border border-border overflow-hidden">
                {/* Table header */}
                <div className="grid grid-cols-[1.5fr_0.8fr_0.9fr_auto_auto] gap-2 px-2.5 py-1.5 bg-muted/40 text-[9px] uppercase font-semibold text-muted-foreground tracking-wider">
                  <span>Fee Head</span>
                  <span className="text-right">Amount</span>
                  <span>Frequency</span>
                  <span className="text-center">Mandatory</span>
                  <span className="text-right">{editing ? 'Action' : 'Status'}</span>
                </div>
                {/* Body */}
                <div className="divide-y divide-border/40">
                  {workingHeads.length === 0 ? (
                    <div className="text-center text-[11px] text-muted-foreground py-6">
                      No fee heads added yet.
                    </div>
                  ) : (
                    workingHeads.map((h) => (
                      <FeeHeadRow
                        key={h.id}
                        head={h}
                        editing={editing}
                        // SaaS-STAGE-2A (Task 7-b) — read-only editor when
                        // the school's configuration disables editing.
                        locked={!canEdit}
                        onChange={(patch) => updateWorkingHead(h.id, patch)}
                        onRemove={() => removeWorkingHead(h.id)}
                        // PHASE 7 — Re-link from catalogue row action.
                        // Patches catalogueId + category ONLY (no version
                        // bump — metadata change). Toast surfaces the
                        // action's outcome. Wired to the live structure
                        // so the link persists across drawer reopens.
                        onRelink={(catalogueId, category) => {
                          if (!structure || isCreateMode) {
                            // For create-mode drafts, update the working
                            // head's catalogueId + category directly
                            // (no live structure to mutate yet).
                            updateWorkingHead(h.id, { catalogueId, category })
                            toast.success('Catalogue link applied', {
                              description: 'Will be saved when you publish the structure.',
                            })
                            return
                          }
                          const result = linkHeadToCatalogue(structure.id, h.id, catalogueId, category)
                          if (result.success) {
                            toast.success('Head linked to catalogue', {
                              description: 'Amount and frequency stay as-is. Historical payments are unaffected.',
                            })
                          } else {
                            toast.error('Could not link head', {
                              description: result.error,
                            })
                          }
                        }}
                        onUnlink={() => {
                          if (!structure || isCreateMode) {
                            updateWorkingHead(h.id, { catalogueId: undefined, category: undefined })
                            toast.success('Catalogue link cleared')
                            return
                          }
                          const result = linkHeadToCatalogue(structure.id, h.id, '', undefined)
                          if (result.success) {
                            toast.success('Head unlinked from catalogue', {
                              description: 'It is now a custom head.',
                            })
                          }
                        }}
                      />
                    ))
                  )}
                </div>
                {/* Footer / total */}
                <div className="grid grid-cols-[1.5fr_0.8fr_0.9fr_auto_auto] gap-2 px-2.5 py-1.5 bg-muted/30 border-t border-border text-[10px] font-semibold">
                  <span>Total (active)</span>
                  <span className="text-right font-mono tabular-nums text-emerald-700 dark:text-emerald-300">{formatINR(workingTotal, true)}</span>
                  <span></span>
                  <span></span>
                  <span></span>
                </div>
              </div>

              {/* Add head inline form */}
              <AnimatePresence>
                {editing && showAddHead && (
                  <AddHeadForm
                    existingNames={workingHeads.map((h) => h.name.toLowerCase())}
                    // SaaS-STAGE-2A (Task 7-b) — picker + add button are
                    // disabled in read-only mode.
                    locked={!canEdit}
                    onAdd={addWorkingHead}
                    onCancel={() => setShowAddHead(false)}
                    // PHASE 6 — dispatch a CustomEvent so the parent
                    // (fees-structures.tsx) opens its Master Catalogue
                    // drawer. The drawer remains the single source of
                    // truth for catalogue administration — the Add-Head
                    // form never edits the catalogue directly.
                    onOpenCatalogue={() => {
                      window.dispatchEvent(new CustomEvent('fee-open-catalogue'))
                    }}
                  />
                )}
              </AnimatePresence>
            </div>

            {/* FEE-EXAM — Examination Fee Schedule
                Per-examination charges, separate from the recurring fee
                heads above. Charged once per conducted exam of the matching
                exam type. The exam-creation flow in the Examination module
                reads this schedule to auto-resolve `examFee` for new exams.

                EXAM INTEGRATION — the selectable exam types come from the
                Examination module (source of truth); this editor only
                configures the FINANCIAL charge for an exam that already
                exists there. It never creates a duplicate exam definition. */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-1.5">
                  <p className="text-[11px] font-semibold flex items-center gap-1.5">
                    <Award className="h-3 w-3" /> Examination Fee Schedule
                    <Badge variant="outline" className="text-[9px] h-4 px-1 ml-1">{workingExamSchedule.length}</Badge>
                  </p>
                  <span className="text-[10px] text-muted-foreground">Examinations configured in the Examination module</span>
                </div>
                {editing && canEdit && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 text-[10px] gap-1"
                    onClick={() => setShowAddExamFee(true)}
                    disabled={examTypesLoading}
                    title={examTypesLoading ? 'Loading examination types…' : undefined}
                  >
                    <Plus className="h-3 w-3" /> Add Exam Fee
                  </Button>
                )}
              </div>

              <div className="rounded-md border border-border overflow-hidden">
                {/* Table header */}
                <div className="grid grid-cols-[1.5fr_0.8fr_0.6fr_auto_auto_0.7fr] gap-2 px-2.5 py-1.5 bg-muted/40 text-[9px] uppercase font-semibold text-muted-foreground tracking-wider">
                  <span>Exam Type</span>
                  <span className="text-right">Amount</span>
                  <span className="text-center">Planned</span>
                  <span className="text-center">Mandatory</span>
                  <span className="text-center">Active</span>
                  <span className="text-right">{editing ? 'Action' : 'Status'}</span>
                </div>
                {/* Body */}
                <div className="divide-y divide-border/40">
                  {workingExamSchedule.length === 0 ? (
                    <div className="text-center text-[11px] text-muted-foreground py-6">
                      No examination fees configured yet.
                      {editing && !examTypesLoading && (
                        <div className="mt-2">
                          <Button size="sm" variant="outline" className="h-6 text-[10px] gap-1" onClick={() => setShowAddExamFee(true)}>
                            <Plus className="h-3 w-3" /> Select examinations
                          </Button>
                        </div>
                      )}
                    </div>
                  ) : (
                    workingExamSchedule.map((e) => (
                      <ExamFeeRow
                        key={e.id}
                        entry={e}
                        editing={editing}
                        // SaaS-STAGE-2A (Task 7-b) — read-only editor.
                        locked={!canEdit}
                        existingTypes={workingExamSchedule.map((x) => x.examType.toLowerCase())}
                        availableTypes={examTypeDefs.map((t) => t.name)}
                        onChange={(patch) => updateWorkingExamFee(e.id, patch)}
                        onRemove={() => removeWorkingExamFee(e.id)}
                      />
                    ))
                  )}
                </div>
                {/* Footer / total */}
                <div className="grid grid-cols-[1.5fr_0.8fr_0.6fr_auto_auto_0.7fr] gap-2 px-2.5 py-1.5 bg-muted/30 border-t border-border text-[10px] font-semibold">
                  <span>Total (active exam fees)</span>
                  <span className="text-right font-mono tabular-nums text-emerald-700 dark:text-emerald-300">{formatINR(workingExamFeeTotal, true)}</span>
                  <span></span>
                  <span></span>
                  <span></span>
                  <span></span>
                </div>
              </div>

              {/* Add exam fee inline form */}
              <AnimatePresence>
                {editing && showAddExamFee && (
                  <AddExamFeeForm
                    existingTypes={workingExamSchedule.map((e) => e.examType.toLowerCase())}
                    availableTypes={examTypeDefs.map((t) => t.name)}
                    loadingTypes={examTypesLoading}
                    // SaaS-STAGE-2A (Task 7-b) — read-only editor.
                    locked={!canEdit}
                    onAdd={addWorkingExamFee}
                    onCancel={() => setShowAddExamFee(false)}
                    onNavigate={onNavigate}
                  />
                )}
              </AnimatePresence>
            </div>

            {/* Recent activity (change log) — hidden in create mode (no
                history yet for a not-yet-saved structure). */}
            {!isCreateMode && (
              <div>
                <p className="text-[11px] font-semibold mb-1.5 flex items-center gap-1.5">
                  <History className="h-3 w-3" /> Recent Activity
                  <Badge variant="outline" className="text-[9px] h-4 px-1 ml-1">{structureChangeLog.length}</Badge>
                </p>
                {structureChangeLog.length === 0 ? (
                  <div className="rounded-md border border-dashed border-border bg-muted/20 px-3 py-3 text-center text-[11px] text-muted-foreground">
                    No activity recorded yet.
                  </div>
                ) : (
                  <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                    {structureChangeLog.slice(0, 10).map((log) => (
                      <ChangeLogRow key={log.id} log={log} />
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Scheduled / Draft versions inline notice — hidden in
                create mode (no versions yet). */}
            {/* SaaS-STAGE-1 — version lifecycle vocabulary: scheduled =
                "Ready for publish" (Promote → Publish now); drafts stay
                mutable until published. Saving a draft NEVER makes it live. */}
            {!isCreateMode && (scheduledVersions.length > 0 || draftVersions.length > 0) && (
              <div className="rounded-md border border-amber-500/20 bg-amber-500/5 px-3 py-2">
                <p className="text-[11px] font-semibold text-amber-700 dark:text-amber-300 mb-1 flex items-center gap-1.5">
                  <Sparkles className="h-3 w-3" /> Pending versions
                </p>
                <div className="space-y-1">
                  {scheduledVersions.map((v) => (
                    <div key={v.id} className="flex items-center justify-between text-[10px]">
                      <span>
                        Version {v.version} · <span className="text-sky-700 dark:text-sky-300 font-medium">Ready for publish</span>
                        {' '}— effective {formatDate(v.effectiveFrom)}
                      </span>
                      <div className="flex items-center gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-5 text-[9px] text-sky-600 px-1"
                          disabled={!perms.fee_structure_publish}
                          title={perms.fee_structure_publish ? 'Publish this version now' : 'Publishing is disabled for your role by the school configuration'}
                          onClick={() => {
                            // Publish the scheduled version immediately.
                            // FEE-EXAM: pass the scheduled version's
                            // examFeeSchedule snapshot so the promoted
                            // current version carries the same per-exam
                            // fees the Principal configured at schedule time.
                            const newId = publishFeeStructureVersion(structure.id, v.heads, new Date().toISOString().split('T')[0], `Published from scheduled v${v.version}`, 'Principal', v.examFeeSchedule)
                            if (newId) toast.success('Version published — now current')
                          }}
                        >
                          Publish now
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-5 text-[9px] text-rose-600 px-1"
                          onClick={() => { archiveFeeStructureVersion(v.id, 'Principal'); toast.info('Scheduled version archived') }}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ))}
                  {draftVersions.map((v) => (
                    <div key={v.id} className="flex items-center justify-between text-[10px]">
                      <span>
                        Version {v.version} · <span className="font-medium">Draft</span>
                        {' '}(created {formatDate(v.createdAt)}) — not live until published
                      </span>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-5 text-[9px] text-rose-600 px-1"
                        onClick={() => { archiveFeeStructureVersion(v.id, 'Principal'); toast.info('Draft archived') }}
                      >
                        Discard
                      </Button>
                    </div>
                  ))}
                </div>
                <p className="text-[10px] text-muted-foreground mt-1.5">
                  Open History for the full version timeline + compare view.
                </p>
              </div>
            )}
          </div>

          {/* Footer (when editing) — in create mode shows Cancel / Save
              Draft / Publish New Version (left-to-right: status, Cancel,
              Save Draft, Publish New Version). In view-mode editing shows
              the original Cancel / Schedule / Publish New Version bar. */}
          {editing && (
            <div className="border-t border-border bg-muted/30 px-5 py-3 flex items-center justify-between gap-2">
              {isCreateMode ? (
                <>
                  <div className="text-[10px] text-muted-foreground">
                    {!createValid ? (
                      <span>Enter required details to continue.</span>
                    ) : createHasEdits ? (
                      <span className="text-amber-700 dark:text-amber-300 font-medium">Unsaved entries — save draft to commit</span>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={handleCancelCreate} disabled={createSubmitting}>
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      className="h-8 text-xs gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
                      onClick={handleSaveDraft}
                      // SaaS-STAGE-2A (Task 7-b) — the Save Draft path is an
                      // EDIT flow: gated on fee_structure_edit (the store
                      // rejects the create at action time too).
                      disabled={!createValid || createSubmitting || !perms.fee_structure_edit}
                      title={!perms.fee_structure_edit
                        ? 'Read-only — fee structure editing is disabled for your school by the platform configuration'
                        : undefined}
                    >
                      {createSubmitting ? (
                        <>
                          <span className="h-3.5 w-3.5 rounded-full border-2 border-white/40 border-t-white animate-spin" />
                          Saving…
                        </>
                      ) : (
                        <>
                          <Save className="h-3.5 w-3.5" /> Save Draft
                        </>
                      )}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 text-xs gap-1.5"
                      onClick={handlePublishNew}
                      disabled={!createValid || createSubmitting || validationIssues.length > 0 || !perms.fee_structure_publish || !perms.fee_structure_edit}
                      title={!perms.fee_structure_publish
                        ? 'Publishing is disabled for your role — save a draft and publish once the school enables fee_structure_publish'
                        : validationIssues.length > 0 ? 'Resolve validation issues first' : 'Create + immediately publish v1 as current'}
                    >
                      {createSubmitting ? (
                        <>
                          <span className="h-3.5 w-3.5 rounded-full border-2 border-emerald-600/40 border-t-emerald-600 animate-spin" />
                          Publishing…
                        </>
                      ) : (
                        <>
                          <Check className="h-3.5 w-3.5" /> Publish New Version
                        </>
                      )}
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <div className="text-[10px] text-muted-foreground">
                    {hasEdits ? (
                      <span className="text-amber-700 dark:text-amber-300 font-medium">Unsaved changes — publish to commit</span>
                    ) : (
                      <span>No changes from current version</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={handleDiscard}>Cancel</Button>
                    {!isLockedCurrent && (
                      <Button
                        variant="outline" size="sm" className="h-8 text-xs gap-1.5"
                        onClick={handleSchedule}
                        disabled={!hasEdits || validationIssues.length > 0 || !perms.fee_structure_publish}
                        title={perms.fee_structure_publish ? undefined : 'Publishing is disabled for your role by the school configuration'}
                      >
                        <Calendar className="h-3.5 w-3.5" /> Schedule
                      </Button>
                    )}
                    <Button
                      size="sm" className="h-8 text-xs gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
                      onClick={handlePublish} disabled={!hasEdits || validationIssues.length > 0 || !perms.fee_structure_publish}
                      title={!perms.fee_structure_publish
                        ? 'Publishing is disabled for your role by the school configuration'
                        : isLockedCurrent ? 'Creates a PROPOSED version — 60% guardian acknowledgement required before it can be published' : undefined}
                    >
                      <Check className="h-3.5 w-3.5" /> {isLockedCurrent ? 'Submit Revision' : 'Publish New Version'}
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}
        </motion.div>
      </motion.div>

      {/* Confirm dialog */}
      <FeesStructuresConfirmDialog
        open={confirmMode !== null}
        structure={structure}
        oldHeads={oldHeads}
        newHeads={newHeads}
        effectiveFrom={new Date().toISOString().split('T')[0]}
        mode={confirmMode ?? 'publish'}
        onConfirm={(reason, eff) => {
          if (confirmMode === 'revision') handleConfirmRevision(reason, eff)
          else if (confirmMode === 'publish') handleConfirmPublish(reason, eff)
          else if (confirmMode === 'schedule') handleConfirmSchedule(reason, eff)
        }}
        onClose={() => setConfirmMode(null)}
      />

      {/* History dialog */}
      <FeesStructuresHistoryDialog
        open={historyOpen}
        structure={structure}
        onClose={() => setHistoryOpen(false)}
        onRevert={handleRevert}
        onArchive={handleArchiveVersion}
      />

      {/* SaaS-STAGE-2A (Task 7-b) — the permanent-delete confirmation dialog
          was removed with the Delete action: fee_structure_delete is
          platform-reserved and the principal UI never offers it. Principals
          archive structures; the platform purges after the 30-day retention
          window. */}
    </>
  )
}

// ─── Fee Head Row (view + edit modes) ───────────────────────────────

// PHASE 7 — Re-link from catalogue popover. A compact icon-only button
// that opens a Popover with the master fee-head catalogue. Lets the
// principal fix an uncatalogued head without leaving the structure
// detail drawer (worklog Phase 5 next-round priority (f)).
//
// Reuses the same shared helpers (CATEGORY_ICONS, CATEGORY_CHIPS,
// CategoryBadge, FrequencyBadge, GstBadge, AmountBadge) as the
// Master Catalogue drawer and the Add-Head picker so the visual
// language is consistent across all three surfaces.
//
// On pick: calls `onRelink(catalogueId, category)` which the parent
// (DetailDrawerInner) wires to the live `linkHeadToCatalogue` store
// action — no version bump, no financial change. Historical payments
// stay on their original version; the live structure's amount /
// frequency / mandatory / active fields stay as-is.
//
// When the head is already catalogued, the trigger button shows a
// distinct emerald style + tooltip "Re-link from catalogue" so the
// principal can swap catalogue entries without first unlinking.
function RelinkFromCatalogueButton({
  head,
  onRelink,
  onUnlink,
}: {
  head: FeeHead
  onRelink: (catalogueId: string, category?: FeeHeadCategory) => void
  onUnlink?: () => void
}) {
  const feeHeads = useSchoolSettingsStore((s) => s.fees.feeHeads)
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<FeeHeadCategory | 'all'>('all')

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return feeHeads.filter((h) => {
      if (h.archived) return false
      if (filter !== 'all' && h.type !== filter) return false
      if (!q) return true
      if (!h.name.toLowerCase().includes(q)) {
        const desc = (h.description ?? '').toLowerCase()
        if (!desc.includes(q)) return false
      }
      return true
    })
  }, [feeHeads, filter, search])

  const handlePick = (h: { id: string; type: FeeHeadCategory }) => {
    onRelink(h.id, h.type)
    setOpen(false)
    setSearch('')
    setFilter('all')
  }

  const isBound = !!head.catalogueId

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={isBound ? 'Re-link from catalogue' : 'Link from catalogue'}
          className={cn(
            'inline-flex h-6 w-6 items-center justify-center rounded-md transition-colors',
            isBound
              ? 'text-emerald-600 hover:bg-emerald-500/10 ring-1 ring-emerald-500/20'
              : 'text-amber-600 hover:bg-amber-500/10 ring-1 ring-amber-500/20',
          )}
        >
          <Link2 className="h-3 w-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="end" sideOffset={4}>
        <div className="px-2 py-2 border-b border-border">
          <div className="flex items-center justify-between gap-2 mb-1.5">
            <p className="text-[10px] font-semibold leading-none">
              {isBound ? 'Re-link from catalogue' : 'Link to catalogue'}
            </p>
            {isBound && onUnlink && (
              <button
                type="button"
                onClick={() => {
                  onUnlink()
                  setOpen(false)
                }}
                className="text-[9px] text-rose-600 hover:text-rose-700 inline-flex items-center gap-0.5"
                title="Unlink (make this a custom head)"
              >
                <Link2Off className="h-2.5 w-2.5" /> Unlink
              </button>
            )}
          </div>
          <p className="text-[9px] text-muted-foreground leading-snug">
            {isBound
              ? 'Pick a different catalogue entry to swap the binding. Amount + frequency stay as-is.'
              : 'Pick a catalogue entry to bind this head. Amount + frequency stay as-is.'}
          </p>
        </div>
        {/* Search */}
        <div className="p-2 border-b border-border">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search catalogue…"
              className="pl-7 h-7 text-[11px] bg-card"
              autoFocus
            />
          </div>
        </div>
        {/* Category filter chips */}
        <div className="px-2 py-1.5 border-b border-border flex items-center gap-1 overflow-x-auto">
          <button
            type="button"
            onClick={() => setFilter('all')}
            className={cn(
              'shrink-0 text-[9px] px-1.5 py-0.5 rounded-full transition-colors',
              filter === 'all'
                ? 'bg-foreground text-background'
                : 'bg-muted text-muted-foreground hover:bg-muted/80',
            )}
          >
            All
          </button>
          {CATEGORY_ORDER.map((cat) => {
            const Icon = CATEGORY_ICONS[cat]
            const chip = CATEGORY_CHIPS[cat]
            return (
              <button
                key={cat}
                type="button"
                onClick={() => setFilter(cat)}
                title={`Filter by ${cat}`}
                className={cn(
                  'shrink-0 inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded-full transition-all',
                  filter === cat
                    ? cn(chip, 'ring-1 font-medium')
                    : 'bg-muted text-muted-foreground hover:bg-muted/80',
                )}
              >
                <Icon className="h-2 w-2" /> {cat}
              </button>
            )
          })}
        </div>
        {/* Catalogue entries list */}
        <div className="max-h-56 overflow-y-auto divide-y divide-border/30">
          {filtered.length === 0 ? (
            <div className="px-3 py-4 text-center">
              <p className="text-[10px] text-muted-foreground">No catalogue entries match.</p>
            </div>
          ) : (
            filtered.map((h) => {
              const Icon = CATEGORY_ICONS[h.type] ?? Layers
              const chip = CATEGORY_CHIPS[h.type] ?? CATEGORY_CHIPS.Other
              const isSelected = h.id === head.catalogueId
              return (
                <button
                  key={h.id}
                  type="button"
                  onClick={() => handlePick(h)}
                  className={cn(
                    'w-full px-2.5 py-1.5 flex items-start gap-2 text-left hover:bg-muted/40 transition-colors',
                    isSelected && 'bg-emerald-500/5',
                  )}
                >
                  <div className={cn(
                    'flex h-6 w-6 shrink-0 items-center justify-center rounded ring-1 mt-0.5',
                    chip,
                  )}>
                    <Icon className="h-3 w-3" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1">
                      <p className="text-[11px] font-medium text-foreground truncate leading-tight">{h.name}</p>
                      {isSelected && (
                        <span className="text-[8px] text-emerald-600 font-medium shrink-0 inline-flex items-center gap-0.5">
                          <Check className="h-2 w-2" /> current
                        </span>
                      )}
                    </div>
                    {h.description && (
                      <p className="text-[9px] text-muted-foreground leading-tight mt-0.5 line-clamp-1 italic border-l-2 border-muted-foreground/20 pl-1.5">
                        {h.description}
                      </p>
                    )}
                    <div className="flex items-center gap-1 flex-wrap mt-0.5">
                      <CategoryBadge category={h.type} withIcon={false} />
                      <FrequencyBadge frequency={h.frequency} />
                      {h.isTaxable && <GstBadge isTaxable taxRate={h.taxRate} />}
                      <AmountBadge amount={h.defaultAmount} />
                    </div>
                  </div>
                </button>
              )
            })
          )}
        </div>
        <div className="px-2 py-1.5 border-t border-border bg-muted/30 text-[8px] text-muted-foreground text-center leading-snug">
          Linking only updates the catalogue binding. Amount + frequency stay as-is.
        </div>
      </PopoverContent>
    </Popover>
  )
}

interface FeeHeadRowProps {
  head: FeeHead
  editing: boolean
  /** SaaS-STAGE-2A (Task 7-b) — when true (fee_structure_edit disabled),
   *  every edit affordance in the row is disabled (read-only editor). */
  locked?: boolean
  onChange: (patch: Partial<FeeHead>) => void
  onRemove: () => void
  /** PHASE 7 — Re-link from catalogue row action. Called when the
   *  principal picks a catalogue entry from the inline popover.
   *  Patches ONLY catalogueId + category (no version bump). */
  onRelink?: (catalogueId: string, category?: FeeHeadCategory) => void
  /** PHASE 7 — Unlink from catalogue. Clears catalogueId + category. */
  onUnlink?: () => void
}

function FeeHeadRow({ head, editing, locked, onChange, onRemove, onRelink, onUnlink }: FeeHeadRowProps) {
  // SaaS-STAGE-2A (Task 7-b) — read-only editor when locked.
  const editLocked = locked === true
  if (editing) {
    return (
      <div className="grid grid-cols-[1.5fr_0.8fr_0.9fr_auto_auto] gap-2 px-2.5 py-1.5 items-center text-[11px]">
        <Input
          value={head.name}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder="Fee head name"
          className="h-6 text-[11px]"
          disabled={editLocked}
        />
        <MoneyInput
          value={head.amount}
          onChange={(v) => onChange({ amount: v ?? 0 })}
          className="h-6 text-[11px]"
          ariaLabel="Fee head amount"
          disabled={editLocked}
        />
        <select
          value={head.frequency}
          onChange={(e) => onChange({ frequency: e.target.value as Frequency })}
          className="h-6 text-[11px] rounded-md border border-border bg-background px-1.5"
          disabled={editLocked}
        >
          {FREQUENCIES.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
        <div className="flex items-center justify-center gap-1.5">
          <label className="flex items-center gap-1 cursor-pointer">
            <input
              type="checkbox"
              checked={head.mandatory}
              onChange={(e) => onChange({ mandatory: e.target.checked })}
              className="rounded"
              disabled={editLocked}
            />
            <span className="text-[10px] text-muted-foreground">Mandatory</span>
          </label>
          <label className="flex items-center gap-1 cursor-pointer">
            <input
              type="checkbox"
              checked={head.active}
              onChange={(e) => onChange({ active: e.target.checked })}
              className="rounded"
              disabled={editLocked}
            />
            <span className="text-[10px] text-muted-foreground">Enabled</span>
          </label>
        </div>
        {/* PHASE 7 — Re-link + Remove actions. The Re-link button opens
            a compact popover with the master catalogue so the principal
            can fix an uncatalogued head without leaving the drawer
            (worklog Phase 5 next-round priority (f)).
            SaaS-STAGE-2A (Task 7-b) — both hidden while locked. */}
        <div className="flex items-center justify-end gap-0.5">
          {onRelink && !editLocked && (
            <RelinkFromCatalogueButton
              head={head}
              onRelink={onRelink}
              onUnlink={onUnlink}
            />
          )}
          {!editLocked && (
            <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-rose-600 hover:bg-rose-500/10" onClick={onRemove} title="Remove head">
              <Trash2 className="h-3 w-3" />
            </Button>
          )}
        </div>
      </div>
    )
  }
  return (
    <div className="grid grid-cols-[1.5fr_0.8fr_0.9fr_auto_0.7fr] gap-2 px-2.5 py-1.5 items-center text-[11px] hover:bg-muted/20">
      <div className="flex items-center gap-1.5 min-w-0">
        <span className={cn('h-1.5 w-1.5 rounded-full shrink-0', head.active ? 'bg-emerald-500' : 'bg-muted-foreground/40')} />
        <span className={cn('truncate font-medium', !head.active && 'line-through text-muted-foreground')}>{head.name}</span>
        {/* PHASE 6 — catalogue binding indicator. Inline so it doesn't
            push the amount/frequency columns out of alignment. */}
        {head.catalogueId ? (
          <CatalogueBoundPill />
        ) : (
          <CustomHeadPill />
        )}
        {head.category && <CategoryBadge category={head.category} withIcon={false} />}
      </div>
      <span className="font-mono tabular-nums text-right">{formatINR(head.amount, true)}</span>
      <span className="text-muted-foreground text-[10px]">{head.frequency}</span>
      <div className="text-center">
        {head.mandatory ? (
          <Badge variant="outline" className="text-[7px] py-0 px-1 h-3.5">Mandatory</Badge>
        ) : (
          <Badge variant="outline" className="text-[7px] py-0 px-1 h-3.5 text-muted-foreground">Optional</Badge>
        )}
      </div>
      <div className="text-right text-[10px]">
        {head.active ? (
          <span className="inline-flex items-center gap-0.5 text-emerald-600"><CheckCircle2 className="h-2.5 w-2.5" /> Active</span>
        ) : (
          <span className="inline-flex items-center gap-0.5 text-muted-foreground"><Archive className="h-2.5 w-2.5" /> Archived</span>
        )}
      </div>
    </div>
  )
}

// ─── Add Head inline form ───────────────────────────────────────────

interface AddHeadFormProps {
  existingNames: string[]
  /** SaaS-STAGE-2A (Task 7-b) — read-only mode (fee_structure_edit off):
   *  the picker and every input/add control are disabled. */
  locked?: boolean
  onAdd: (head: Omit<FeeHead, 'id'>) => void
  onCancel: () => void
  /** Optional callback fired when the principal clicks "Add new to catalogue"
   *  from inside the picker's footer. Default: opens the master catalogue
   *  drawer (the parent wires this via a CustomEvent so the drawer stays
   *  the single source of truth for catalogue administration). */
  onOpenCatalogue?: () => void
}

function AddHeadForm({ existingNames, locked, onAdd, onCancel, onOpenCatalogue }: AddHeadFormProps) {
  // SaaS-STAGE-2A (Task 7-b) — read-only editor when locked.
  const editLocked = locked === true
  // PHASE 6 — catalogue-aware add-head form. State now tracks both the
  // catalogue-derived fields (catalogueId + category + isTaxable + taxRate)
  // AND the legacy name/amount/frequency/mandatory fields so a principal
  // can switch between "pick from catalogue" and "type custom name"
  // without losing their other in-progress edits.
  const [catalogueId, setCatalogueId] = useState<string>('')
  const [name, setName] = useState('')
  const [amount, setAmount] = useState(0)
  const [frequency, setFrequency] = useState<Frequency>('Annual')
  const [mandatory, setMandatory] = useState(true)
  const [category, setCategory] = useState<FeeHeadCategory | undefined>(undefined)
  const [isTaxable, setIsTaxable] = useState(false)
  const [taxRate, setTaxRate] = useState(18)
  // `customMode` is true when the principal explicitly clicked
  // "Type custom name instead" in the picker footer. While true, the
  // picker stays hidden and a plain text input + "Pick from catalogue"
  // restore button take its place. Resets to false on submit.
  const [customMode, setCustomMode] = useState(false)

  const trimmedName = name.trim()
  const isDuplicate = existingNames.includes(trimmedName.toLowerCase())
  const isValid = trimmedName.length > 0 && amount >= 0 && !isDuplicate

  // Reset every field — called after a successful commit so the next
  // "Add Head" click starts from a clean slate (per Phase 6 audit:
  // forgetting to reset new state was a real bug class).
  const resetAll = () => {
    setCatalogueId('')
    setName('')
    setAmount(0)
    setFrequency('Annual')
    setMandatory(true)
    setCategory(undefined)
    setIsTaxable(false)
    setTaxRate(18)
    setCustomMode(false)
  }

  const submit = () => {
    if (!isValid) return
    onAdd({
      name: trimmedName,
      amount,
      frequency,
      mandatory,
      active: true,
      // PHASE 6 — persist the catalogue binding (if any) + category
      // so the new head is properly linked from creation. Custom heads
      // (no catalogueId) will surface in the Normalize Uncatalogued Heads
      // tool — by design, not a bug.
      //
      // Note: isTaxable / taxRate / gstHsnCode are NOT stored on the
      // per-structure FeeHead — they live on the master catalogue entry
      // and are inherited via the catalogueId binding. This avoids
      // duplicating tax metadata across N structures (brief section 24:
      // "Remove duplication not functionality").
      ...(catalogueId ? { catalogueId } : {}),
      ...(category ? { category } : {}),
    })
    resetAll()
  }

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      className="mt-2 overflow-hidden rounded-md border border-border bg-muted/20"
    >
      <div className="p-2.5 space-y-2.5">
        {/* Catalogue picker row OR custom-name input — never both. */}
        {customMode ? (
          <div className="flex items-center gap-2">
            <Input
              value={name}
              onChange={(e) => {
                setName(e.target.value)
                // Custom-typed name → drop catalogue binding.
                setCatalogueId('')
              }}
              placeholder="Type the custom fee head name"
              className="h-7 text-xs"
              autoFocus
              disabled={editLocked}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 text-[10px] gap-1 border-emerald-500/40 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/10 shrink-0"
              onClick={() => {
                setCustomMode(false)
                // Keep the typed name so the principal doesn't lose it,
                // but clear catalogueId (it stays undefined for custom
                // heads until they explicitly pick from the catalogue).
              }}
              disabled={editLocked}
            >
              <Layers className="h-3 w-3" /> Pick from catalogue
            </Button>
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={onCancel} title="Cancel">
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        ) : (
          <div className="space-y-1.5">
            <div className={editLocked ? 'pointer-events-none opacity-60' : undefined} aria-disabled={editLocked}>
              <FeeHeadCataloguePicker
                selectedCatalogueId={catalogueId}
                onPick={(r) => {
                  setCatalogueId(r.catalogueId)
                  setName(r.name)
                  setAmount(r.amount)
                  setFrequency(r.frequency)
                  setCategory(r.category)
                  setIsTaxable(r.isTaxable ?? false)
                  setTaxRate(r.taxRate ?? 18)
                }}
                onUseCustom={() => {
                  setCustomMode(true)
                  setCatalogueId('')
                }}
                onAddToCatalogue={onOpenCatalogue}
                pickerId="add-head-catalogue"
              />
            </div>
            {catalogueId && (
              <p className="text-[9px] text-emerald-700 dark:text-emerald-300 inline-flex items-center gap-1">
                <Check className="h-2.5 w-2.5" />
                Prefilled from the master catalogue. Edit fields below to override for this class.
              </p>
            )}
          </div>
        )}

        {/* Editable prefill row: Name (when not in customMode) + Amount + Frequency + Mandatory + Add */}
        <div className="grid grid-cols-[1.5fr_0.8fr_0.9fr_auto] gap-2 items-center">
          <div>
            {!customMode && (
              <Input
                value={name}
                onChange={(e) => {
                  const next = e.target.value
                  setName(next)
                  // Editing the prefilled name signals the principal
                  // wants to override → drop the catalogue binding so
                  // the head isn't falsely reported as "from catalogue".
                  // (The Normalize tool can re-link it later.)
                  if (catalogueId && next.trim() !== name.trim()) setCatalogueId('')
                }}
                placeholder="Fee head name (override or type custom)"
                className="h-7 text-xs"
                disabled={editLocked}
              />
            )}
            {isDuplicate && <p className="text-[9px] text-rose-600 mt-0.5">Name already exists in this structure</p>}
          </div>
          <MoneyInput
            value={amount || null}
            onChange={(v) => setAmount(v ?? 0)}
            className="h-7 text-xs"
            ariaLabel="New fee head amount"
            disabled={editLocked}
          />
          <select
            value={frequency}
            onChange={(e) => setFrequency(e.target.value as Frequency)}
            className="h-7 text-xs rounded-md border border-border bg-background px-2"
            disabled={editLocked}
          >
            {FREQUENCIES.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1 text-[10px] cursor-pointer">
              <input type="checkbox" checked={mandatory} onChange={(e) => setMandatory(e.target.checked)} className="rounded" disabled={editLocked} />
              Mand.
            </label>
            <Button size="sm" className="h-7 text-[10px] gap-1" disabled={!isValid || editLocked} onClick={submit}>
              <Check className="h-3 w-3" /> Add
            </Button>
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={onCancel} title="Cancel">
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {/* Live preview row — what the new head will look like in the table */}
        {trimmedName && (
          <div className="border-t border-dashed border-border/60 pt-1.5">
            <p className="text-[9px] text-muted-foreground mb-1 uppercase tracking-wider">Preview</p>
            <div className="flex items-center gap-1 flex-wrap">
              <span className="text-[11px] font-medium text-foreground">{trimmedName}</span>
              {catalogueId ? <CatalogueBoundPill /> : <CustomHeadPill />}
              {category && <CategoryBadge category={category} />}
              <FrequencyBadge frequency={frequency} />
              {isTaxable && <GstBadge isTaxable taxRate={taxRate} />}
              <span className="text-[10px] text-muted-foreground tabular-nums">₹{amount.toLocaleString('en-IN')}</span>
              <Badge variant="outline" className="text-[8px] py-0 px-1 h-3.5">
                {mandatory ? 'Mandatory' : 'Optional'}
              </Badge>
            </div>
          </div>
        )}
      </div>
    </motion.div>
  )
}

// ─── Change log row (recent activity) ──────────────────────────────

function ChangeLogRow({ log }: { log: FeeChangeLog }) {
  const actionColor: Record<string, string> = {
    created: 'text-emerald-600',
    published: 'text-emerald-600',
    scheduled: 'text-amber-600',
    archived: 'text-muted-foreground',
    edited: 'text-sky-600',
    rolled_back: 'text-violet-600',
    restored: 'text-sky-600',
    deleted: 'text-rose-600',
  }
  return (
    <div className="rounded-md border border-border/40 px-2 py-1.5 flex items-start gap-2">
      <span className={cn('text-[9px] font-mono font-semibold shrink-0 mt-0.5 px-1 rounded', actionColor[log.action] ?? 'text-muted-foreground')}>
        {log.action}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] text-muted-foreground">
          {log.changedBy} · {formatDate(log.changedAt)}
        </p>
        {log.reason && <p className="text-[10px] italic text-foreground mt-0.5">"{log.reason}"</p>}
        {log.changes.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {log.changes.slice(0, 5).map((c, i) => (
              <Badge key={i} variant="outline" className="text-[8px] py-0 px-1 h-3.5 font-mono">
                {c.headName}: {formatINR(c.oldValue, true)} → {formatINR(c.newValue, true)}
              </Badge>
            ))}
            {log.changes.length > 5 && <span className="text-[9px] text-muted-foreground">+{log.changes.length - 5} more</span>}
          </div>
        )}
      </div>
      <span className="text-[9px] text-muted-foreground font-mono shrink-0 ml-auto">{log.affectedStudents} students</span>
    </div>
  )
}

// ─── FEE-EXAM — Exam Fee Row (view + edit modes) ─────────────────────
//
// Mirrors the layout / interaction of `FeeHeadRow` but specialized for
// ExamFeeEntry. EXAM INTEGRATION: the exam type is a SELECT populated
// from the Examination module's configured exam types (minus the types
// already used by OTHER rows) — the editor can re-point a charge at a
// different configured exam, but can never invent a free-text exam
// definition that doesn't exist in the Examination module.

interface ExamFeeRowProps {
  entry: ExamFeeEntry
  editing: boolean
  /** SaaS-STAGE-2A (Task 7-b) — read-only mode (fee_structure_edit off). */
  locked?: boolean
  /** Lower-cased list of all exam types currently in the working schedule
   *  (including this row) — used to flag duplicate exam types. */
  existingTypes: string[]
  /** Exam types configured in the Examination module (source of truth). */
  availableTypes: string[]
  onChange: (patch: Partial<ExamFeeEntry>) => void
  onRemove: () => void
}

function ExamFeeRow({ entry, editing, locked, existingTypes, availableTypes, onChange, onRemove }: ExamFeeRowProps) {
  // SaaS-STAGE-2A (Task 7-b) — read-only editor when locked.
  const editLocked = locked === true
  if (editing) {
    const isDuplicate = existingTypes.filter((t) => t === entry.examType.trim().toLowerCase()).length > 1
    // Other rows may be re-pointed to any configured exam type that this
    // row doesn't already use; this row's current type stays selectable.
    const selectable = [entry.examType, ...availableTypes.filter(
      (t) => t.toLowerCase() !== entry.examType.trim().toLowerCase(),
    )]
    return (
      <div className="grid grid-cols-[1.5fr_0.8fr_0.6fr_auto_auto_0.7fr] gap-2 px-2.5 py-1.5 items-center text-[11px]">
        <div className="min-w-0">
          <select
            value={entry.examType}
            onChange={(e) => onChange({ examType: e.target.value })}
            className="h-6 w-full text-[11px] rounded-md border border-border bg-background px-1.5"
            title="Exam types configured in the Examination module"
            disabled={editLocked}
          >
            {selectable.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          {isDuplicate && <p className="text-[9px] text-rose-600 mt-0.5">Exam type already exists in this structure</p>}
        </div>
        <MoneyInput
          value={entry.amount}
          onChange={(v) => onChange({ amount: v ?? 0 })}
          className="h-6 text-[11px]"
          ariaLabel="Exam fee amount"
          disabled={editLocked}
        />
        <MoneyInput
          value={entry.plannedInstances ?? 1}
          onChange={(v) => onChange({ plannedInstances: Math.max(1, v ?? 1) })}
          showPrefix={false}
          className="h-6 text-[11px]"
          min={1}
          ariaLabel="Planned instances"
          disabled={editLocked}
        />
        <div className="flex items-center justify-center">
          <label className="flex items-center gap-1 cursor-pointer">
            <input
              type="checkbox"
              checked={entry.mandatory}
              onChange={(e) => onChange({ mandatory: e.target.checked })}
              className="rounded"
              disabled={editLocked}
            />
            <span className="text-[10px] text-muted-foreground">Mandatory</span>
          </label>
        </div>
        <div className="flex items-center justify-center">
          <label className="flex items-center gap-1 cursor-pointer">
            <input
              type="checkbox"
              checked={entry.active}
              onChange={(e) => onChange({ active: e.target.checked })}
              className="rounded"
              disabled={editLocked}
            />
            <span className="text-[10px] text-muted-foreground">Enabled</span>
          </label>
        </div>
        <div className="text-right">
          {!editLocked && (
            <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-rose-600 hover:bg-rose-500/10" onClick={onRemove} title="Remove exam fee">
              <Trash2 className="h-3 w-3" />
            </Button>
          )}
        </div>
      </div>
    )
  }
  return (
    <div className="grid grid-cols-[1.5fr_0.8fr_0.6fr_auto_auto_0.7fr] gap-2 px-2.5 py-1.5 items-center text-[11px] hover:bg-muted/20">
      <div className="flex items-center gap-1.5 min-w-0">
        <span className={cn('h-1.5 w-1.5 rounded-full shrink-0', entry.active ? 'bg-emerald-500' : 'bg-muted-foreground/40')} />
        <span className={cn('truncate font-medium', !entry.active && 'line-through text-muted-foreground')}>{entry.examType}</span>
      </div>
      <span className="font-mono tabular-nums text-right">{formatINR(entry.amount, true)}</span>
      <span className="text-center tabular-nums">{entry.plannedInstances ?? 1}×</span>
      <div className="text-center">
        {entry.mandatory ? (
          <Badge variant="outline" className="text-[7px] py-0 px-1 h-3.5">Mandatory</Badge>
        ) : (
          <Badge variant="outline" className="text-[7px] py-0 px-1 h-3.5 text-muted-foreground">Optional</Badge>
        )}
      </div>
      <div className="text-center">
        {entry.active ? (
          <span className="inline-flex items-center gap-0.5 text-emerald-600"><CheckCircle2 className="h-2.5 w-2.5" /> Active</span>
        ) : (
          <span className="inline-flex items-center gap-0.5 text-muted-foreground"><Archive className="h-2.5 w-2.5" /> Archived</span>
        )}
      </div>
      <div className="text-right text-[10px]">
        {entry.active ? (
          <span className="text-emerald-600">Per-exam</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </div>
    </div>
  )
}

// ─── FEE-EXAM — Add Exam Fee inline form (exam-module integrated) ────
//
// EXAM INTEGRATION — the form lists the examinations configured for this
// academic year in the Examination module (minus the ones already in this
// schedule). The Principal ticks an examination, configures the fee
// amount / planned instances / mandatory, and adds it. There is NO
// free-text exam name field: the Fee Structure cannot invent a duplicate
// exam definition.
//
// When every configured examination is already scheduled, the form shows
// "No more examinations configured." with a Go to Examinations action
// that navigates to the Examination module (the source of truth).

interface AddExamFeeFormProps {
  existingTypes: string[]
  /** Exam types configured in the Examination module (source of truth). */
  availableTypes: string[]
  loadingTypes: boolean
  /** SaaS-STAGE-2A (Task 7-b) — read-only mode (fee_structure_edit off). */
  locked?: boolean
  onAdd: (entry: Omit<ExamFeeEntry, 'id'>) => void
  onCancel: () => void
  /** Cross-module navigation for the "Go to Examinations" empty state. */
  onNavigate?: (moduleKey: string) => void
}

function AddExamFeeForm({ existingTypes, availableTypes, loadingTypes, locked, onAdd, onCancel, onNavigate }: AddExamFeeFormProps) {
  // SaaS-STAGE-2A (Task 7-b) — read-only editor when locked.
  const editLocked = locked === true
  // Remaining exam types = configured in the Examination module and NOT
  // yet in this structure's schedule.
  const remaining = availableTypes.filter(
    (t) => !existingTypes.includes(t.toLowerCase()),
  )
  const [selectedType, setSelectedType] = useState('')
  const [amount, setAmount] = useState<number | null>(null)
  const [plannedInstances, setPlannedInstances] = useState<number | null>(1)
  const [mandatory, setMandatory] = useState(true)

  // Keep the selection valid as the remaining list shrinks (row removed
  // elsewhere re-renders this form).
  useEffect(() => {
    if (selectedType && !remaining.includes(selectedType)) {
      setSelectedType('')
      setAmount(null)
      setPlannedInstances(1)
    }
  }, [remaining.join('|')])

  const isValid = selectedType.length > 0 && amount != null && amount > 0 && (plannedInstances ?? 1) >= 1

  const submit = () => {
    if (!isValid) return
    onAdd({
      examType: selectedType,
      amount: amount ?? 0,
      plannedInstances: Math.max(1, plannedInstances ?? 1),
      mandatory,
      active: true,
    })
    // Reset for the next pick — the form stays open so several exams can
    // be configured in a row.
    setSelectedType('')
    setAmount(null)
    setPlannedInstances(1)
    setMandatory(true)
  }

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      className="mt-2 overflow-hidden rounded-md border border-border"
    >
      <div className="p-3 space-y-2.5">
        <p className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-300 flex items-center gap-1.5">
          <Plus className="h-3 w-3" /> Add Examination Fee
        </p>

        {loadingTypes ? (
          <p className="text-[10px] text-muted-foreground py-2">Loading examinations from the Examination module…</p>
        ) : remaining.length === 0 ? (
          <div className="py-3 text-center">
            <p className="text-[11px] font-medium text-muted-foreground">No more examinations configured.</p>
            <p className="text-[10px] text-muted-foreground/70 mt-0.5 max-w-sm mx-auto">
              Every examination defined in the Examination module already has a fee in this structure.
              Configure new examinations there — this fee schedule references them, it never creates its own.
            </p>
            {onNavigate && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-[10px] gap-1 mt-2"
                onClick={() => onNavigate('exams')}
              >
                <Award className="h-3 w-3" /> Go to Examinations
              </Button>
            )}
          </div>
        ) : (
          <>
            {/* Selectable examination rows */}
            <div className="rounded-md border border-border/60 divide-y divide-border/40">
              {remaining.map((t) => {
                const selected = selectedType === t
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => {
                      setSelectedType(selected ? '' : t)
                      if (!selected) setAmount(null)
                    }}
                    disabled={editLocked}
                    className={cn(
                      'w-full flex items-center gap-2 px-2.5 py-2 text-left transition-colors',
                      selected ? 'bg-emerald-500/10' : 'hover:bg-muted/40',
                    )}
                    aria-pressed={selected}
                  >
                    <span className={cn(
                      'flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                      selected ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-border',
                    )}>
                      {selected && <Check className="h-3 w-3" />}
                    </span>
                    <span className="text-[11px] font-medium flex-1">{t}</span>
                    {selected && (
                      <span className="text-[9px] text-emerald-700 dark:text-emerald-300 font-medium">selected</span>
                    )}
                  </button>
                )
              })}
            </div>

            {selectedType && (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                <div>
                  <Label className="text-[10px]">Fee Amount (₹) <span className="text-rose-500">*</span></Label>
                  <MoneyInput
                    value={amount}
                    onChange={setAmount}
                    className="h-7 text-xs mt-0.5"
                    ariaLabel="Examination fee amount"
                    disabled={editLocked}
                  />
                </div>
                <div>
                  <Label className="text-[10px]">Planned / year</Label>
                  <MoneyInput
                    value={plannedInstances}
                    onChange={setPlannedInstances}
                    showPrefix={false}
                    className="h-7 text-xs mt-0.5"
                    min={1}
                    ariaLabel="Planned instances per year"
                    disabled={editLocked}
                  />
                </div>
                <div className="flex items-end pb-1">
                  <label className="flex items-center gap-1 text-[10px] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={mandatory}
                      onChange={(e) => setMandatory(e.target.checked)}
                      className="rounded"
                      disabled={editLocked}
                    />
                    Mandatory
                  </label>
                </div>
              </div>
            )}

            <p className="text-[10px] text-muted-foreground">
              Per-examination charge — billed once per conducted exam of this type. Fees reference the
              examination definitions in the Examination module; no duplicate exams are created here.
            </p>
            <div className="flex items-center justify-end gap-1">
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={onCancel}>
                <X className="h-3 w-3" /> Done
              </Button>
              <Button size="sm" className="h-7 text-xs gap-1 bg-emerald-600 hover:bg-emerald-700 text-white" onClick={submit} disabled={!isValid || editLocked}>
                <Check className="h-3 w-3" /> Add to Draft
              </Button>
            </div>
          </>
        )}
      </div>
    </motion.div>
  )
}

// ─── STRUCT-REV — RevisionPanel (PART 12/13/14/15) ──────────────────────
//
// Compact tracking panel for the live mid-session revision: what changed,
// how many of the affected students/guardians have acknowledged, the 60%
// threshold state, and the publish/cancel controls. Deliberately simple —
// no discussion, no voting features, just acknowledgement tracking.

function RevisionPanel({ revision, onPublish, onCancel }: {
  revision: StructureRevision
  onPublish: () => void
  onCancel: (reason: string) => void
}) {
  const [cancelOpen, setCancelOpen] = useState(false)
  const [cancelReason, setCancelReason] = useState('')
  const approved = Object.values(revision.responses).filter((v) => v === 'Approved').length
  const declined = Object.values(revision.responses).filter((v) => v === 'Declined').length
  const pending = revision.affectedStudentIds.length - approved - declined
  const pct = revision.affectedStudentIds.length > 0
    ? Math.round((approved / revision.affectedStudentIds.length) * 1000) / 10
    : 0
  const thresholdPct = Math.ceil(revision.affectedStudentIds.length * STRUCTURE_APPROVAL_THRESHOLD)
  const reached = revision.status === 'Threshold Reached'

  // What changed — head-level diffs shown exactly as guardians see them.
  const changes = revision.proposedHeads
    .map((h) => {
      const old = revision.previousHeads.find((x) => x.id === h.id)
      if (!old) return { name: h.name, old: null as number | null, new: h.amount }
      if (old.amount !== h.amount) return { name: h.name, old: old.amount, new: h.amount }
      return null
    })
    .filter(Boolean) as Array<{ name: string; old: number | null; new: number | null }>
  for (const old of revision.previousHeads) {
    if (!revision.proposedHeads.some((h) => h.id === old.id)) {
      changes.push({ name: old.name, old: old.amount, new: null })
    }
  }

  return (
    <div className={cn(
      'rounded-lg border p-3 space-y-2.5',
      reached ? 'border-emerald-500/30 bg-emerald-500/[0.06]' : 'border-amber-500/30 bg-amber-500/[0.06]',
    )}>
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="min-w-0">
          <p className={cn('text-xs font-semibold flex items-center gap-1.5', reached ? 'text-emerald-700 dark:text-emerald-300' : 'text-amber-700 dark:text-amber-300')}>
            <ShieldAlert className="h-3.5 w-3.5" />
            Proposed revision v{revision.toVersion} &middot; {revision.status}
          </p>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            {revision.className} &middot; {revision.academicYear} &middot; effective {revision.effectiveFrom} &middot; requested by {revision.requestedBy}
            {revision.reason ? ` — ${revision.reason}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {reached ? (
            <Button size="sm" className="h-7 text-[11px] gap-1 bg-emerald-600 hover:bg-emerald-700 text-white" onClick={onPublish}>
              <CheckCircle2 className="h-3 w-3" /> Publish New Version
            </Button>
          ) : (
            <span className="text-[10px] text-muted-foreground italic">published v{revision.fromVersion} keeps applying</span>
          )}
          <Button size="sm" variant="ghost" className="h-7 text-[11px] text-muted-foreground" onClick={() => setCancelOpen(true)}>
            Cancel
          </Button>
        </div>
      </div>

      {/* What the guardians were asked to approve (PART 13) */}
      {changes.length > 0 && (
        <div className="rounded-md bg-card border border-border/60 px-2.5 py-2 space-y-1">
          {changes.map((c) => (
            <div key={c.name} className="flex items-center justify-between text-[11px] tabular-nums">
              <span className="font-medium">{c.name}</span>
              <span className="text-muted-foreground">
                {formatINR(c.old ?? 0)}
                {c.new !== null ? (
                  <> → <span className={cn('font-semibold', (c.new ?? 0) > (c.old ?? 0) ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400')}>{formatINR(c.new)}</span></>
                ) : (
                  <span className="text-rose-600 dark:text-rose-400"> → removed</span>
                )}
              </span>
            </div>
          ))}
          <p className="text-[9px] text-muted-foreground border-t border-dashed border-border pt-1">
            Annual total {formatINR(revision.previousTotal, true)} → {formatINR(revision.proposedTotal, true)}
          </p>
        </div>
      )}

      {/* Acknowledgement progress (PART 12) */}
      <div>
        <div className="flex items-center justify-between text-[10px] mb-1">
          <span className="font-medium">
            {approved}/{revision.affectedStudentIds.length} approved &middot; {declined} declined &middot; {pending} pending
          </span>
          <span className={cn('font-bold tabular-nums', reached ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400')}>
            {pct}% {reached ? '· threshold reached' : `· 60% needed (${thresholdPct})`}
          </span>
        </div>
        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
          <div
            className={cn('h-full rounded-full transition-all', reached ? 'bg-emerald-500/80' : 'bg-amber-500/80')}
            style={{ width: `${Math.min(100, pct)}%` }}
          />
        </div>
      </div>

      {/* Cancel with reason */}
      {cancelOpen && (
        <div className="rounded-md border border-border bg-card px-2.5 py-2 space-y-1.5">
          <Input
            className="h-7 text-xs"
            placeholder="Reason for cancelling (recorded in audit)"
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
            autoFocus
          />
          <div className="flex items-center justify-end gap-1">
            <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => { setCancelOpen(false); setCancelReason('') }}>Keep revision</Button>
            <Button
              size="sm" variant="outline"
              className="h-6 text-[10px] text-rose-600 border-rose-500/30"
              onClick={() => { onCancel(cancelReason.trim() || 'No reason recorded'); setCancelOpen(false); setCancelReason('') }}
            >
              Confirm cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
