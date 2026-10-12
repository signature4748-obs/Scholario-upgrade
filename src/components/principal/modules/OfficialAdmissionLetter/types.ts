export interface AdmissionLetterData {
  admissionNo: string
  refNo?: string
  studentId?: string
  regNo?: string
  admissionDate: string
  academicSession: string
  /** Official Documents print policy — when false (default), sensitive
   *  details such as parent contact numbers are excluded from the letter.
   *  Aadhaar / religion / category / blood group / medical are NEVER printed
   *  regardless of this flag (they are not part of the letter's data at all). */
  showSensitiveDetails?: boolean
  student: {
    firstName: string
    lastName: string
    dob: string
    photoUploaded?: boolean
    photoUrl?: string
  }
  parents: {
    fatherName: string
    fatherOccupation: string
    fatherPhone: string
    fatherEmail: string
    motherName: string
    motherOccupation: string
    motherPhone: string
  }
  address?: {
    currentAddress?: string
    district?: string
    state?: string
    pincode?: string
  }
  academic: {
    className: string
    section: string
    stream?: string
    rollNo?: string
    previousSchool?: string
    previousBoard?: string
  }
  fees: {
    /** THREE-STATE (PR-3 spec, findings F7/F8): an UNCONFIGURED head is
     *  undefined and renders "Not configured" — never a fabricated ₹0
     *  and never a fallback amount on an official document. */
    registrationFee?: number
    admissionFee?: number
    tuitionFee?: number
    annualCharges?: number
    activityFee?: number
    otherHeadsTotal?: number
    transportFee?: number
    examFee?: number
    booksTotal?: number
    selectedBooksTitles?: string[]
    subtotal?: number
    totalAnnualFee?: number
    discountName?: string
    discountApplied?: number
    discountAmount?: number
    finalPayable?: number
    paymentMethod?: string
  }
}

export interface OfficialAdmissionLetterProps {
  data: AdmissionLetterData
  onClose?: () => void
}
