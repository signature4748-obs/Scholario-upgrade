'use client'

/**
 * TimetableModule — Principal's master scheduling workspace.
 *
 * Brief section 7 + 10 + 11 + 45: Four-tier state model:
 *
 *   VIEW: [ Export ] [ ✎ Edit ]
 *   EDIT (no changes): [ Export ] [ Cancel ] ● Editing
 *   EDIT (unsaved changes): [ Export ] [ Cancel ] [ Apply Changes ]
 *   PENDING PUBLISH (after Apply): [ Export ] [ Publish Update N ] [ ✎ Edit ]
 *   PUBLISHED: [ Export ] [ ✎ Edit ] (+ change indicators on affected slots)
 *
 * Draft state architecture (Brief section 27 + 49):
 *   - Edit mode mutates `draftSlots` (local React state, NOT the store)
 *   - Apply Changes: commits draftSlots → store, records changes, exits edit mode
 *   - Cancel: discards draftSlots (store unchanged), confirms if unsaved
 */
import { useState, useMemo, useEffect } from 'react'
import { Download, Pencil, Upload, AlertCircle, Check, CalendarClock } from 'lucide-react'
import { PageTransition } from '@/components/shared/ui'
import { Button } from '@/components/ui/button'
import {
  useTimetableStore,
  detectConflicts,
  countAllConflicts,
  getConflictedSlotIds,
  type DayType,
  type TimetableChange,
} from './timetable-store'
import { useTeacherRosterStore, type TeacherPick } from '@/lib/store/teacher-roster-store'
import { useAcademicConfigStore, type DbClassInfo } from '@/lib/academic-config/client'
import { buildInitialRows, type TimetableSlot as Slot } from './data'
import { serverRowsToSlots, type ServerSlot } from '@/lib/timetable/server-mapping'
import type { TimetableRow } from './schedule-grid'
import {
  recomputeRowTimes,
  reanchorTimelineAtRow,
  renumberVisiblePeriods,
  defaultDurationForRow,
} from './time-engine'
import { toast } from 'sonner'
import { OverviewCards } from './overview-cards'
import { FiltersBar } from './filters-bar'
import { ScheduleGrid } from './schedule-grid'
import { SlotEditorDialog, type MinimalSlotForm } from './slot-editor-dialog'
import { PublishDialog } from './publish-dialog'
import { AutoTimetableDialog } from './auto-timetable-dialog'
import { ConfirmDialog } from '../shared/confirm-dialog'
import { exportTimetablePDF } from './timetable-pdf'
import { ExportPreview } from './export-preview'
import { Trash2, AlertTriangle } from 'lucide-react'

