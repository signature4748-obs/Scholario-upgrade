import type { StateCreator } from 'zustand'
import type { TeachersStoreState } from '../types'

export const createLifecycleSlice: StateCreator<
  TeachersStoreState,
  [],
  [],
  Pick<TeachersStoreState, 'addTeacher' | 'updateTeacher' | 'terminateTeacher'>
> = (set, get) => ({
  addTeacher: (newTeacher) => {
    set((state) => ({ teachers: [newTeacher, ...state.teachers] }))
    get().logAudit({
      category: 'Teacher Created',
      // TQA-14 — neutral attribution: the canonical audit row (real
      // session actor) is written server-side by POST /api/teachers.
      actorName: 'Principal',
      actorRole: 'Principal',
      targetTeacherId: newTeacher.id,
      targetTeacherName: newTeacher.name,
      details: `Registered ${newTeacher.name} as ${newTeacher.designation} (${newTeacher.department})`,
    })
  },

  updateTeacher: (id, updates) => {
    set((state) => ({
      teachers: state.teachers.map((t) => (t.id === id ? { ...t, ...updates } : t)),
    }))
  },

  terminateTeacher: (teacherId, reason, lockLogin) => {
    const teacher = get().teachers.find((t) => t.id === teacherId)
    if (!teacher) return

    // Per spec — relieved teachers are NOT deleted. We mark them as
    // 'Relieved' so they're excluded from the active Faculty Directory
    // but their full record (positions, subjects, classes, salary
    // history, documents) remains intact for audit + future rejoining.
    set((s) => ({
      teachers: s.teachers.map((t) =>
        t.id === teacherId
          ? {
              ...t,
              status: 'Relieved' as const,
              isLocked: lockLogin,
              // Preserve positions, subjects, classes — do NOT clear them.
              // The full record stays for audit, appointment history,
              // salary history, and potential future rejoining.
              remarks: `Relieved on ${new Date().toISOString().split('T')[0]}. Reason: ${reason}`,
            }
          : t
      ),
    }))

    get().logAudit({
      category: 'Position Action',
      // TQA-14 — neutral attribution: the canonical audit row (real
      // session actor + capability release facts) is written server-side
      // by PATCH /api/teachers/:id terminate.
      actorName: 'Principal',
      actorRole: 'Principal',
      targetTeacherId: teacher.id,
      targetTeacherName: teacher.name,
      details: `RELIEVED staff record for ${teacher.name}. Reason: ${reason}. Login Locked: ${lockLogin}. Record archived with full history preserved.`,
    })
  },
})
