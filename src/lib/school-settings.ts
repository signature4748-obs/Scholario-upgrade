// School Settings Engine for ERP & Admissions Module
// Multi-tenant, configurable, dynamic fee heads, books master, discount engine & letter visibility.

import { readIsDemoTenant } from '@/lib/store/demo-tenant'

export interface FeeHead {
  id: string
  name: string
  defaultAmount: number
  type: 'one-time' | 'annual' | 'monthly' | 'term'
  category: 'Registration' | 'Admission' | 'Tuition' | 'Development' | 'SmartClass' | 'Computer' | 'Lab' | 'Sports' | 'Activity' | 'Exam' | 'Other'
}

export interface BookItem {
  id: string
  title: string
  publisher: string
  price: number
  category: 'Textbook' | 'Reference' | 'Workbook' | 'Lab Manual'
  isMandatory: boolean
  className: string
}

export interface DiscountRule {
  id: string
  code: string
  name: string
  type: 'percentage' | 'fixed'
  value: number // e.g., 10 for 10% or 5000 for ₹5,000
  description: string
  category: 'FullYear' | 'HalfYear' | 'Sibling' | 'Scholarship' | 'Staff' | 'Special' | 'Custom'
}

export interface SchoolSettings {
  showDiscountBreakdown: boolean // Toggle for Official Admission Letter
  showFeeBreakdownOnLetter: boolean
  allowFamilyDoctorDetails: boolean // Super Admin feature flag for family doctor inputs
  allowHostel?: boolean
  defaultAcademicSession: string
  feeHeads: FeeHead[]
  booksMaster: BookItem[]
  discountRules: DiscountRule[]
  /** Exam fee amounts. UNDEFINED = not configured (three-state: a missing
   *  config must render "Not configured", never a fabricated ₹0/₹1000). */
  examFeeConfig?: {
    unitTestFee: number
    termExamFee: number
    customGroupsFee: number
  }
}

// Default School Settings Configuration (Database / Tenant Driven)
//
// FEE HONESTY (PR-3 spec, finding F5): the fee blocks below used to ship
// as fabricated defaults for EVERY tenant (₹1500/₹15000/₹60000 heads, 19
// invented book entries with real-sounding publishers, 6 discount rules,
// exam fees). They are now DEMO-TIER ONLY: `getSchoolSettings()` composes
// them exclusively for the demo tenant (School.isDemo). A REAL tenant
// gets EMPTY fee blocks — unconfigured heads must render "Not configured"
// (three-state), never fabricated amounts, per the PR-3 specification.
export const defaultSchoolSettings: SchoolSettings = {
  showDiscountBreakdown: true,
  showFeeBreakdownOnLetter: true,
  allowFamilyDoctorDetails: false, // Disabled by default as requested
  defaultAcademicSession: '2025–2026',
  feeHeads: [],
  booksMaster: [],
  discountRules: [],
}

/** DEMO-TIER fee corpus (School.isDemo only) — the sanctioned showcase
 *  numbers the demo admission wizard/documents display. */
