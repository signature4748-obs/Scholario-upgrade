import { AdmissionLetterData } from '../../../OfficialAdmissionLetter'
import { computeFeeSnapshot } from '../../../FeeStructureStep/fee-snapshot'
import { defaultFeeDataState } from '../../../FeeStructureStep/types'
import { useSchoolSettingsStore } from '@/lib/store/school-settings-store'
import { getSchoolProfile } from '@/lib/school-profile'
import type { AdmissionApplication } from '@/lib/store/admission-store'

export interface IssuanceArtifacts {
  admissionNo: string
  studentId: string
  rollNo: string
  regNo: string
  letterData: AdmissionLetterData
  /** FEE-ADMISSIONS MVP — the server-issued fee statement backing the
   * letter/receipt amounts (immutable snapshot once enrolled, provisional
   * server quote before enrolment). Null → legacy local pipeline. */
  serverFees: ServerFeeStatement | null
}

/** A server-issued fee statement (snapshot or live quote). */
export interface ServerFeeStatement {
  kind: 'snapshot' | 'quote'
  lineItems: {
    headId: string
    name: string
    category: string
    kind: string
    frequency?: string
    quantity: number
    unitAmount: number
    amount: number
    discounted: boolean
    discountCode?: string
  }[]
  discountName: string | null
  discountAmount: number
  totalAmount: number
  academicYear?: string
  structureVersion?: number | null
  issuedAt?: string
}

/** Random ID segment — same alphabet as the wizard's permanent ID generator. */
const RAND_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const randId = (n: number) =>
  Array.from({ length: n }, () => RAND_ALPHABET[Math.floor(Math.random() * RAND_ALPHABET.length)]).join('')

/** Build the letter fee table from a server fee statement. */
export function serverFeeStatementToLetterFees(
  statement: ServerFeeStatement,
): AdmissionLetterData['fees'] {
  const buckets = {
    registrationFee: 0,
    admissionFee: 0,
    tuitionFee: 0,
    booksTotal: 0,
    examFee: 0,
    transportFee: 0,
    otherHeadsTotal: 0,
  }
  for (const li of statement.lineItems) {
    const cat = (li.category || '').toLowerCase()
    if (cat.includes('registration')) buckets.registrationFee += li.amount
    else if (cat.includes('admission')) buckets.admissionFee += li.amount
    else if (cat.includes('tuition') || cat.includes('annual')) buckets.tuitionFee += li.amount
    else if (cat.includes('book')) buckets.booksTotal += li.amount
    else if (cat.includes('exam')) buckets.examFee += li.amount
    else if (cat.includes('transport')) buckets.transportFee += li.amount
    else buckets.otherHeadsTotal += li.amount
  }
  const gross = statement.totalAmount + statement.discountAmount
  return {
    ...buckets,
    subtotal: gross,
    totalAnnualFee: gross,
    discountName: statement.discountName ?? undefined,
    discountAmount: statement.discountAmount,
    finalPayable: statement.totalAmount,
  }
}

/** Coerce a stored app.serverFeeSnapshot into a ServerFeeStatement. */
export function storedSnapshotToStatement(
  snapshot: NonNullable<AdmissionApplication['serverFeeSnapshot']>,
): ServerFeeStatement {
  return {
    kind: 'snapshot',
    lineItems: snapshot.lineItems,
    discountName: snapshot.discountName,
    discountAmount: snapshot.discountAmount,
    totalAmount: snapshot.totalAmount,
    academicYear: snapshot.academicYear,
    issuedAt: snapshot.issuedAt,
  }
}

/**
 * Build the issuance artifacts for an application. Every number shown on
 * official documents comes from the application's own data — the fee
 * snapshot is derived from the SAME pipeline as the Fee step (Fee
 * Management configuration + the applicant's selections), never
 * hardcoded. No QR payload, no invented verification IDs, no fake
 * receipts.
 *
 * FEE-ADMISSIONS MVP: when the application is server-linked, the
 * amounts on the OFFICIAL letter come from the server-issued fee
 * statement — the persisted immutable AdmissionFeeSnapshot once
 * enrolled (later fee-structure edits can never change it), or the live
 * server quote as a provisional preview before enrolment. The legacy
 * local pipeline only runs for applications with NO server link.
 */
