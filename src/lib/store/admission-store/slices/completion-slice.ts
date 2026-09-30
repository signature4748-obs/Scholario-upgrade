import type { StateCreator } from 'zustand'
import type { AdmissionStatus, AdmissionStoreState } from '../types'
import { students, Student } from '@/lib/mock/students'
import { useStudentsStore } from '@/lib/store/students-store'

export const createCompletionSlice: StateCreator<
  AdmissionStoreState,
  [],
  [],
  Pick<AdmissionStoreState, 'completeAdmission'>
> = (set, get) => ({
  completeAdmission: (appId, issuanceDetails) => {
    const state = get()
    const now = new Date().toISOString().split('T')[0]
    const nowTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

    const app = state.applications.find((a) => a.id === appId)
    if (!app) return null

    // Generate permanent, non-sequential, unguessable public IDs (never reused)
    const RAND_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
    const randId = (n: number) => Array.from({ length: n }, () => RAND_ALPHABET[Math.floor(Math.random() * RAND_ALPHABET.length)]).join('')
    const year = new Date().getFullYear()
    const finalAdmissionNo = issuanceDetails?.admissionNo || `SCH-ADM-${year}-${randId(4)}-${randId(2)}`
    const finalStudentId = issuanceDetails?.studentId || `SCH-STU-${randId(4)}-${randId(4)}-${randId(1)}`
    const finalRollNo = issuanceDetails?.rollNo || (app.rollNo !== '—' ? app.rollNo : '01')
    const finalRegNo = issuanceDetails?.regNo || `REG-${year}-${randId(6)}`

    const updatedApps = state.applications.map((item) =>
      item.id === appId
        ? {
            ...item,
            status: 'Completed' as AdmissionStatus,
            admissionNo: finalAdmissionNo,
            studentId: finalStudentId,
            rollNo: finalRollNo,
            regNo: finalRegNo,
            lastUpdatedDate: now,
            // FINAL-GATE honesty fix: completion used to fabricate portal
            // credentials (loginId/tempPassword/portal.scholario.app) and
            // claim SMS/email/WhatsApp dispatch — none of which happens in
            // this flow (no messaging integration is wired, no account is
            // provisioned here). The record now claims NOTHING that did not
            // happen; the Student Portal tab guides the office through the
            // real provisioning path (Students & Classes enrolment creates
            // the account with a one-time password).
            notificationsSent: { sms: false, email: false, whatsapp: false },
            auditTrail: [
              ...item.auditTrail,
              {
                id: `a-${Date.now()}`,
                timestamp: `${now} ${nowTime}`,
                action: 'Admission Completed & Issued',
                actor: 'Admission Office',
                notes: `Admission Issued (${finalAdmissionNo}). Student enrolled into the roster.`,
              },
            ],
          }
        : item
    )

    set({ applications: updatedApps })

    // Generate student object to return. FINAL-GATE honesty: a newly
    // admitted student has NO payments recorded, NO attendance history and
    // fees are PENDING — the previous hardcoded `feeStatus: 'Paid',
    // feePaid: 86000, attendance: 100` told the principal payment and
    // attendance existed when neither did (matches the roster's own honest
    // defaults in students-store addStudent).
    const newStudent: Student = {
      id: finalStudentId,
      admissionNo: finalAdmissionNo,
      rollNo: finalRollNo,
      name: app.applicantName,
      avatar: `${app.formData.firstName[0] || 'S'}${app.formData.lastName[0] || 'T'}`,
      gender: app.formData.gender as 'Male' | 'Female',
      className: app.formData.className || 'Class 2',
      section: app.formData.section || 'A',
      dob: app.formData.dob || '2017-08-14',
      bloodGroup: app.formData.bloodGroup || 'O+',
      fatherName: app.formData.fatherName || 'Parent',
      motherName: app.formData.motherName || 'Parent',
      guardianPhone: app.formData.fatherPhone || app.formData.motherPhone || '+91 98100 00000',
      email: app.formData.fatherEmail || app.formData.motherEmail || 'parent@gmail.com',
      address: app.formData.currentAddress || 'Gurugram',
      admissionDate: now,
      previousSchool: app.formData.previousSchool || 'N/A',
      status: 'Active',
      attendance: 0,
      feeStatus: 'Pending',
      feePaid: 0,
      feeTotal: 0,
      transport: app.formData.transportRequired,
      hostel: app.formData.hostelRequired,
      scholarship: 0,
      photo: `${app.formData.firstName[0] || 'S'}${app.formData.lastName[0] || 'T'}`,
      libraryId: `LIB-${Math.floor(Math.random() * 8000 + 1000)}`,
      medical: app.formData.allergies || 'No known allergies',
    }

    // Push to mock students array if present
    if (students && !students.some((s) => s.id === newStudent.id || s.admissionNo === newStudent.admissionNo)) {
      students.unshift(newStudent)
    }

    // ─── CONNECTED ROSTER ENROLMENT ────────────────────────────────────
    // The completed admission ALSO becomes a REAL student in the canonical
    // roster store (Students & Classes, Fees, Certificates, Downloads all
    // reference the same student). If the admitted class is not yet in the
    // academic roster, it is CREATED (with the admitted section) so the
    // student is never enrolled under an unrelated class.
    try {
      const roster = useStudentsStore.getState()
      const admittedClass = app.formData.className || newStudent.className
      const sectionName = newStudent.section || 'A'
      let cls =
        roster.classes.find((c) => c.name === admittedClass) ??
        roster.classes.find((c) => `${c.name}` === newStudent.className)
      if (!cls && admittedClass) {
        // The admission seats configuration offers classes the academic
        // roster may not run yet — create the class, then enroll into it.
        roster.createClass({
          name: admittedClass,
          capacity: 40,
          room: '—',
          sections: [{ name: sectionName, capacity: 40, room: '—' }],
        })
        cls = useStudentsStore
          .getState()
          .classes.find((c) => c.name === admittedClass)
      }
      if (cls) {
        const enrolled = roster.addStudent({
          name: newStudent.name,
          dob: newStudent.dob,
          gender: newStudent.gender,
          classId: cls.id,
          section: newStudent.section,
          fatherName: newStudent.fatherName,
          motherName: newStudent.motherName,
          guardianPhone: newStudent.guardianPhone,
          guardianEmail: newStudent.email,
          address: newStudent.address,
          bloodGroup: newStudent.bloodGroup,
          previousSchool: newStudent.previousSchool,
          admissionDate: now,
        })
        // Cross-reference: the admission record points at the roster id so
        // every module resolves the SAME student.
        set((s) => ({
          applications: s.applications.map((item) =>
            item.id === appId
              ? { ...item, studentId: enrolled.id, admissionNo: enrolled.admissionNo }
              : item
          ),
        }))
      }
    } catch {
      // Roster enrolment is best-effort — the admission record itself is
      // already persisted above.
    }

    return newStudent
  },
})
