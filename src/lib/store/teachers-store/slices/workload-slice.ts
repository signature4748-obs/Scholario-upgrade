import type { StateCreator } from 'zustand'
import type {
  TeachersStoreState,
} from '../types'
import { createAppointmentLetterSnapshot } from '../letter-factory'

export const createWorkloadSlice: StateCreator<
  TeachersStoreState,
  [],
  [],
  Pick<
    TeachersStoreState,
    | 'assignSubjectsAndClasses'
    | 'regenerateAppointmentLetter'
    | 'issueAppointmentLetter'
    | 'setTeacherMedia'
  >
> = (set, get) => ({
  assignSubjectsAndClasses: (teacherId, subjects, classes, examResp) => {
    const teacher = get().teachers.find((t) => t.id === teacherId)
    if (!teacher) return

    set((s) => ({
      teachers: s.teachers.map((t) =>
        // examResp === undefined means "not managing exam duties in this
        // call" — the teacher's existing exam responsibilities are PRESERVED
        // (saving a subject/class allocation must never wipe exam duties).
        // Only an explicitly passed array (including []) overwrites them.
        t.id === teacherId
          ? { ...t, subjects, classes, examResponsibilities: examResp ?? t.examResponsibilities }
          : t
      ),
    }))

    get().logAudit({
      category: 'Subject Assigned',
      actorName: 'Dr. Ananya Iyer',
      actorRole: 'Principal',
      targetTeacherId: teacher.id,
      targetTeacherName: teacher.name,
      details: `Updated workload: Subjects [${subjects.join(', ')}], Classes [${classes.join(', ')}]`,
    })
  },

  /**
   * Issue a NEW appointment letter for a teacher.
   *
   * DATA INTEGRITY (Wave 2.3 §9): the letter is a full immutable SNAPSHOT
   * of the employment facts at issue time (name, designation, department,
   * salary, joining date, address…). The previously issued letter is
   * archived unchanged — profile changes never rewrite history. The
   * reference number is deterministic (employee + issue sequence), never
   * a random value.
   */
  issueAppointmentLetter: (teacherId, customTerms, newSalary) => {
    const teacher = get().teachers.find((t) => t.id === teacherId)
    if (!teacher) return null

    const currentSal = newSalary || teacher.salary
    const archive = teacher.letterArchive ?? []
    const issueSeq = archive.length + 1

    const letter = createAppointmentLetterSnapshot({
      employeeId: teacher.employeeId,
      teacherName: teacher.name,
      designation: teacher.designation,
      department: teacher.department,
      joiningDate: teacher.joiningDate,
      monthlySalary: currentSal,
      teacherAddress: teacher.currentAddress,
      issueSeq,
      customTerms,
    })

    set((s) => ({
      teachers: s.teachers.map((t) =>
        t.id === teacherId
          ? {
              ...t,
              salary: currentSal,
              // The previous letter (if any) is archived unchanged.
              letterArchive: t.appointmentLetter
                ? [...(t.letterArchive ?? []), t.appointmentLetter]
                : t.letterArchive,
              appointmentLetter: letter,
            }
          : t
      ),
    }))

    get().logAudit({
      category: 'Appointment Letter',
      actorName: 'Dr. Ananya Iyer',
      actorRole: 'Principal',
      targetTeacherId: teacher.id,
      targetTeacherName: teacher.name,
      details: `Issued official Appointment Letter ${letter.officialLetterNo}${
        teacher.appointmentLetter ? ` (previous ${teacher.appointmentLetter.officialLetterNo} archived)` : ''
      }`,
    })

    return letter
  },

  /**
   * Legacy entry point kept for existing callers — now issues a new letter
   * through the immutable issue pipeline.
   */
  regenerateAppointmentLetter: (teacherId, customTerms, newSalary) => {
    get().issueAppointmentLetter(teacherId, customTerms, newSalary)
  },

  setTeacherMedia: (teacherId, kind, media) => {
    set((s) => ({
      teachers: s.teachers.map((t) =>
        t.id === teacherId ? { ...t, [kind]: media ?? undefined } : t
      ),
    }))
  },
})
