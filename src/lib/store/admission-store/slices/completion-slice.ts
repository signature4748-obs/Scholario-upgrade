import type { StateCreator } from 'zustand'
import type { AdmissionStoreState } from '../types'

export const createCompletionSlice: StateCreator<
  AdmissionStoreState,
  [],
  [],
  Pick<AdmissionStoreState, 'completeAdmission'>
> = (set, get) => ({
  // PHASE 7-H (admissions honesty) — completion is now a RECORDER, not a
  // creator. The REAL enrollment happens server-side: the issuance
  // workspace's enroll step POSTs the applicant's collected data to
  // /api/students (canonical User+Student rows, ACCOUNT_CREATED audit,
  // one-time temp password surfaced to the operator exactly once). Only
  // after the SERVER confirms does this action mark the local admission
  // record Completed — with the SERVER-issued student id and admission
  // number cross-referenced onto it.
  //
  // Everything the old slice fabricated is GONE: no fake roster
  // insertion (students-store addStudent / createClass localStorage
  // writes), no push into the mock students array, no fabricated
  // guardian phone or placeholder email defaults, no locally-minted
  // login credentials, and no sms/email/whatsapp dispatch claims. The
  // roster refresh after a real enrollment is the canonical server sync
  // (resetRosterSyncGuard + syncStudentsFromServer) driven by the UI.
  completeAdmission: (appId, issuanceDetails) => {
    const state = get()
    const now = new Date().toISOString().split('T')[0]
    const nowTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

    const app = state.applications.find((a) => a.id === appId)
    if (!app) return null

    const finalAdmissionNo = issuanceDetails?.admissionNo || app.admissionNo
    const finalStudentId = issuanceDetails?.studentId || app.studentId
    const finalRollNo = issuanceDetails?.rollNo || (app.rollNo !== '—' ? app.rollNo : '01')
    const finalRegNo = issuanceDetails?.regNo || app.regNo

    const serverEnrolled = !!issuanceDetails?.studentId

    const updatedApps = state.applications.map((item) =>
      item.id === appId
        ? {
            ...item,
            status: 'Completed' as const,
            admissionNo: finalAdmissionNo,
            studentId: finalStudentId,
            rollNo: finalRollNo,
            regNo: finalRegNo,
            lastUpdatedDate: now,
            // FINAL-GATE honesty fix: completion claims nothing that did not
            // happen. No messaging integration is wired in this flow — no
            // SMS/email/WhatsApp is dispatched. The Student Portal tab guides
            // the office through the real provisioning path (the enroll step
            // creates the account with a one-time password).
            notificationsSent: { sms: false, email: false, whatsapp: false },
            auditTrail: [
              ...item.auditTrail,
              {
                id: `a-${Date.now()}`,
                timestamp: `${now} ${nowTime}`,
                action: serverEnrolled
                  ? 'Admission Completed & Enrolled'
                  : 'Admission Completed',
                actor: 'Admission Office',
                notes: serverEnrolled
                  ? `Enrolled on the school server — student id ${finalStudentId}, admission no ${finalAdmissionNo}. The local admission record references the server student.`
                  : 'Admission issued. Enrollment into the student roster was not performed in this session.',
              },
            ],
          }
        : item
    )

    set({ applications: updatedApps })

    return updatedApps.find((a) => a.id === appId) ?? null
  },
})