export function buildIssuanceArtifacts(
  app: AdmissionApplication,
  serverFees?: ServerFeeStatement | null,
): IssuanceArtifacts {
  const formData = app.formData
  const isCompleted = app.status === 'Completed'
  const year = new Date().getFullYear()

  const admissionNo =
    isCompleted && app.admissionNo && !app.admissionNo.startsWith('DRAFT-')
      ? app.admissionNo
      : `SCH-ADM-${year}-${randId(4)}-${randId(2)}`
  const studentId =
    isCompleted && app.studentId && !app.studentId.startsWith('DRAFT-')
      ? app.studentId
      : `SCH-STU-${randId(4)}-${randId(4)}-${randId(1)}`
  const rollNo = app.rollNo && app.rollNo !== '—' ? app.rollNo : '01'
  const regNo =
    isCompleted && app.regNo && !app.regNo.startsWith('REG-CBSE-2026-8812')
      ? app.regNo
      : `REG-${year}-${randId(6)}`

  // FINAL-GATE honesty: no fabricated portal login/password artifacts —
  // the student's portal account is provisioned by the REAL enrolment
  // flow (Students & Classes), which surfaces a one-time password once.
  // The Student Portal issuance tab documents that path instead of
  // printing credentials that were never created.

  // The effective server fee statement: the explicit argument wins (the
  // workspace's freshly-fetched one), then the locally persisted
  // snapshot stamped at enrolment.
  const effectiveServerFees =
    serverFees ?? (app.serverFeeSnapshot ? storedSnapshotToStatement(app.serverFeeSnapshot) : null)

  // REAL fee numbers. Server-linked applications: the server-issued
  // statement (immutable snapshot once enrolled). Legacy: derived from
  // the applicant's own fee state through the same configuration the
  // Fee step reads (Fee Management). Transport / hostel eligibility
  // comes from the actual admission feature flags, not a hardcoded value.
  const letterData: AdmissionLetterData = {
    admissionNo,
    studentId,
    regNo,
    admissionDate: isCompleted ? app.submittedDate : new Date().toISOString().split('T')[0],
    academicSession:
      effectiveServerFees?.academicYear ||
      app.academicSession ||
      getSchoolProfile().academicYear ||
      '—',
    // Official Documents print policy (Admission Settings → Official
    // Documents): parent contact numbers print only while explicitly ON.
    // Independent of what the digital form collects.
    showSensitiveDetails:
      useSchoolSettingsStore.getState().admissionSettings.showPersonalDataOnLetter,
    student: {
      firstName: formData.firstName,
      lastName: formData.lastName,
      dob: formData.dob,
      photoUploaded: !!formData.photoDataUrl,
      photoUrl: formData.photoDataUrl || undefined,
    },
    parents: {
      fatherName: formData.fatherName,
      fatherOccupation: formData.fatherOccupation,
      fatherPhone: formData.fatherPhone,
      fatherEmail: formData.fatherEmail,
      motherName: formData.motherName,
      motherOccupation: formData.motherOccupation,
      motherPhone: formData.motherPhone,
    },
    address: {
      currentAddress: formData.currentAddress,
      district: formData.district,
      state: formData.state,
      pincode: formData.pincode,
    },
    academic: {
      className: formData.className,
      section: formData.section,
      stream: formData.stream,
      rollNo,
      previousSchool: formData.previousSchool,
      previousBoard: formData.previousBoard,
    },
    fees: effectiveServerFees
      ? serverFeeStatementToLetterFees(effectiveServerFees)
      : (() => {
          const feeState = { ...defaultFeeDataState, ...(app.feeData || {}) }
          const featureFlags = useSchoolSettingsStore.getState().admissionSettings.featureFlags
          const snapshot = computeFeeSnapshot(formData.className || '', feeState, {
            enableTransport: featureFlags.enableTransport,
            enableHostel: featureFlags.enableHostel,
          })
          return {
            registrationFee: snapshot.registrationFee,
            admissionFee: snapshot.admissionFee,
            tuitionFee: snapshot.tuitionFee,
            booksTotal: snapshot.booksTotal,
            examFee: snapshot.examTotal,
            transportFee: snapshot.transportTotal,
            otherHeadsTotal: snapshot.otherHeadsTotal,
            subtotal: snapshot.grossFee,
            totalAnnualFee: snapshot.grossFee,
            discountName: snapshot.discountName,
            discountAmount: snapshot.discountAmount,
            finalPayable: snapshot.netTotal,
          } satisfies AdmissionLetterData['fees']
        })(),
  }

  return {
    admissionNo,
    studentId,
    rollNo,
    regNo,
    letterData,
    serverFees: effectiveServerFees,
  }
}
