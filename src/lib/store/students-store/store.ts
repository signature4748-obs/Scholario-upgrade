'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { StudentPosition, StudentsState, StudentStatus } from './types'
import { POSITION_DEFS, filterActivePositions } from '@/lib/student-positions'
import { getActiveAcademicSessionId } from '@/lib/academic-session'
import { HOUSE_DEFS, SEED_SUBJECTS } from './constants'
import { SS, SC } from './seed-data'
import { SUBJECTS_BY_LEVEL } from './constants'
import { idForCustomSubject, codeForName, type SubjectDef } from '@/lib/mock/academic'
import {
  migrateLegacyScopedStore, createTenantScopedStorage,
} from '@/lib/tenant/tenant-storage'
import { DEFAULT_TENANT_ID } from '@/lib/tenant/schools'

migrateLegacyScopedStore('scholario-students-v1', DEFAULT_TENANT_ID)

/**
 * SEED_SESSION_ID — the academic session the two DEMO seed rows below
 * (POS-SEED-1/2) were awarded in (the demo school's DB session,
 * AY 2026–2027). This is SEED-DATA scoping, NOT session resolution —
 * live resolution is server-first and nullable (lib/academic-session.ts,
 * PHASE 7.5-D: no hardcoded fallback year).
 */
const SEED_SESSION_ID = '2026-2027'

/**
 * Helper — keep a ClassRecord's legacy `subjects: string[]` array in sync
 * with its canonical `subjectIds: string[]` + the academic subject registry.
 * Spec §28: id is the source of truth; name is a derived display field.
 */
function syncSubjectNames(
  cls: import('./types').ClassRecord,
  registry: SubjectDef[],
): import('./types').ClassRecord {
  const subjects = cls.subjectIds
    .map((id) => registry.find((s) => s.id === id)?.name)
    .filter((n): n is string => Boolean(n))
  return { ...cls, subjects }
}

/**
 * Spec §3 (Students & Classes production pass) — no orphan leadership
 * assignments. Ends every LIVE position of a student that fails the `keep`
 * predicate (history preserved: active→false + endedOn/endedByName). Used
 * when a student leaves a class/section (transfer/promotion) or is archived
 * — a position is only ever valid inside the class · section it was awarded
 * in. Returns the next positions array (same reference when nothing
 * changed) plus how many were ended, so callers can add an honest timeline
 * note without extra scans.
 */
function endOrphanPositions(
  positions: StudentPosition[],
  studentId: string,
  keep: (p: StudentPosition) => boolean,
  byName: string,
  now = new Date().toISOString(),
): { positions: StudentPosition[]; ended: StudentPosition[] } {
  const sessionId = getActiveAcademicSessionId()
  const ended: StudentPosition[] = []
  let changed = false
  const next = positions.map((p) => {
    // A position from an earlier session is already history (RB-1) — only
    // live-session records of THIS student can become orphans.
    if (p.studentId !== studentId || !p.active || p.sessionId !== sessionId || keep(p)) return p
    changed = true
    ended.push(p)
    return { ...p, active: false, endedOn: now, endedByName: byName }
  })
  return { positions: changed ? next : positions, ended }
}