export function TimetableModule() {
  // ── Store subscriptions ──
  const slots = useTimetableStore((s) => s.slots)
  const pendingChanges = useTimetableStore((s) => s.pendingChanges)
  const publications = useTimetableStore((s) => s.publications)
  const addSlotAction = useTimetableStore((s) => s.addSlot)
  const updateSlotAction = useTimetableStore((s) => s.updateSlot)
  const removeSlotAction = useTimetableStore((s) => s.removeSlot)
  const recordChange = useTimetableStore((s) => s.recordChange)
  const removePendingChange = useTimetableStore((s) => s.removePendingChange)
  const cancelAllPendingChanges = useTimetableStore((s) => s.cancelAllPendingChanges)
  const publish = useTimetableStore((s) => s.publish)
  const hydrateFromServer = useTimetableStore((s) => s.hydrateFromServer)

  // ── SERVER HYDRATION (one universe for every role) ──
  // On mount, replace the store contents with the server's Timetable rows —
  // the exact truth students and teachers read — AND resolve the REAL
  // teacher roster (GET /api/teachers) so slot ids, pickers, filters and
  // conflict labels all operate on teachers who exist at the school. The
  // principal then edits and publishes against the real school schedule;
  // publishes sync back to the server (handlePublish), closing the loop.
  //
  // Tri-state lineage (REAL RECORDS ONLY — the mock seed is gone):
  //   'server'  — fetch OK, school has rows   → hydrated (the normal case)
  //   'empty'   — fetch OK, school has NO rows → store CLEARED, honest
  //               empty state; the principal can build the first schedule
  //   'offline' — fetch FAILED → keep the last-known-good local snapshot,
  //               but PUBLISH IS BLOCKED (never write a stale/unhydrated
  //               snapshot over the server's truth)
  const [serverSynced, setServerSynced] = useState<null | 'server' | 'empty' | 'offline'>(null) // null = loading
  const [rosterSource, setRosterSource] = useState<'mock' | 'server'>('mock')
  const ensureRoster = useTeacherRosterStore((s) => s.ensure)
  const roster = useTeacherRosterStore((s) => s.teachers)
  // ── PRINCIPAL CONFIG (single source of truth) ──
  // The academic configuration (ACTIVE ClassSubjectAssignment per class +
  // class homerooms) drives the slot editor's subject picker and every
  // derived room — NEVER a hardcoded subject list (spec §C/§D: subjects a
  // class teaches come from the Principal's configuration only).
  const academicConfig = useAcademicConfigStore((s) => s.config)
  const fetchAcademic = useAcademicConfigStore((s) => s.fetch)
  useEffect(() => {
    void fetchAcademic()
  }, [fetchAcademic])
  // className (as slots carry it, e.g. "Grade 9 - A") → configured subjects.
  // Keyed by BOTH the raw class name and the labelOf-style variant so any
  // naming convention resolves.
  const subjectsByClass = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const c of (academicConfig?.classes ?? []) as DbClassInfo[]) {
      const names = c.subjects.map((s) => s.name)
      m.set(c.name, names)
      if (c.section && !new RegExp(`[-–\\s]${c.section}$`, 'i').test(c.name)) {
        m.set(`${c.name} - ${c.section}`, names)
      }
    }
    return m
  }, [academicConfig])
  // className → homeroom (the room a class's periods meet in, by default).
  const homeroomByClass = useMemo(() => {
    const m = new Map<string, string>()
    for (const c of (academicConfig?.classes ?? []) as DbClassInfo[]) {
      if (c.room) {
        m.set(c.name, c.room)
        if (c.section && !new RegExp(`[-–\\s]${c.section}$`, 'i').test(c.name)) {
          m.set(`${c.name} - ${c.section}`, c.room)
        }
      }
    }
    return m
  }, [academicConfig])
  /** Subjects available to schedule for a class: the Principal's ACTIVE
   *  configuration first; offline/absent config falls back to the subjects
   *  already on this class's published slots (real data, never mock). */
  const subjectOptionsFor = useMemo(
    () =>
      (className: string): { id: string; label: string; meta?: string }[] => {
        const configured = subjectsByClass.get(className)
        if (configured && configured.length > 0) {
          return configured.map((name) => ({ id: name, label: name }))
        }
        const fromSlots = [...new Set(slots.filter((s) => s.className === className).map((s) => s.subject))]
        return fromSlots.map((name) => ({ id: name, label: name }))
      },
    [subjectsByClass, slots],
  )
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        // Parallel: timetable rows + teacher roster — hydration uses the
        // post-sync roster so teacher ids are consistent from the start.
        await Promise.all([
          fetch('/api/timetable', { cache: 'no-store', credentials: 'same-origin' }).then(async (res) => {
            const json = (await res.json().catch(() => null)) as { ok?: unknown; data?: ServerSlot[] } | null
            if (!res.ok || !json || json.ok !== true) throw new Error('sync failed')
            return Array.isArray(json.data) ? json.data : []
          }),
          ensureRoster(),
        ]).then(([rows]) => {
          const rosterNow = useTeacherRosterStore.getState().teachers
          if (!alive) return
          setRosterSource(useTeacherRosterStore.getState().source)
          if (rows.length > 0) {
            // Teachers not on the roster get STABLE synthetic ids (one per
            // distinct name) — never '' — so conflict detection and faculty
            // filtering see them as the distinct people they are.
            const rosterByName = new Map(rosterNow.map((t) => [t.name, t.id]))
            const syntheticByTeacher = new Map<string, string>()
            const teacherIdFor = (name: string) => {
              const known = rosterByName.get(name)
              if (known) return known
              let syn = syntheticByTeacher.get(name)
              if (!syn) {
                syn = `srv-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`
                syntheticByTeacher.set(name, syn)
              }
              return syn
            }
            const mapped = serverRowsToSlots(rows).map((s) => ({
              ...s,
              teacherId: teacherIdFor(s.teacherName),
            }))
            hydrateFromServer(mapped)
            setServerSynced('server')
          } else {
            // Fetch OK but the school has NO timetable rows yet — clear the
            // store (emptyOk): an honest empty schedule, never a demo seed.
            hydrateFromServer([], { emptyOk: true })
            setServerSynced('empty')
          }
        })
      } catch {
        if (alive) setServerSynced('offline') // fetch failed — keep the local snapshot; publish stays blocked
      }
    })()
    return () => {
      alive = false
    }
  }, [hydrateFromServer, ensureRoster])

  // ── Draft state (local — only mutated during edit mode) ──
  const [draftSlots, setDraftSlots] = useState<Slot[]>(slots)
  const [draftRows, setDraftRows] = useState<TimetableRow[]>(buildInitialRows())
  const [editMode, setEditMode] = useState(false)
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)

  // ── UI state ──
  // Class options are derived from the live slots (server-hydrated) — never
  // the static seed list — so 'all' is the honest default after hydration.
  const [selectedClass, setSelectedClass] = useState<string>('all')
  const [selectedTeacher, setSelectedTeacher] = useState<string>('all')
  const [selectedRoom, setSelectedRoom] = useState<string>('all')
  const [selectedDay, setSelectedDay] = useState<DayType>('Monday')
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingSlot, setEditingSlot] = useState<{ id: string; subject: string; teacherId: string } | null>(null)
  const [editorContext, setEditorContext] = useState({ day: 'Monday' as DayType, period: 1, periodName: 'Period 1', time: '08:30 AM - 09:15 AM', className: 'Class 2-A', room: 'Room 102' })
  const [minimalForm, setMinimalForm] = useState<MinimalSlotForm>({ subject: '', teacherId: '' })
  const [removeTarget, setRemoveTarget] = useState<Slot | null>(null)
  const [discardOpen, setDiscardOpen] = useState(false)
  const [publishOpen, setPublishOpen] = useState(false)
  const [autoOpen, setAutoOpen] = useState(false)
  const [exportPreview, setExportPreview] = useState<
    | { html: string; title: string; subtitle: string; orientation: 'portrait' | 'landscape' }
    | null
  >(null)

  // Sync draft when entering edit mode (Brief section 27)
  useEffect(() => {
    if (editMode) {
      setDraftSlots(slots)
      setDraftRows(buildInitialRows())
      setHasUnsavedChanges(false)
    }
  }, [editMode, slots])

  // ── Derived state ──
  // In edit mode, display draftSlots; otherwise display store slots
  const displaySlots = editMode ? draftSlots : slots

  const conflictInfo = useMemo(
    () => {
      // For the editor: check against draftSlots (not the store)
      if (!editorOpen) return { hasConflict: false, teacherConflict: undefined, roomConflict: undefined, classConflict: undefined }
      const ctx = editorContext
      return detectConflicts(draftSlots, {
        day: ctx.day,
        period: ctx.period,
        teacherId: minimalForm.teacherId,
        room: ctx.room,
        className: ctx.className,
      }, editingSlot?.id)
    },
    [draftSlots, editorOpen, editorContext, minimalForm, editingSlot]
  )

  const filteredSlots = useMemo(() => {
    return displaySlots.filter((s) => {
      const matchClass = selectedClass === 'all' || s.className === selectedClass
      const matchTeacher = selectedTeacher === 'all' || s.teacherId === selectedTeacher
      const matchRoom = selectedRoom === 'all' || s.room === selectedRoom
      return matchClass && matchTeacher && matchRoom
    })
  }, [displaySlots, selectedClass, selectedTeacher, selectedRoom])

  const globalConflictCount = useMemo(() => countAllConflicts(displaySlots), [displaySlots])
  const conflictedSlotIds = useMemo(() => getConflictedSlotIds(displaySlots), [displaySlots])

  // ── Dynamic class options — PRINCIPAL CONFIGURATION first (spec §C:
  //    classes come from the school's records, never a hardcoded list):
  //    live schedule classes ∪ the academic config's classes (Grade 6–12).
  //    A school with no classes at all sees an honest empty picker — the
  //    timetable editor never invents classes.
  const classOptions = useMemo(() => {
    const present = new Set(slots.map((s) => s.className).filter(Boolean))
    for (const c of (academicConfig?.classes ?? []) as DbClassInfo[]) {
      if (c.section && !new RegExp(`[-–\\s]${c.section}$`, 'i').test(c.name)) {
        present.add(`${c.name} - ${c.section}`)
      } else {
        present.add(c.name)
      }
    }
    return [...present].sort()
  }, [slots, academicConfig])

  // Rooms likewise derive from REAL data only: rooms on the live schedule ∪
  // class homerooms from the academic configuration.
  const roomOptions = useMemo(() => {
    const present = new Set(slots.map((s) => s.room).filter(Boolean))
    for (const r of homeroomByClass.values()) present.add(r)
    return [...present].sort()
  }, [slots, homeroomByClass])
  const hasPendingPublish = pendingChanges.length > 0

  // ── Handlers ──
  const handleEnterEdit = () => {
    setDraftSlots(slots)
    setDraftRows(buildInitialRows())
    setHasUnsavedChanges(false)
    setEditMode(true)
  }

  const handleExitEdit = () => {
    if (hasUnsavedChanges) {
      setDiscardOpen(true)
    } else {
      setEditMode(false)
    }
  }

  const handleDiscard = () => {
    setDraftSlots(slots)
    setDraftRows(buildInitialRows())
    setHasUnsavedChanges(false)
    setEditMode(false)
    setDiscardOpen(false)
    setEditorOpen(false)
    setEditingSlot(null)
  }

  // ── Row management handlers (Brief section 4-10 + 19) ──
  // All structural mutations funnel through recomputeRowTimes so the
  // timeline is always chronologically valid (Brief 1.7 + 1.8).
  const handleInsertRow = (afterRowNumber: number, type: 'period' | 'short_break' | 'lunch_break') => {
    setDraftRows((prev) => {
      const insertIdx = prev.findIndex((r) => r.number === afterRowNumber) + 1
      const isBreak = type !== 'period'
      const breakType = type === 'short_break' ? 'short' : type === 'lunch_break' ? 'lunch' : undefined
      const newRow: TimetableRow = {
        number: Date.now(), // stable internal id (NOT visible period number)
        name: isBreak ? (type === 'short_break' ? 'Short Break' : 'Lunch Break') : 'Period',
        time: '', // derived below
        isBreak,
        breakType,
        durationMin: defaultDurationForRow(isBreak, breakType),
      }
      const next = [...prev]
      next.splice(insertIdx, 0, newRow)
      // Brief 2: renumber visible period names
      const renumbered = renumberVisiblePeriods(next)
      // Brief 1.7: recompute all times from the anchor (first row's start)
      return recomputeRowTimes(renumbered)
    })
    setHasUnsavedChanges(true)
  }

  const handleDeleteRow = (rowNumber: number) => {
    // Brief 2 + 1.7: When a structural row is deleted, slots that referenced
    // its `.number` as their period are orphaned (no row to render in).
    // Remove them from the draft so the data stays consistent with the UI.
    setDraftSlots((prevSlots) => prevSlots.filter((s) => s.period !== rowNumber))
    setDraftRows((prev) => {
      const next = prev.filter((r) => r.number !== rowNumber)
      const renumbered = renumberVisiblePeriods(next)
      return recomputeRowTimes(renumbered)
    })
    setHasUnsavedChanges(true)
  }

  // Brief 1.7 + 1.8: When the user edits one row's start/end via TimeEditor,
  // derive the new durationMin for that row and CASCADE the timeline forward.
  // Rows before the edited row are untouched (still valid). Rows after re-anchor
  // from the edited row's new end. No stale times, no overlaps, no backwards time.
  const handleEditRowTime = (rowNumber: number, newTime: string) => {
    setDraftRows((prev) => reanchorTimelineAtRow(prev, rowNumber, newTime))
    setHasUnsavedChanges(true)
  }

  const handleApplyChanges = () => {
    // Commit draftSlots to the store + record changes
    // Compare draftSlots with slots to detect what changed
    const changes: Omit<TimetableChange, 'id' | 'publishedAt'>[] = []

    // Detect added/modified slots
    for (const draftSlot of draftSlots) {
      const original = slots.find((s) => s.id === draftSlot.id)
      if (!original) {
        // New slot
        changes.push({
          slotId: draftSlot.id,
          type: 'slot_added',
          summary: `New period: ${draftSlot.subject}`,
          context: `${draftSlot.className} · ${draftSlot.day} Period ${draftSlot.period}`,
          changeLabel: `+ ${draftSlot.subject}`,
        })
      } else {
        // Check for field changes
        const teacherObj = roster.find((t: TeacherPick) => t.id === draftSlot.teacherId)
        const newTeacherName = teacherObj?.name || draftSlot.teacherName
        if (original.teacherId !== draftSlot.teacherId) {
          const _oldTeacher = roster.find((t: TeacherPick) => t.id === original.teacherId)
          changes.push({
            slotId: draftSlot.id, type: 'teacher_changed', summary: 'Teacher changed',
            context: `${draftSlot.className} · Period ${draftSlot.period}`,
            oldValue: original.teacherName, newValue: newTeacherName,
            changeLabel: `${original.teacherName} → ${newTeacherName}`,
          })
        }
        if (original.subject !== draftSlot.subject) {
          changes.push({
            slotId: draftSlot.id, type: 'subject_changed', summary: 'Subject changed',
            context: `${draftSlot.className} · Period ${draftSlot.period}`,
            oldValue: original.subject, newValue: draftSlot.subject,
            changeLabel: `${original.subject} → ${draftSlot.subject}`,
          })
        }
        if (original.room !== draftSlot.room) {
          changes.push({
            slotId: draftSlot.id, type: 'room_changed', summary: 'Room changed',
            context: `${draftSlot.className} · Period ${draftSlot.period}`,
            oldValue: original.room, newValue: draftSlot.room,
            changeLabel: `${original.room} → ${draftSlot.room}`,
          })
        }
        if (original.period !== draftSlot.period) {
          changes.push({
            slotId: draftSlot.id, type: 'period_changed', summary: 'Period changed',
            context: draftSlot.className,
            oldValue: `P${original.period}`, newValue: `P${draftSlot.period}`,
            changeLabel: `P${original.period} → P${draftSlot.period}`,
          })
        }
      }
    }

    // Detect removed slots
    for (const original of slots) {
      if (!draftSlots.find((s) => s.id === original.id)) {
        changes.push({
          slotId: original.id, type: 'slot_removed', summary: `Period removed: ${original.subject}`,
          context: `${original.className} · ${original.day} Period ${original.period}`,
          changeLabel: `− ${original.subject}`,
        })
      }
    }

    // Commit to store: replace slots with draftSlots
    // We do this by removing all old slots and adding all draft slots
    // But since we can't replace all at once, we'll use a batch approach
    for (const oldSlot of slots) {
      if (!draftSlots.find((s) => s.id === oldSlot.id)) {
        removeSlotAction(oldSlot.id)
      }
    }
    for (const draftSlot of draftSlots) {
      const original = slots.find((s) => s.id === draftSlot.id)
      if (!original) {
        addSlotAction(draftSlot)
      } else if (JSON.stringify(original) !== JSON.stringify(draftSlot)) {
        updateSlotAction(draftSlot.id, draftSlot)
      }
    }

    // Record changes
    for (const change of changes) {
      recordChange(change)
    }

    setEditMode(false)
    setHasUnsavedChanges(false)
    toast.success('Changes applied', {
      description: changes.length > 0 ? `${changes.length} change${changes.length === 1 ? '' : 's'} ready to publish` : undefined,
    })
  }

  const handleOpenAssign = (day: DayType, period: number, className: string) => {
    // Brief 15: Look up time from the canonical draftRows, NOT stale PERIODS.
    const row = draftRows.find((r) => r.number === period)
    // Room = the class's HOMEROOM from the server configuration (the class
    // stays put, teachers move). Falls back to any slot of the class.
    const existingClassSlot = draftSlots.find((s) => s.className === className)
    const room = homeroomByClass.get(className) || existingClassSlot?.room || '—'
    setEditorContext({
      day, period,
      periodName: row?.name || `Period ${period}`,
      time: row?.time || '08:30 AM - 09:15 AM',
      className, room,
    })
    setEditingSlot(null)
    setMinimalForm({ subject: '', teacherId: '' })
    setEditorOpen(true)
  }

  const handleEditSlot = (slot: Slot) => {
    // Brief 15: Use canonical draftRows time — slot.time may be stale after row mutations.
    const row = draftRows.find((r) => r.number === slot.period)
    setEditorContext({
      day: slot.day, period: slot.period,
      periodName: row?.name || `Period ${slot.period}`,
      time: row?.time || slot.time, className: slot.className, room: slot.room,
    })
    setEditingSlot({ id: slot.id, subject: slot.subject, teacherId: slot.teacherId })
    setMinimalForm({ subject: slot.subject, teacherId: slot.teacherId })
    setEditorOpen(true)
  }

  const handleSaveSlot = () => {
    if (conflictInfo.hasConflict) return

    const teacherObj = roster.find((t) => t.id === minimalForm.teacherId)
    const teacherName = teacherObj?.name || 'Assigned Faculty'
    // Brief 15: Canonical time from draftRows (not stale PERIODS).
    const row = draftRows.find((r) => r.number === editorContext.period)

    if (editingSlot) {
      // Update existing slot in draft
      setDraftSlots((prev) => prev.map((s) =>
        s.id === editingSlot.id
          ? { ...s, subject: minimalForm.subject, teacherId: minimalForm.teacherId, teacherName, time: row?.time || s.time }
          : s
      ))
    } else {
      // Add new slot to draft
      const newSlot: Slot = {
        id: `tt-${Date.now().toString().slice(-6)}`,
        day: editorContext.day,
        period: editorContext.period,
        time: row?.time || editorContext.time,
        className: editorContext.className,
        subject: minimalForm.subject,
        teacherId: minimalForm.teacherId,
        teacherName,
        room: editorContext.room,
        type: 'Lecture',
      }
      setDraftSlots((prev) => [...prev, newSlot])
    }

    setHasUnsavedChanges(true)
    setEditorOpen(false)
  }

  const handleRemoveSlot = () => {
    if (!removeTarget) return
    setDraftSlots((prev) => prev.filter((s) => s.id !== removeTarget.id))
    setHasUnsavedChanges(true)
    setRemoveTarget(null)
  }

  const handlePublish = async () => {
    if (globalConflictCount > 0) {
      toast.error('Resolve conflicts before publishing')
      return
    }
    // PUBLISH GUARD (REAL RECORDS ONLY): publishing is only safe when the
    // working snapshot came from the server ('server') or the school is
    // genuinely empty ('empty' — first schedule). An offline/unhydrated
    // snapshot must never replace the server's rows.
    if (serverSynced !== 'server' && serverSynced !== 'empty') {
      toast.error('Cannot publish — school records did not load', {
        description:
          serverSynced === 'offline'
            ? 'The server was unreachable when this page loaded. Reload the module, then publish again.'
            : 'Still syncing with school records — try again in a moment.',
      })
      return
    }
    const version = publish('Dr. Ananya Iyer')
    if (!version) return
    setPublishOpen(false)

    // SERVER SYNC — the published snapshot becomes the school's Timetable
    // rows, which students and teachers read on their next module load.
    // Local publish already succeeded; the sync failure path keeps the
    // change local and tells the principal honestly.
    try {
      const res = await fetch('/api/timetable/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          slots: useTimetableStore.getState().publishedSlots.map((s) => ({
            day: s.day,
            period: s.period,
            time: s.time,
            className: s.className,
            subject: s.subject,
            teacherName: s.teacherName,
            room: s.room,
          })),
        }),
      })
      const json = (await res.json().catch(() => null)) as
        | { ok?: unknown; error?: unknown; data?: { rowsWritten: number; classes: number } }
        | null
      if (!res.ok || !json || json.ok !== true) {
        throw new Error(typeof json?.error === 'string' ? json.error : `HTTP ${res.status}`)
      }
      toast.success('Timetable published', {
        description:
          `${version.changeCount} change${version.changeCount === 1 ? '' : 's'} shared with affected users · ` +
          `${json.data?.rowsWritten ?? 0} server slots across ${json.data?.classes ?? 0} classes`,
      })
    } catch (e) {
      toast.warning('Published locally — server sync failed', {
        description:
          (e instanceof Error ? e.message : 'Sync failed') +
          '. Students will see the previous schedule until you retry the publish.',
      })
    }
  }

  // Brief section 14 + 15: Exports always use the CURRENT validated state —
  // draftSlots/draftRows in edit mode, store slots/PERIODS in view mode.
  // Time + Preview + PDF share ONE timeline source (Brief 15).
  const activeRows = editMode ? draftRows : buildInitialRows()
  const activeSlots = editMode ? draftSlots : slots

  // Brief PART 2: Simplify export — master timetable only (no class/teacher
  // dropdown). Removes unnecessary scope-selection UI.
  const handleExport = () => {
    const { html, title, subtitle, orientation } = exportTimetablePDF(
      activeSlots, activeRows, selectedDay, 'all', classOptions
    )
    setExportPreview({ html, title, subtitle, orientation })
  }

  return (
    <PageTransition className="space-y-5">
      {/* Brief PART 1: NO duplicate page title — topbar already shows "Timetable".
          Content begins directly with the subtitle + controls. */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
          <p className="text-xs text-muted-foreground">School-wide master schedule</p>
          {/* Data lineage — honest signal of the one data universe */}
          {serverSynced === 'server' && (
            <span
              className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/25 bg-emerald-500/[0.07] px-2 py-0.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400"
              title="Loaded from the school's server records — the same data students and teachers see"
            >
              <span className="relative flex h-1.5 w-1.5" aria-hidden>
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
              </span>
              Synced with school records
            </span>
          )}
          {/* Faculty roster lineage — real Teacher rows vs demo fallback */}
          {rosterSource === 'server' && (
            <span
              className="inline-flex items-center gap-1.5 rounded-full border border-teal-500/25 bg-teal-500/[0.07] px-2 py-0.5 text-[10px] font-semibold text-teal-600 dark:text-teal-400"
              title="The teacher picker, faculty filter and auto-scheduler are using the school's real teacher records"
            >
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-teal-500" aria-hidden />
              Faculty roster · {roster.length} live
            </span>
          )}
          {serverSynced === 'empty' && (
            <span
              className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/25 bg-amber-500/[0.07] px-2 py-0.5 text-[10px] font-semibold text-amber-600 dark:text-amber-400"
              title="The school has no timetable on record yet — enter Edit mode to build the first schedule"
            >
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden />
              No timetable on record
            </span>
          )}
          {serverSynced === 'offline' && (
            <span
              className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/25 bg-amber-500/[0.07] px-2 py-0.5 text-[10px] font-semibold text-amber-600 dark:text-amber-400"
              title="Server records were unreachable — showing the local snapshot. Publishing is disabled until the module reloads with a live connection."
            >
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden />
              Local snapshot (server unreachable)
            </span>
          )}
          {serverSynced === null && (
            <span
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[10px] font-semibold text-muted-foreground"
              aria-live="polite"
            >
              <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-muted-foreground/60" aria-hidden />
              Syncing…
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Brief PART 2: Single Export action — master timetable only */}
          <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" onClick={handleExport}>
            <Download className="h-3.5 w-3.5" /> Export
          </Button>

          {editMode ? (
            <>
              {hasUnsavedChanges ? (
                <>
                  <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={handleExitEdit}>Cancel</Button>
                  <Button
                    size="sm"
                    className="h-8 text-xs gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
                    onClick={handleApplyChanges}
                    disabled={globalConflictCount > 0}
                  >
                    <Check className="h-3.5 w-3.5" /> Apply Changes
                  </Button>
                </>
              ) : (
                <>
                  <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={handleExitEdit}>Cancel</Button>
                  <span className="text-[10px] font-medium text-emerald-600 dark:text-emerald-400 flex items-center gap-1 px-1">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    Editing
                  </span>
                  {/* Auto Timetable — only in edit mode (Brief section 29) */}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 text-muted-foreground hover:text-primary"
                    onClick={() => setAutoOpen(true)}
                    title="Auto timetable"
                    aria-label="Auto timetable"
                  >
                    <CalendarClock className="h-4 w-4" />
                  </Button>
                </>
              )}
              {globalConflictCount > 0 && hasUnsavedChanges && (
                <span className="text-[10px] text-rose-600 flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" />
                  {globalConflictCount} conflict{globalConflictCount === 1 ? '' : 's'}
                </span>
              )}
            </>
          ) : hasPendingPublish ? (
            <>
              <Button
                size="sm"
                className="h-8 text-xs gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
                onClick={() => setPublishOpen(true)}
                disabled={globalConflictCount > 0}
              >
                <Upload className="h-3.5 w-3.5" /> Publish Update
                {pendingChanges.length > 0 && (
                  <span className="ml-0.5 px-1.5 py-0 rounded-full bg-white/20 text-[9px] font-bold">
                    {pendingChanges.length}
                  </span>
                )}
              </Button>
              <Button variant="ghost" size="sm" className="h-8 text-xs gap-1.5" onClick={handleEnterEdit}>
                <Pencil className="h-3.5 w-3.5" /> Edit
              </Button>
            </>
          ) : (
            <Button variant="ghost" size="sm" className="h-8 text-xs gap-1.5" onClick={handleEnterEdit}>
              <Pencil className="h-3.5 w-3.5" /> Edit
            </Button>
          )}
        </div>
      </div>

      {/* Honest empty state — a school with no timetable rows yet (REAL
          RECORDS ONLY: never a demo schedule). The ladder still renders as
          an editing scaffold once the principal enters Edit mode. */}
      {serverSynced === 'empty' && !editMode && slots.length === 0 && (
        <div className="rounded-lg border border-dashed border-border/70 bg-muted/20 p-6 text-center">
          <CalendarClock className="mx-auto h-6 w-6 text-muted-foreground/60" aria-hidden />
          <p className="mt-2 text-sm font-semibold text-foreground">No timetable on record</p>
          <p className="mt-1 text-xs text-muted-foreground max-w-md mx-auto">
            This school has no published schedule yet. Classes and subjects come from your
            configuration in <span className="font-medium text-foreground">Students &amp; Classes</span> —
            enter Edit mode to build the first schedule, then publish it to every role.
          </p>
        </div>
      )}

      {/* Pending publish banner */}
      {hasPendingPublish && !editMode && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-2.5 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-xs font-medium text-foreground">
              {pendingChanges.length} timetable change{pendingChanges.length === 1 ? '' : 's'} ready to publish
            </span>
          </div>
        </div>
      )}

      <OverviewCards slots={displaySlots} conflictCount={globalConflictCount} />

      <FiltersBar
        selectedClass={selectedClass}
        setSelectedClass={setSelectedClass}
        selectedTeacher={selectedTeacher}
        setSelectedTeacher={setSelectedTeacher}
        selectedRoom={selectedRoom}
        setSelectedRoom={setSelectedRoom}
        selectedDay={selectedDay}
        setSelectedDay={setSelectedDay}
        classes={classOptions}
        rooms={roomOptions}
      />

      <ScheduleGrid
        selectedDay={selectedDay}
        selectedClass={selectedClass}
        filteredSlots={filteredSlots}
        editMode={editMode}
        publications={publications}
        conflictedSlotIds={conflictedSlotIds}
        rows={draftRows}
        classes={classOptions}
        onEditSlot={handleEditSlot}
        onDuplicateSlot={(slot) => {
          // Duplicate in draft
          const newSlot = { ...slot, id: `tt-${Date.now().toString().slice(-6)}` }
          setDraftSlots((prev) => [...prev, newSlot])
          setHasUnsavedChanges(true)
          toast.success('Slot duplicated')
        }}
        onRemoveSlot={(slot) => setRemoveTarget(slot)}
        onAssignPeriod={(day, period, className) => {
          // Use the EXACT clicked cell's className (Brief section 17-21)
          handleOpenAssign(day, period, className)
        }}
        onInsertRow={handleInsertRow}
        onDeleteRow={handleDeleteRow}
        onEditRowTime={handleEditRowTime}
      />

      {/* Minimal slot editor */}
      <SlotEditorDialog
        open={editorOpen}
        onOpenChange={setEditorOpen}
        context={editorContext}
        editingSlot={editingSlot}
        form={minimalForm}
        setForm={setMinimalForm}
        conflictInfo={conflictInfo}
        subjectOptions={subjectOptionsFor(editorContext.className)}
        subjectsConfigured={(subjectsByClass.get(editorContext.className)?.length ?? 0) > 0}
        onSave={handleSaveSlot}
      />

      {/* Remove confirmation */}
      <ConfirmDialog
        open={!!removeTarget}
        onOpenChange={(o) => !o && setRemoveTarget(null)}
        title="Remove this period?"
        description={`${removeTarget?.subject} · ${removeTarget?.className} · ${removeTarget?.day} Period ${removeTarget?.period}.`}
        tone="destructive"
        icon={Trash2}
        confirmLabel="Remove"
        onConfirm={handleRemoveSlot}
      />

      {/* Discard changes confirmation */}
      <ConfirmDialog
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        title="Discard changes?"
        description="Your unsaved timetable edits will be lost."
        tone="destructive"
        icon={AlertTriangle}
        confirmLabel="Discard"
        onConfirm={handleDiscard}
      />

      {/* Publish confirmation */}
      <PublishDialog
        open={publishOpen}
        onOpenChange={setPublishOpen}
        changes={pendingChanges}
        conflictCount={globalConflictCount}
        onPublish={handlePublish}
        onRemoveChange={removePendingChange}
        onCancelAll={() => {
          cancelAllPendingChanges()
          setPublishOpen(false)
          toast.success('All changes cancelled — timetable restored to last published state')
        }}
      />

      {/* Auto Timetable */}
      <AutoTimetableDialog
        open={autoOpen}
        onOpenChange={setAutoOpen}
        existingSlots={draftSlots}
        classes={classOptions}
        subjectsByClass={subjectsByClass}
        homeroomByClass={homeroomByClass}
        onGenerate={(generated, generatedRows) => {
          // Scoped-merge semantics: the generator replaces ONLY the classes
          // it generated for; every other class's slots stay in the draft.
          // (A single-class generate must never silently wipe the rest of
          // the school — Apply would then publish a one-class timetable.)
          const generatedClasses = new Set(generated.map((s) => s.className))
          const kept = draftSlots.filter((s) => !generatedClasses.has(s.className))
          setDraftSlots([...kept, ...generated])
          setDraftRows(generatedRows)
          setHasUnsavedChanges(true)
        }}
      />

      {/* Export preview — full-screen overlay with Back + Download PDF */}
      <ExportPreview
        preview={exportPreview}
        onClose={() => setExportPreview(null)}
      />
    </PageTransition>
  )
}

export default TimetableModule