export const demoFeeSettings: Pick<SchoolSettings, 'feeHeads' | 'booksMaster' | 'discountRules' | 'examFeeConfig'> = {
  feeHeads: [
    { id: 'FH-01', name: 'Registration Fee', defaultAmount: 1500, type: 'one-time', category: 'Registration' },
    { id: 'FH-02', name: 'Admission Fee', defaultAmount: 15000, type: 'one-time', category: 'Admission' },
    { id: 'FH-03', name: 'Monthly Tuition Fee (x12)', defaultAmount: 60000, type: 'annual', category: 'Tuition' },
    { id: 'FH-04', name: 'Annual Development Fee', defaultAmount: 5000, type: 'annual', category: 'Development' },
    { id: 'FH-05', name: 'Smart Class & Digital Tech', defaultAmount: 2400, type: 'annual', category: 'SmartClass' },
    { id: 'FH-06', name: 'Computer & Science Lab Fee', defaultAmount: 3000, type: 'annual', category: 'Lab' },
    { id: 'FH-07', name: 'Sports & Wellness Fee', defaultAmount: 1500, type: 'annual', category: 'Sports' },
    { id: 'FH-08', name: 'Co-Curricular Activity Fee', defaultAmount: 2000, type: 'annual', category: 'Activity' },
  ],
  booksMaster: [
    // Class 1 / Grade 1
    { id: 'BK-101', title: 'NCERT Marigold English Class 1', publisher: 'NCERT', price: 120, category: 'Textbook', isMandatory: true, className: 'Class 1' },
    { id: 'BK-102', title: 'NCERT Math Magic Class 1', publisher: 'NCERT', price: 140, category: 'Textbook', isMandatory: true, className: 'Class 1' },
    { id: 'BK-103', title: 'NCERT Rimjhim Hindi Class 1', publisher: 'NCERT', price: 110, category: 'Textbook', isMandatory: true, className: 'Class 1' },
    { id: 'BK-104', title: 'Oxford EVS Wonder World 1', publisher: 'Oxford University Press', price: 380, category: 'Reference', isMandatory: false, className: 'Class 1' },
    { id: 'BK-105', title: 'Camlin Creative Art & Craft 1', publisher: 'Camlin Kokuyo', price: 290, category: 'Workbook', isMandatory: false, className: 'Class 1' },

    // Class 2
    { id: 'BK-201', title: 'NCERT Marigold English Class 2', publisher: 'NCERT', price: 130, category: 'Textbook', isMandatory: true, className: 'Class 2' },
    { id: 'BK-202', title: 'NCERT Math Magic Class 2', publisher: 'NCERT', price: 150, category: 'Textbook', isMandatory: true, className: 'Class 2' },
    { id: 'BK-203', title: 'Oxford EVS Explorers 2', publisher: 'Oxford University Press', price: 400, category: 'Textbook', isMandatory: true, className: 'Class 2' },
    { id: 'BK-204', title: 'Candid Computer Science 2', publisher: 'Evergreen Publications', price: 320, category: 'Reference', isMandatory: false, className: 'Class 2' },

    // Grade 9
    { id: 'BK-901', title: 'NCERT Beehive & Moments English IX', publisher: 'NCERT', price: 180, category: 'Textbook', isMandatory: true, className: 'Grade 9' },
    { id: 'BK-902', title: 'NCERT Mathematics Grade 9', publisher: 'NCERT', price: 210, category: 'Textbook', isMandatory: true, className: 'Grade 9' },
    { id: 'BK-903', title: 'NCERT Science & Technology IX', publisher: 'NCERT', price: 240, category: 'Textbook', isMandatory: true, className: 'Grade 9' },
    { id: 'BK-904', title: 'S.Chand Conceptual Physics IX', publisher: 'S.Chand Publications', price: 480, category: 'Reference', isMandatory: false, className: 'Grade 9' },
    { id: 'BK-905', title: 'Dhanpat Rai Mathematics Foundation', publisher: 'Dhanpat Rai', price: 520, category: 'Reference', isMandatory: false, className: 'Grade 9' },

    // Grade 10
    { id: 'BK-001', title: 'NCERT First Flight English X', publisher: 'NCERT', price: 190, category: 'Textbook', isMandatory: true, className: 'Grade 10' },
    { id: 'BK-002', title: 'NCERT Mathematics Grade 10', publisher: 'NCERT', price: 220, category: 'Textbook', isMandatory: true, className: 'Grade 10' },
    { id: 'BK-003', title: 'NCERT Science & Tech Grade 10', publisher: 'NCERT', price: 250, category: 'Textbook', isMandatory: true, className: 'Grade 10' },
    { id: 'BK-004', title: 'RD Sharma Mathematics Grade 10', publisher: 'Dhanpat Rai', price: 680, category: 'Reference', isMandatory: false, className: 'Grade 10' },
    { id: 'BK-005', title: 'Together With Science Lab Manual X', publisher: 'Rachna Sagar', price: 390, category: 'Lab Manual', isMandatory: false, className: 'Grade 10' },
  ],
  discountRules: [
    { id: 'DISC-01', code: 'FULL_YEAR', name: 'Full Year Advance Payment Discount', type: 'percentage', value: 10, description: '10% concession on total fee when full academic fee is paid upfront', category: 'FullYear' },
    { id: 'DISC-02', code: 'HALF_YEAR', name: 'Half Year Advance Discount', type: 'percentage', value: 5, description: '5% concession for 6-month term advance payment', category: 'HalfYear' },
    { id: 'DISC-03', code: 'SIBLING', name: 'Sibling Concession', type: 'percentage', value: 15, description: '15% concession for second and subsequent siblings enrolled', category: 'Sibling' },
    { id: 'DISC-04', code: 'SCHOLARSHIP', name: 'Merit Scholarship / Entrance Award', type: 'percentage', value: 25, description: '25% tuition fee scholarship granted on academic excellence', category: 'Scholarship' },
    { id: 'DISC-05', code: 'STAFF_CHILD', name: 'Staff Dependent Concession', type: 'percentage', value: 50, description: '50% fee exemption for children of active school employees', category: 'Staff' },
    { id: 'DISC-06', code: 'PRINCIPAL_SPECIAL', name: 'Special Principal Discretionary Waiver', type: 'fixed', value: 5000, description: 'Special flat ₹5,000 waiver granted by Principal', category: 'Special' },
  ],
  examFeeConfig: {
    unitTestFee: 1000,
    termExamFee: 2000,
    customGroupsFee: 1000,
  },
}

// In-memory state, re-composed when the (async) demo signal changes —
// getSchoolSettings() can be called before /api/auth/me hydrates the
// current-user store, so a single frozen composition would pin the WRONG
// tier for the session (the demo tenant would keep the empty real-tenant
// blocks forever). The cache re-evaluates whenever the demo flag flips.
let currentSettings: SchoolSettings | null = null
let cachedDemoFlag: boolean | null = null

function composeSettings(): SchoolSettings {
  // DEMO-GATED: the fabricated fee corpus renders only for the demo
  // tenant; real tenants see honest empty fee configuration.
  return readIsDemoTenant()
    ? { ...defaultSchoolSettings, ...demoFeeSettings }
    : { ...defaultSchoolSettings }
}

export const getSchoolSettings = (): SchoolSettings => {
  const demo = readIsDemoTenant()
  if (!currentSettings || cachedDemoFlag !== demo) {
    cachedDemoFlag = demo
    currentSettings = composeSettings()
  }
  return currentSettings
}

/** Re-evaluate the demo gate (e.g. after login/tenant switch). */
export const resetSchoolSettingsCache = (): void => {
  currentSettings = null
  cachedDemoFlag = null
}

/** Explicit overrides (kept for compatibility): applied on top of the
 *  demo-gated composition. */
export const updateSchoolSettings = (newSettings: Partial<SchoolSettings>): SchoolSettings => {
  const base = currentSettings ?? composeSettings()
  currentSettings = { ...base, ...newSettings }
  return currentSettings
}