export const useStudentsStore = create<StudentsState>()(
  persist(
    (set, get) => ({
  students: SS,
  classes: SC,
  houses: HOUSE_DEFS,
  promotions: [],
  transfers: [],
  // Class Captain / Monitor positions (RB-1: SESSION-SCOPED — every record
  // carries the academic session it was awarded in). Seeded with:
  //   · POS-SEED-1 — a Class 9-A monitor so the principal Leadership tab
  //     shows an occupied state out of the box;
  //   · POS-SEED-2 — the DEMO student (STU-58, Class 2-A) as Class Captain
  //     of the LIVE session so the student-side Class Leadership workspace
  //     is demonstrable immediately (awarding/ending via the Leadership tab
  //     persists over this seed, per spec §38 E2E).
  studentPositions: [
    {
      id: 'POS-SEED-1',
      studentId: 'STU-27',
      studentName: 'Myra Patel',
      sessionId: SEED_SESSION_ID,
      // STU-27 is enrolled in Class 9 (C12) · A — the classId must match
      // the canonical class record so the Class 9 Leadership tab sees the
      // assignment (§3 — no invisible authority).
      classId: 'C12',
      className: 'Class 9',
      section: 'A',
      key: 'class-monitor',
      assignedById: 'PRINCIPAL',
      assignedByName: 'Dr. Ananya Iyer',
      assignedOn: '2026-08-15T09:00:00.000Z',
      active: true,
      notes: 'Appointed at the Investiture Ceremony.',
    },
    {
      id: 'POS-SEED-2',
      studentId: 'STU-58',
      studentName: 'Aarav Sharma',
      sessionId: SEED_SESSION_ID,
      classId: 'C05',
      // SD-3b — display label matches the server enrollment (Grade 9) so
      // the captaincy never contradicts the sidebar/profile identity.
      className: 'Grade 9',
      section: 'A',
      key: 'class-captain',
      assignedById: 'PRINCIPAL',
      assignedByName: 'Dr. Ananya Iyer',
      assignedOn: '2026-08-15T09:00:00.000Z',
      active: true,
      notes: 'Appointed at the Investiture Ceremony — AY 2026–2027.',
    },
  ],
  // Canonical subject registry (Spec §28). Cloned from SEED_SUBJECTS so
  // principal mutations (rename / add custom) don't mutate the seed.
  academicSubjects: SEED_SUBJECTS.map((s) => ({ ...s })),
  archiveStudent: (id, reason, by) => {
    const s = get().students.find((x) => x.id === id)
    if (!s) return
    const now = new Date().toISOString()
    // Spec §3 — an archived student can not hold live class responsibilities:
    // end every active position (history preserved) so the Leadership tab
    // and the student-side capability derivation never see an orphan holder.
    const { positions: nextPositions, ended } = endOrphanPositions(
      get().studentPositions,
      id,
      () => false,
      by,
      now,
    )
    set((state) => ({
      students: state.students.map((x) => x.id === id ? { ...x, status: 'Archived' as StudentStatus, archiveReason: reason, archiveDate: now, timeline: [{ id: `tl-${Date.now()}`, type: 'archive' as const, title: 'Student Archived', description: ended.length > 0 ? `${reason} · ${ended.length} class responsibilit${ended.length === 1 ? 'y' : 'ies'} ended automatically` : reason, date: now, by }, ...x.timeline] } : x),
      studentPositions: nextPositions,
    }))
  },
  restoreStudent: (id, by) => {
    set((state) => ({
      students: state.students.map((x) => x.id === id ? { ...x, status: 'Active' as StudentStatus, archiveReason: undefined, archiveDate: undefined, timeline: [{ id: `tl-${Date.now()}`, type: 'restore' as const, title: 'Student Restored', description: 'Restored to active status', date: new Date().toISOString(), by }, ...x.timeline] } : x),
    }))
  },
  transferStudent: (id, type, toClass, reason, by) => {
    const s = get().students.find((x) => x.id === id)
    if (!s) return
    const nc = get().classes.find((c) => c.name === toClass)
    const fc = `${s.className}-${s.section}`
    const tc = nc ? nc.name : toClass
    const now = new Date().toISOString()
    const newSection = nc ? (nc.sections[0]?.name ?? s.section) : s.section
    // Spec §3 — leadership is scoped to the awarding class · section. When
    // the student moves, positions from the old class/section end (history
    // preserved); only positions matching the NEW placement survive.
    const { positions: nextPositions, ended } = nc
      ? endOrphanPositions(
          get().studentPositions,
          id,
          (p) => p.classId === nc.id && p.section === newSection,
          by,
          now,
        )
      : { positions: get().studentPositions, ended: [] }
    set((state) => ({
      students: state.students.map((x) => x.id === id && nc ? { ...x, classId: nc.id, className: nc.name, section: newSection, rollNo: '01', timeline: [{ id: `tl-${Date.now()}`, type: 'transfer' as const, title: type, description: ended.length > 0 ? `${fc} → ${tc} · ${ended.length} class responsibilit${ended.length === 1 ? 'y' : 'ies'} ended automatically` : `${fc} → ${tc}`, date: now, by }, ...x.timeline] } : x),
      studentPositions: nextPositions,
      transfers: [{ id: `tr-${Date.now()}`, studentId: id, studentName: s.name, type, fromClass: fc, toClass: tc, reason, status: 'Completed' as const, date: now }, ...state.transfers],
    }))
  },
  assignHouse: (id, houseId, _by) => {
    const h = get().houses.find((x) => x.id === houseId)
    if (!h) return
    set((state) => ({ students: state.students.map((x) => x.id === id ? { ...x, houseId, houseName: h.name } : x) }))
  },
  updateRollNumber: (id, roll, _by) => {
    set((state) => ({ students: state.students.map((x) => x.id === id ? { ...x, rollNo: roll } : x) }))
  },
  createPromotion: (ids, from, to, year, by) => {
    set((state) => ({
      promotions: [...ids.map((sid) => { const st = state.students.find((x) => x.id === sid); return { id: `pr-${Date.now()}-${sid}`, studentId: sid, studentName: st?.name ?? '', fromClass: from, toClass: to, academicYear: year, feeCleared: st?.feeStatus === 'Paid', resultCleared: true, attendanceCleared: (st?.attendance ?? 0) >= 75, status: 'Pending' as const, date: new Date().toISOString(), requestedBy: by } }), ...state.promotions],
    }))
  },
  approvePromotion: (id, _by) => {
    set((state) => ({ promotions: state.promotions.map((p) => p.id === id ? { ...p, status: 'Approved' as const } : p) }))
  },
  executePromotion: (id, by) => {
    const p = get().promotions.find((x) => x.id === id)
    if (!p) return
    const nc = get().classes.find((c) => c.name === p.toClass)
    const now = new Date().toISOString()
    const newSection = nc ? (nc.sections[0]?.name ?? '') : ''
    // Spec §3 — promotion is a class move: live positions from the old
    // class/section end automatically (history preserved).
    const { positions: nextPositions } = nc
      ? endOrphanPositions(
          get().studentPositions,
          p.studentId,
          (pos) => pos.classId === nc.id && pos.section === newSection,
          by,
          now,
        )
      : { positions: get().studentPositions }
    set((state) => ({
      students: state.students.map((x) => x.id === p.studentId && nc ? { ...x, classId: nc.id, className: nc.name, section: nc.sections[0]?.name ?? x.section, rollNo: '01', timeline: [{ id: `tl-${Date.now()}`, type: 'promotion' as const, title: `Promoted to ${p.toClass}`, description: `Academic Year ${p.academicYear}`, date: now, by }, ...x.timeline] } : x),
      studentPositions: nextPositions,
      promotions: state.promotions.map((pp) => pp.id === id ? { ...pp, status: 'Completed' as const } : pp),
    }))
  },
  addHousePoints: (id, pts) => {
    set((state) => ({ houses: state.houses.map((h) => h.id === id ? { ...h, points: h.points + pts } : h) }))
  },
  assignHouseCaptain: (id, sid, role) => {
    set((state) => ({ houses: state.houses.map((h) => h.id === id ? (role === 'captain' ? { ...h, captainId: sid } : { ...h, viceCaptainId: sid }) : h) }))
  },
  // ─── Student positions (Class Captain / Monitor — spec §21–§25) ─────
  assignStudentPosition: (input) => {
    const st = get()
    const student = st.students.find((s) => s.id === input.studentId)
    if (!student) return { ok: false as const, error: 'Student not found.' }
    if (student.status !== 'Active') return { ok: false as const, error: 'Only active students can hold a class responsibility.' }
    // One active holder per (class · section · position · SESSION). Activity
    // resolves ONLY through the canonical resolver — never `p.active`
    // directly (RB-1 constitution). Replacing an existing holder ends their
    // position first (history preserved).
    const sessionId = getActiveAcademicSessionId()
    // PHASE 7.5-D — positions are SESSION-SCOPED records; when no source
    // knows the school's year there is nothing honest to stamp, so the
    // assignment is refused instead of guessing a session.
    if (!sessionId) {
      return {
        ok: false as const,
        error: 'Academic session not set — class responsibilities are session-scoped. Set the school session (Settings → Academics) and retry.',
      }
    }
    const displaced = st.studentPositions.filter(
      (p) =>
        p.classId === student.classId &&
        p.section === student.section &&
        p.key === input.key &&
        filterActivePositions(st.studentPositions, p.studentId, sessionId).some((ap) => ap.id === p.id),
    )
    const now = new Date().toISOString()
    const record: import('./types').StudentPosition = {
      id: `POS-${Date.now().toString(36)}`,
      studentId: student.id,
      studentName: student.name,
      sessionId,
      classId: student.classId,
      className: student.className,
      section: student.section,
      key: input.key,
      assignedById: input.assignedById,
      assignedByName: input.assignedByName,
      assignedOn: now,
      active: true,
      notes: input.notes,
    }
    set((state) => ({
      studentPositions: [
        record,
        ...state.studentPositions.map((p) =>
          displaced.some((d) => d.id === p.id)
            ? { ...p, active: false, endedOn: now, endedByName: input.assignedByName }
            : p,
        ),
      ],
      students: state.students.map((s) =>
        s.id === student.id
          ? {
              ...s,
              timeline: [
                {
                  id: `tl-${Date.now()}`,
                  type: 'position' as const,
                  title: `Appointed ${POSITION_DEFS[input.key]?.title ?? input.key}`,
                  description: `${POSITION_DEFS[input.key]?.title ?? input.key} of ${student.className}-${student.section} · by ${input.assignedByName}`,
                  date: now,
                  by: input.assignedByName,
                },
                ...s.timeline,
              ],
            }
          : s,
      ),
    }))
    return { ok: true as const, record }
  },
  endStudentPosition: (positionId, byName) => {
    const st = get()
    const pos = st.studentPositions.find((p) => p.id === positionId)
    if (!pos) return { ok: false as const, error: 'Position not found.' }
    if (!pos.active) return { ok: false as const, error: 'This position is already inactive.' }
    const now = new Date().toISOString()
    set((state) => ({
      studentPositions: state.studentPositions.map((p) =>
        p.id === positionId ? { ...p, active: false, endedOn: now, endedByName: byName } : p,
      ),
      students: state.students.map((s) =>
        s.id === pos.studentId
          ? {
              ...s,
              timeline: [
                {
                  id: `tl-${Date.now()}`,
                  type: 'position' as const,
                  title: `${POSITION_DEFS[pos.key]?.title ?? pos.key} responsibility ended`,
                  description: `${POSITION_DEFS[pos.key]?.title ?? pos.key} of ${pos.className}-${pos.section} · concluded by ${byName}`,
                  date: now,
                  by: byName,
                },
                ...s.timeline,
              ],
            }
          : s,
      ),
    }))
    return { ok: true as const }
  },
  updateClassTeacher: (classId, teacherId) => {
    set((state) => ({
      classes: state.classes.map((c) =>
        c.id === classId ? { ...c, classTeacherId: teacherId ?? '' } : c
      ),
    }))
  },
  updateClassAssistantTeacher: (classId, teacherId) => {
    set((state) => ({
      classes: state.classes.map((c) =>
        c.id === classId
          ? { ...c, assistantTeacherId: teacherId ?? undefined }
          : c
      ),
    }))
  },
  updateSectionTeacher: (classId, sectionId, teacherId) => {
    set((state) => ({
      classes: state.classes.map((c) =>
        c.id === classId
          ? { ...c, sections: c.sections.map((s) => s.id === sectionId ? { ...s, classTeacherId: teacherId ?? undefined } : s) }
          : c
      ),
    }))
  },
  updateSectionAssistantTeacher: (classId, sectionId, teacherId) => {
    set((state) => ({
      classes: state.classes.map((c) =>
        c.id === classId
          ? { ...c, sections: c.sections.map((s) => s.id === sectionId ? { ...s, assistantTeacherId: teacherId ?? undefined } : s) }
          : c
      ),
    }))
  },
  /** §5 room registry — assign a section's room (room NAME from the
   *  registry; null clears the assignment). */
  updateSectionRoom: (classId, sectionId, room) => {
    set((state) => ({
      classes: state.classes.map((c) =>
        c.id === classId
          ? { ...c, sections: c.sections.map((s) => s.id === sectionId ? { ...s, room: room ?? '' } : s) }
          : c
      ),
    }))
  },
  /** §5 room registry — a room RENAME must reach every class/section that
   *  references it by name (the name is the join key). */
  renameRoomEverywhere: (from, to) => {
    const key = from.trim().toLowerCase()
    if (!key) return
    set((state) => ({
      classes: state.classes.map((c) => {
        const classRoom = c.room.trim().toLowerCase() === key ? to : c.room
        const sectionHits = c.sections.some((s) => s.room.trim().toLowerCase() === key)
        if (classRoom === c.room && !sectionHits) return c
        return {
          ...c,
          room: classRoom,
          sections: sectionHits
            ? c.sections.map((s) => (s.room.trim().toLowerCase() === key ? { ...s, room: to } : s))
            : c.sections,
        }
      }),
    }))
  },
  addClassSubject: (classId, subjectId) => {
    set((state) => ({
      classes: state.classes.map((c) =>
        c.id === classId && !c.subjectIds.includes(subjectId)
          ? syncSubjectNames(
              { ...c, subjectIds: [...c.subjectIds, subjectId] },
              state.academicSubjects,
            )
          : c
      ),
    }))
  },
  archiveClassSubject: (classId, subjectId) => {
    set((state) => ({
      classes: state.classes.map((c) => {
        if (c.id !== classId) return c
        if (!c.subjectIds.includes(subjectId)) return c
        // Snapshot the current display name at archive time (Spec §7).
        const subj = state.academicSubjects.find((s) => s.id === subjectId)
        const snapName = subj?.name ?? subjectId
        const already = c.archivedSubjects.some((a) => a.id === subjectId)
        return syncSubjectNames(
          {
            ...c,
            subjectIds: c.subjectIds.filter((id) => id !== subjectId),
            archivedSubjects: already
              ? c.archivedSubjects
              : [{ id: subjectId, name: snapName, archivedAt: new Date().toISOString() }, ...c.archivedSubjects],
          },
          state.academicSubjects,
        )
      }),
    }))
  },
  restoreClassSubject: (classId, subjectId) => {
    set((state) => ({
      classes: state.classes.map((c) => {
        if (c.id !== classId) return c
        if (!c.archivedSubjects.some((a) => a.id === subjectId)) return c
        return syncSubjectNames(
          {
            ...c,
            subjectIds: c.subjectIds.includes(subjectId)
              ? c.subjectIds
              : [...c.subjectIds, subjectId],
            archivedSubjects: c.archivedSubjects.filter((a) => a.id !== subjectId),
          },
          state.academicSubjects,
        )
      }),
    }))
  },
  deleteArchivedSubject: (classId, subjectId) => {
    set((state) => ({
      classes: state.classes.map((c) =>
        c.id === classId
          ? { ...c, archivedSubjects: c.archivedSubjects.filter((a) => a.id !== subjectId) }
          : c
      ),
    }))
  },
  updateSubjectTeacher: (classId, subjectId, teacherId) => {
    set((state) => ({
      classes: state.classes.map((c) => {
        if (c.id !== classId) return c
        const next = { ...c.subjectTeachers }
        if (teacherId) {
          next[subjectId] = teacherId
        } else {
          delete next[subjectId]
        }
        return { ...c, subjectTeachers: next }
      }),
    }))
  },
  /** Spec §9 — rename a canonical subject. Updates only the registry; every
   *  class's `subjects` display array is re-derived via syncSubjectNames. */
  renameSubject: (subjectId, newName) => {
    const trimmed = newName.trim()
    if (!trimmed) return
    set((state) => {
      // Compute the NEW registry first, THEN re-derive class subject names
      // from the new registry (not the old one — that was the bug).
      const nextRegistry = state.academicSubjects.map((s) =>
        s.id === subjectId ? { ...s, name: trimmed } : s
      )
      return {
        academicSubjects: nextRegistry,
        classes: state.classes.map((c) => syncSubjectNames(c, nextRegistry)),
      }
    })
  },
  /** Spec §8 — create a NEW custom subject (or reuse an existing same-name one)
   *  and add it to a class. Returns the subject id. */
  createCustomSubject: (classId, name) => {
    const trimmed = name.trim()
    if (!trimmed) return ''
    const state = get()
    // Reuse existing subject with same name (case-insensitive) if present.
    const existing = state.academicSubjects.find(
      (s) => s.name.toLowerCase() === trimmed.toLowerCase(),
    )
    const subjectId = existing?.id ?? idForCustomSubject(trimmed)
    if (!existing) {
      const newSubject: SubjectDef = {
        id: subjectId,
        name: trimmed,
        code: codeForName(trimmed),
        category: 'Additional',
        status: 'Active',
      }
      set((s) => ({ academicSubjects: [...s.academicSubjects, newSubject] }))
    }
    // Add to class if not already present.
    if (!state.classes.find((c) => c.id === classId)?.subjectIds.includes(subjectId)) {
      get().addClassSubject(classId, subjectId)
    }
    return subjectId
  },
  getSubjectById: (subjectId) => get().academicSubjects.find((s) => s.id === subjectId && s.status === 'Active'),
  getStudentById: (id) => get().students.find((s) => s.id === id),
  getClassById: (id) => get().classes.find((c) => c.id === id),
  getClassStudents: (classId) => get().students.filter((s) => s.classId === classId && s.status === 'Active'),

  // ─── Class creation (Add Class page — real, persisted) ────────────
  createClass: (input) => {
    const state = get()
    const name = input.name.trim()
    // Derive a stable, unique id from the class name.
    let id = 'C-' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-')
    while (state.classes.some((c) => c.id === id)) id += '-x'
    // Grade + level from the class name (e.g. "Class 6" → grade 6).
    const gradeMatch = name.match(/(\d+)/)
    const grade = gradeMatch ? parseInt(gradeMatch[1], 10) : 1
    const level: import('./types').ClassRecord['level'] =
      grade <= 2 ? 'Pre-Primary' : grade <= 5 ? 'Primary' : grade <= 8 ? 'Middle' : grade <= 10 ? 'Secondary' : 'Senior Secondary'
    // Default subjects for the level (canonical ids from the registry).
    const subjectIds = (SUBJECTS_BY_LEVEL[level] || [])
      .map((n) => state.academicSubjects.find((s) => s.name === n)?.id)
      .filter((sid): sid is string => Boolean(sid))
    const subjects = subjectIds
      .map((sid) => state.academicSubjects.find((s) => s.id === sid)?.name)
      .filter((n): n is string => Boolean(n))
    const capacity = input.sections.reduce((s, x) => s + (x.capacity || 0), 0) || input.capacity
    const record: import('./types').ClassRecord = {
      id, name, grade, level,
      sections: input.sections.map((s) => ({
        id: `${id}-${s.name.trim() || 'A'}`,
        name: s.name.trim() || 'A',
        classId: id,
        capacity: s.capacity || input.capacity,
        classTeacherId: input.classTeacherId,
        assistantTeacherId: input.assistantTeacherId,
        room: s.room || input.room,
      })),
      capacity: capacity || 40,
      classTeacherId: input.classTeacherId ?? '',
      assistantTeacherId: input.assistantTeacherId,
      subjectIds,
      subjects,
      archivedSubjects: [],
      subjectTeachers: {},
      stream: null,
      room: input.room,
      status: 'Active' as const,
    }
    set((s) => ({ classes: [...s.classes, record] }))
    return record
  },

  // ─── Student enrolment (Admissions → Complete & Enrol) ───────────
  addStudent: (input) => {
    const state = get()
    const cls = state.classes.find((c) => c.id === input.classId)
    const section = input.section ?? cls?.sections[0]?.name ?? 'A'
    // Next admission number continues the roster sequence (DSO2024001…).
    const maxAdm = state.students.reduce((m, s) => {
      const n = parseInt(s.admissionNo.replace(/\D/g, ''), 10)
      return Number.isNaN(n) ? m : Math.max(m, n)
    }, 2024000)
    const admissionNo = `DSO${maxAdm + 1}`
    // Next roster id + roll number within the class/section.
    const maxId = state.students.reduce((m, s) => {
      const n = parseInt(s.id.replace(/\D/g, ''), 10)
      return Number.isNaN(n) ? m : Math.max(m, n)
    }, 0)
    const id = `STU-${maxId + 1}`
    const sectionMates = state.students.filter(
      (s) => s.classId === input.classId && s.section === section,
    )
    const rollNo = String(sectionMates.length + 1).padStart(2, '0')
    const house = HOUSE_DEFS[maxId % HOUSE_DEFS.length]
    const now = new Date().toISOString()
    const initials = input.name.split(' ').map((n) => n[0]).slice(0, 2).join('').toUpperCase()
    const subjectIds = cls?.subjectIds ?? []
    const academics = {
      overallGrade: '—',
      overallPercent: 0,
      rankInClass: sectionMates.length + 1,
      subjects: subjectIds.map((sid) => ({
        name: state.academicSubjects.find((s) => s.id === sid)?.name ?? sid,
        grade: '—',
        percent: 0,
        teacher: '—',
      })),
    }
    const record: import('./types').StudentRecord = {
      id,
      admissionNo,
      rollNo,
      name: input.name.trim(),
      avatar: initials,
      gender: input.gender,
      classId: input.classId,
      className: cls?.name ?? '—',
      section,
      dob: input.dob,
      bloodGroup: input.bloodGroup ?? '—',
      category: input.category ?? 'General',
      fatherName: input.fatherName,
      motherName: input.motherName,
      guardianName: input.fatherName,
      guardianPhone: input.guardianPhone,
      guardianEmail: input.guardianEmail ?? '',
      address: input.address ?? '',
      city: 'Gurugram',
      state: 'Haryana',
      admissionDate: input.admissionDate ?? now.slice(0, 10),
      previousSchool: input.previousSchool ?? '',
      status: 'Active' as const,
      attendance: 0,
      feeStatus: 'Pending' as const,
      feePaid: 0,
      feeTotal: 0,
      transport: false,
      hostel: false,
      scholarship: 0,
      houseId: house.id,
      houseName: house.name,
      medical: 'No known allergies',
      academics,
      attendanceTrend: [],
      disciplinePoints: 0,
      disciplineRecords: [],
      documents: [],
      achievements: [],
      timeline: [{
        id: `tl-${Date.now()}`,
        type: 'admission' as const,
        title: 'Admission Confirmed',
        description: `Admitted to ${cls?.name ?? input.classId} - Sec ${section}`,
        date: now.slice(0, 10),
        by: 'Admissions Office',
      }],
    }
    set((s) => ({ students: [record, ...s.students] }))
    return record
  },
    }),
    {
      // TENANT-SCOPED persistence — the roster, classes, houses and subject
      // registry survive reloads (Create Class / admissions enrolment /
      // archive / transfers persist), isolated per school namespace.
      name: 'scholario-students-v1',
      storage: createTenantScopedStorage('scholario-students-v1'),
      // v2 — roster extended with the 16 Class 2-A students (STU-43..58):
      // one canonical store now backs principal + teacher + student roles.
      // v3 (RB-1) — StudentPosition became SESSION-SCOPED: every persisted
      // position gains the live session id ('2026-2027' convention), and the
      // demo student's Class Captain assignment is restored for the current
      // session when an older persisted state predates it. The migration
      // runs ONCE per browser; afterwards awarding/ending positions persists
      // normally (spec §38 E2E stays intact).
      version: 5,
      migrate: (persisted, version) => {
        const state = (persisted ?? {}) as Partial<StudentsState>
        if (version < 5) {
          // v4/v5 — POS-SEED-1 data healing (production pass §3/§17): the
          // seed carried classId 'C10' (a class id that does not exist — the
          // ids skip C02/C04/C06/C08/C10) and a stale holder name, making
          // the Class 9-A Class Monitor assignment invisible in the Class 9
          // Leadership tab while the capabilities still derived
          // student-side. Heal ONLY the untouched seed record to the real
          // class (C12 = Class 9) and the roster's actual holder name;
          // user-awarded positions are never touched (id signature).
          state.studentPositions = (state.studentPositions ?? []).map((p) => {
            if (p.id !== 'POS-SEED-1') return p
            const holder = (state.students ?? []).find((s) => s.id === p.studentId)
            return {
              ...p,
              classId: p.classId === 'C10' ? 'C12' : p.classId,
              studentName: p.studentName === 'Diya Verma' ? (holder?.name ?? 'Myra Patel') : p.studentName,
            }
          })
        }
        if (version < 3) {
          const positions = (state.studentPositions ?? []).map((p) =>
            p.sessionId ? p : { ...p, sessionId: SEED_SESSION_ID },
          )
          if (!positions.some((p) => p.studentId === 'STU-58' && p.sessionId === SEED_SESSION_ID)) {
            positions.push({
              id: 'POS-SEED-2',
              studentId: 'STU-58',
              studentName: 'Aarav Sharma',
              sessionId: SEED_SESSION_ID,
              classId: 'C05',
              className: 'Class 2',
              section: 'A',
              key: 'class-captain',
              assignedById: 'PRINCIPAL',
              assignedByName: 'Dr. Ananya Iyer',
              assignedOn: '2026-08-15T09:00:00.000Z',
              active: true,
              notes: 'Appointed at the Investiture Ceremony — AY 2026–2027.',
            })
          }
          state.studentPositions = positions
        }
        return state as StudentsState
      },
      partialize: (s) => ({
        students: s.students,
        classes: s.classes,
        houses: s.houses,
        promotions: s.promotions,
        transfers: s.transfers,
        studentPositions: s.studentPositions,
        academicSubjects: s.academicSubjects,
      }),
    },
  ),
)
