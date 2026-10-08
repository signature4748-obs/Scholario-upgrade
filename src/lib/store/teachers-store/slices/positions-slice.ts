import type { StateCreator } from 'zustand'
import type {
  PositionAssignment,
  PositionDefinition,
  TeachersStoreState,
} from '../types'
// 7-POLISH — the default assigning actor is the REAL session user
// (server identity via /api/auth/me), never a fabricated principal.
import { sessionActorName } from '../helpers'

export const createPositionsSlice: StateCreator<
  TeachersStoreState,
  [],
  [],
  Pick<
    TeachersStoreState,
    | 'addCustomPosition'
    | 'assignPositionToTeacher'
    | 'removePositionFromTeacher'
    | 'acceptPosition'
    | 'rejectPosition'
    | 'requestPositionClarification'
  >
> = (set, get) => ({
  addCustomPosition: (posData) => {
    const id = `pos-custom-${Date.now()}`
    const newPos: PositionDefinition = {
      ...posData,
      id,
      isCustom: true,
    }
    set((state) => ({ positionsList: [...state.positionsList, newPos] }))
    return newPos
  },

  assignPositionToTeacher: (teacherId, positionId, assignedBy = sessionActorName(), classAssigned?: string, effectiveDate?: string) => {
    const state = get()
    const targetPos = state.positionsList.find((p) => p.id === positionId)
    if (!targetPos) return

    const assignment: PositionAssignment = {
      id: `pa-${Date.now()}`,
      positionId: targetPos.id,
      positionTitle: targetPos.title,
      classAssigned,
      assignedDate: new Date().toISOString().split('T')[0],
      assignedBy,
      status: 'Pending Acceptance',
      effectiveDate: effectiveDate || new Date().toISOString().split('T')[0],
    }

    const teacher = state.teachers.find((t) => t.id === teacherId)
    if (!teacher) return

    set((s) => ({
      teachers: s.teachers.map((t) =>
        t.id === teacherId
          ? { ...t, positions: [...t.positions, assignment] }
          : t
      ),
    }))

    get().logAudit({
      category: 'Position Assigned',
      actorName: assignedBy,
      actorRole: 'Principal',
      targetTeacherId: teacher.id,
      targetTeacherName: teacher.name,
      details: `Assigned position "${targetPos.title}"${classAssigned ? ` for ${classAssigned}` : ''} (Pending Acceptance)`,
    })
  },

  removePositionFromTeacher: (teacherId, assignmentId, reason = 'Administrative Reassignment') => {
    const state = get()
    const teacher = state.teachers.find((t) => t.id === teacherId)
    if (!teacher) return

    const assignment = teacher.positions.find((p) => p.id === assignmentId)
    if (!assignment) return

    // Soft removal — flag as Pending Removal (record kept for audit).
    // (7-B) the former "emergency" instant-removal leg (gated by a
    // hardcoded client-side auth code) was a fake authorization surface
    // and has been removed.
    const updatedPositions = teacher.positions.map((p) =>
      p.id === assignmentId ? { ...p, status: 'Pending Removal' as const } : p
    )
    get().logAudit({
      category: 'Position Action',
      actorName: 'Principal',
      actorRole: 'Principal',
      targetTeacherId: teacher.id,
      targetTeacherName: teacher.name,
      details: `Initiated removal for "${assignment.positionTitle}" (Pending Acknowledgement). Reason: ${reason}`,
    })

    set((s) => ({
      teachers: s.teachers.map((t) => (t.id === teacherId ? { ...t, positions: updatedPositions } : t)),
    }))
  },

  acceptPosition: (teacherId, assignmentId) => {
    const teacher = get().teachers.find((t) => t.id === teacherId)
    if (!teacher) return

    const pos = teacher.positions.find((p) => p.id === assignmentId)
    if (!pos) return

    const updatedClasses = pos.classAssigned && !teacher.classes.includes(pos.classAssigned)
      ? [...teacher.classes, pos.classAssigned]
      : teacher.classes

    set((s) => ({
      teachers: s.teachers.map((t) =>
        t.id === teacherId
          ? {
              ...t,
              classes: updatedClasses,
              positions: t.positions.map((p) =>
                p.id === assignmentId ? { ...p, status: 'Active' as const } : p
              ),
            }
          : t
      ),
    }))

    get().logAudit({
      category: 'Position Action',
      actorName: teacher.name,
      actorRole: 'Teacher',
      targetTeacherId: teacher.id,
      targetTeacherName: teacher.name,
      details: `Accepted position assignment: "${pos.positionTitle}"${pos.classAssigned ? ` for ${pos.classAssigned}` : ''}. Permissions activated.`,
    })
  },

  rejectPosition: (teacherId, assignmentId, reason) => {
    const teacher = get().teachers.find((t) => t.id === teacherId)
    if (!teacher) return

    const pos = teacher.positions.find((p) => p.id === assignmentId)
    if (!pos) return

    set((s) => ({
      teachers: s.teachers.map((t) =>
        t.id === teacherId
          ? {
              ...t,
              positions: t.positions.map((p) =>
                p.id === assignmentId
                  ? { ...p, status: 'Rejected' as const, rejectionReason: reason }
                  : p
              ),
            }
          : t
      ),
    }))

    get().logAudit({
      category: 'Position Action',
      actorName: teacher.name,
      actorRole: 'Teacher',
      targetTeacherId: teacher.id,
      targetTeacherName: teacher.name,
      details: `Declined position "${pos.positionTitle}". Reason: ${reason}`,
    })
  },

  requestPositionClarification: (teacherId, assignmentId, query) => {
    const teacher = get().teachers.find((t) => t.id === teacherId)
    if (!teacher) return

    set((s) => ({
      teachers: s.teachers.map((t) =>
        t.id === teacherId
          ? {
              ...t,
              positions: t.positions.map((p) =>
                p.id === assignmentId ? { ...p, clarificationRequest: query } : p
              ),
            }
          : t
      ),
    }))

    get().logAudit({
      category: 'Position Action',
      actorName: teacher.name,
      actorRole: 'Teacher',
      targetTeacherId: teacher.id,
      targetTeacherName: teacher.name,
      details: `Requested clarification for position assignment: "${query}"`,
    })
  },
})
