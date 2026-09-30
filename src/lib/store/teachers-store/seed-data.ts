import type { TeacherRecord } from './types'
import { teachers as MOCK_ROSTER } from '@/lib/mock/teachers'

/* ════════════════════════════════════════════════════════════════════
 * ⛔ RETIRED DEV REFERENCE — DO NOT IMPORT AT RUNTIME (Phase 7, Task 7-a)
 * ════════════════════════════════════════════════════════════════════
 * This file holds the FABRICATED 20-member faculty universe (Aadhaar
 * numbers, bank accounts, salaries, credentials, audit logs) that the
 * store seeded before Phase 7. It is kept ONLY as a historical dev
 * reference for schema/shape documentation. Nothing imports it:
 *   · store.ts starts EMPTY and hydrates from GET /api/teachers
 *     (see ./server-sync.ts — real tenant data, honest empty fields);
 *   · migrate.ts v6 purges persisted seed rows and never re-seeds;
 *   · audit-slice no longer imports INITIAL_AUDIT_LOGS.
 * If you need demo staff records, seed the DATABASE
 * (prisma/seed-teacher-*.ts) — the store follows the server.
 * ════════════════════════════════════════════════════════════════════ */

// Seed teachers list
export const SEED_TEACHERS: TeacherRecord[] = [
  {
    id: 'T-001',
    employeeId: 'EMP-001',
    teacherId: 'TCH-2025-001',
    name: 'Dr. Ananya Iyer',
    avatar: 'AI',
    gender: 'Female',
    dob: '1980-04-12',
    bloodGroup: 'O+',
    aadhaarNo: '9845 2019 3847',
    nationality: 'Indian',
    religion: 'Hindu',
    category: 'General',
    email: 'ananya.iyer@greenwood.edu.in',
    phone: '+91 98100 11223',
    emergencyContact: { name: 'Srinivasan Iyer', relation: 'Spouse', phone: '+91 98100 99887' },
    currentAddress: 'DLF Phase 3, Gurugram, Haryana',
    permAddress: 'DLF Phase 3, Gurugram, Haryana',
    sameAddress: true,
    district: 'Gurugram',
    state: 'Haryana',
    pincode: '122002',
    educationalQualifications: [
      { degree: 'Ph.D. Physics', specialization: 'Quantum Optics', institution: 'IIT Delhi', year: '2005', score: 'Doctorate' },
      { degree: 'M.Sc. Physics', specialization: 'Pure Physics', institution: 'Delhi University', year: '2001', score: '84.5%' },
    ],
    professionalQualifications: ['B.Ed (Gold Medalist)', 'M.Ed'],
    totalExperience: 24,
    keyAchievements: 'Published 8 research papers. Recipient of State Best Educator Award 2021.',
    previousEmployment: { organization: 'Modern School, Barakhamba Road', designation: 'Vice Principal', lastSalary: 150000, duration: '2010–2020' },
    joiningDate: '2001-06-15',
    employmentType: 'Full Time',
    department: 'Administration',
    designation: 'Principal',
    status: 'Active',
    attendance: 98,
    salary: 185000,
    salaryBreakdown: { basic: 92500, hra: 37000, da: 27750, specialAllowance: 18500, pfDeduction: 9250, netPay: 166500 },
    bankDetails: { bankName: 'HDFC Bank', accountNo: '50100293847102', ifscCode: 'HDFC0000240', branchName: 'DLF Phase 3' },
    subjects: ['Physics'],
    classes: [],
    examResponsibilities: ['Chief Controller of Examinations'],
    positions: [
      { id: 'pa-101', positionId: 'pos-vice-principal', positionTitle: 'Vice Principal', assignedDate: '2021-06-01', assignedBy: 'Board of Governors', status: 'Active', effectiveDate: '2021-06-01' },
    ],
    documents: [
      { id: 'doc-1', title: 'Ph.D Degree Certificate', category: 'Qualification', fileName: 'Phd_Degree_Ananya.pdf', uploadDate: '2021-06-15', status: 'Verified' },
      { id: 'doc-2', title: 'Aadhaar Card', category: 'ID Proof', fileName: 'Aadhaar_Ananya.pdf', uploadDate: '2021-06-15', status: 'Verified' },
    ],
    appointmentLetter: {
      id: 'APT-GWS-2021-001',
      officialLetterNo: "GWS/APT/2021/0001",
      generatedDate: '2001-06-10',
      teacherName: 'Dr. Ananya Iyer',
      employeeId: 'EMP-001',
      designation: 'Principal',
      department: 'Administration',
      joiningDate: '2001-06-15',
      monthlySalary: 185000,
      annualSalary: 2220000,
      workingHours: '08:00 AM – 04:00 PM',
      probationMonths: 6,
      noticePeriodDays: 90,
      termsAndConditions: [
        'Adherence to CBSE Code of Professional Ethics for School Principals.',
        'Full administrative authority over academic schedules, faculty evaluations, and student affairs.',
        'Confidentiality regarding institutional finances and board proceedings.',
      ],
      reportingAuthority: 'Board of Governors',
      principalName: 'Chairman, Board of Governors',
      schoolSealAttached: true,
      teacherAddress: 'DLF Phase 3, Gurugram, Haryana',
    },
    loginCredentials: { username: 'principal.ananya@greenwood.edu.in', tempPassword: 'GWS#Principal2025', passwordResetRequired: false, createdDate: '2021-06-15' },
  },
  {
    id: 'T-014',
    employeeId: 'EMP-014',
    teacherId: 'TCH-2025-014',
    name: 'Rohan Mehta',
    avatar: 'RM',
    gender: 'Male',
    dob: '1988-09-22',
    bloodGroup: 'A+',
    aadhaarNo: '4829 1029 3847',
    nationality: 'Indian',
    religion: 'Hindu',
    category: 'General',
    email: 'rohan.mehta@greenwood.edu.in',
    phone: '+91 98600 44556',
    emergencyContact: { name: 'Kavita Mehta', relation: 'Spouse', phone: '+91 98600 11223' },
    currentAddress: 'Sector 40, Gurugram, Haryana',
    permAddress: 'Sector 40, Gurugram, Haryana',
    sameAddress: true,
    district: 'Gurugram',
    state: 'Haryana',
    pincode: '122001',
    educationalQualifications: [
      { degree: 'M.Sc. Mathematics', specialization: 'Applied Math', institution: 'DU', year: '2010', score: '78.2%' },
      { degree: 'B.Sc. Mathematics', specialization: 'Mathematics', institution: 'Hansraj College', year: '2008', score: '81.0%' },
    ],
    professionalQualifications: ['B.Ed', 'CTET Paper II Cleared'],
    totalExperience: 9,
    keyAchievements: 'Coached National Math Olympiad winners in 2022.',
    previousEmployment: { organization: 'DPS Sushant Lok', designation: 'Mathematics Teacher', lastSalary: 52000, duration: '2012–2015' },
    joiningDate: '2015-06-01',
    employmentType: 'Full Time',
    department: 'Mathematics',
    designation: 'Senior Teacher',
    status: 'Active',
    attendance: 98,
    salary: 64000,
    salaryBreakdown: { basic: 32000, hra: 12800, da: 9600, specialAllowance: 6400, pfDeduction: 3200, netPay: 57600 },
    bankDetails: { bankName: 'ICICI Bank', accountNo: '002101589342', ifscCode: 'ICIC0000021', branchName: 'Sector 31' },
    subjects: ['Mathematics', 'Computer Science'],
    classes: ['Class 2-A', 'Class 2-B', 'Class 2-C'],
    examResponsibilities: ['Invigilator Math Mid-term'],
    positions: [
      { id: 'pa-102', positionId: 'pos-subject-teacher', positionTitle: 'Subject Teacher', assignedDate: '2015-06-01', assignedBy: 'Dr. Ananya Iyer', status: 'Active', effectiveDate: '2015-06-01' },
      { id: 'pa-103', positionId: 'pos-class-teacher', positionTitle: 'Class Teacher', assignedDate: '2023-04-01', assignedBy: 'Dr. Ananya Iyer', status: 'Active', effectiveDate: '2023-04-01' },
      { id: 'pa-104', positionId: 'pos-exam-incharge', positionTitle: 'Examination Incharge', assignedDate: '2026-07-20', assignedBy: 'Dr. Ananya Iyer', status: 'Pending Acceptance', effectiveDate: '2026-08-01' },
    ],
    documents: [
      { id: 'doc-10', title: 'M.Sc Degree Certificate', category: 'Qualification', fileName: 'MSc_Math_Rohan.pdf', uploadDate: '2015-06-01', status: 'Verified' },
      { id: 'doc-11', title: 'B.Ed Certificate', category: 'Qualification', fileName: 'BEd_Rohan.pdf', uploadDate: '2015-06-01', status: 'Verified' },
    ],
    appointmentLetter: {
      id: 'APT-GWS-2015-014',
      officialLetterNo: "GWS/APT/2015/0014",
      generatedDate: '2015-05-25',
      teacherName: 'Rohan Mehta',
      employeeId: 'EMP-014',
      designation: 'Senior Teacher',
      department: 'Mathematics',
      joiningDate: '2015-06-01',
      monthlySalary: 64000,
      annualSalary: 768000,
      workingHours: '08:00 AM – 03:30 PM',
      probationMonths: 12,
      noticePeriodDays: 60,
      termsAndConditions: [
        'Adherence to CBSE curriculum guidelines and lesson planning standards.',
        'Active participation in house activities and invigilation duties.',
        'Continuous professional development and workshop attendance.',
      ],
      principalName: 'Dr. Ananya Iyer',
      reportingAuthority: 'Dr. Ananya Iyer, Principal',
      schoolSealAttached: true,
      teacherAddress: 'Sector 40, Gurugram, Haryana',
    },
    loginCredentials: { username: 'rohan.mehta@greenwood.edu.in', tempPassword: 'GWS#Teacher2025', passwordResetRequired: false, createdDate: '2015-06-01' },
  },
]

// ─── Derived roster records ────────────────────────────────────────────
// The two records above (T-001, T-014) are fully-detailed primaries. Every
// OTHER teacher in the canonical mock roster is derived here so the
// Teachers module lists the same 20-member faculty that Timetable,
// Library, Messaging, Attendance and Payroll reference — one school, one
// roster, no phantom staff.
const DETAILED_IDS = new Set(['T-001', 'T-014'])

function pad(n: number, width = 3): string {
  return String(n).padStart(width, '0')
}

function numFromSeed(seed: string, min: number, max: number): number {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return min + (h % Math.max(1, max - min + 1))
}

function salaryBreakdown(gross: number) {
  const basic = Math.round(gross * 0.5)
  const hra = Math.round(gross * 0.2)
  const da = Math.round(gross * 0.15)
  const specialAllowance = gross - basic - hra - da
  const pfDeduction = Math.round(gross * 0.05)
  return { basic, hra, da, specialAllowance, pfDeduction, netPay: gross - pfDeduction }
}

const BANKS = [
  { bankName: 'HDFC Bank', ifscCode: 'HDFC0000240' },
  { bankName: 'ICICI Bank', ifscCode: 'ICIC0000021' },
  { bankName: 'State Bank of India', ifscCode: 'SBIN0001234' },
  { bankName: 'Axis Bank', ifscCode: 'UTIB0000456' },
  { bankName: 'Kotak Mahindra Bank', ifscCode: 'KKBK0000789' },
]

const RELIGIONS = ['Hindu', 'Hindu', 'Hindu', 'Muslim', 'Christian', 'Hindu', 'Sikh', 'Hindu']
const CATEGORY = ['General', 'General', 'OBC', 'General', 'SC', 'General', 'General', 'EWS']

function deriveTeacherRecord(mt: (typeof MOCK_ROSTER)[number], idx: number): TeacherRecord {
  const gross = mt.salary
  const bank = BANKS[idx % BANKS.length]
  const empNo = Number(mt.employeeId.replace(/\D/g, '')) || idx + 2
  const birthYear = 2025 - 25 - mt.experience
  return {
    id: mt.id,
    employeeId: mt.employeeId,
    teacherId: `TCH-2025-${pad(empNo)}`,
    name: mt.name,
    avatar: mt.avatar,
    gender: mt.gender,
    dob: `${birthYear}-${pad(numFromSeed(mt.id + 'm', 1, 12), 2)}-${pad(numFromSeed(mt.id + 'd', 1, 28), 2)}`,
    bloodGroup: mt.bloodGroup,
    aadhaarNo: `${numFromSeed(mt.id + 'a1', 1000, 9999)} ${numFromSeed(mt.id + 'a2', 1000, 9999)} ${numFromSeed(mt.id + 'a3', 1000, 9999)}`,
    nationality: 'Indian',
    religion: RELIGIONS[idx % RELIGIONS.length],
    category: CATEGORY[idx % CATEGORY.length],
    email: mt.email,
    phone: mt.phone,
    emergencyContact: {
      name: `${mt.name.split(' ').slice(-1)[0]} (Family)`,
      relation: 'Spouse',
      phone: `+91 98${pad(numFromSeed(mt.id + 'p', 100, 999))}0 ${pad(numFromSeed(mt.id + 'q', 10000, 99999), 5)}`,
    },
    currentAddress: mt.address,
    permAddress: mt.address,
    sameAddress: true,
    district: 'Gurugram',
    state: 'Haryana',
    pincode: String(numFromSeed(mt.id + 'pin', 122001, 122060)),
    educationalQualifications: [
      {
        degree: mt.qualification.split(',')[0].trim(),
        specialization: mt.subjects[0] ?? 'General',
        institution: 'Delhi University',
        year: String(birthYear + 22),
        score: `${numFromSeed(mt.id + 's', 70, 92)}.${numFromSeed(mt.id + 't', 0, 9)}%`,
      },
    ],
    professionalQualifications: ['B.Ed'],
    totalExperience: mt.experience,
    previousEmployment: {
      organization: 'Prior Institution, NCR',
      designation: 'Teacher',
      lastSalary: Math.round(gross * 0.75),
      duration: `${2005 + (idx % 5)}–${2010 + (idx % 5)}`,
    },
    joiningDate: mt.joiningDate,
    employmentType: 'Full Time',
    department: mt.department,
    designation: mt.designation,
    status: mt.status === 'On Leave' ? 'On Leave' : 'Active',
    attendance: mt.attendance,
    salary: gross,
    salaryBreakdown: salaryBreakdown(gross),
    bankDetails: {
      bankName: bank.bankName,
      accountNo: String(numFromSeed(mt.id + 'acc', 100000000, 999999999)),
      ifscCode: bank.ifscCode,
      branchName: 'Gurugram',
    },
    subjects: mt.subjects,
    classes: mt.classes,
    examResponsibilities: mt.classes.length ? [`Invigilator — ${mt.subjects[0]}`] : [],
    positions: mt.classes.slice(0, 1).map((c, i) => ({
      id: `pa-${mt.id}-${i}`,
      positionId: 'pos-class-teacher',
      positionTitle: 'Class Teacher',
      classAssigned: c,
      assignedDate: mt.joiningDate,
      assignedBy: 'Dr. Ananya Iyer',
      status: 'Active',
      effectiveDate: mt.joiningDate,
    })),
    documents: [
      {
        id: `doc-${mt.id}-1`,
        title: 'Degree Certificate',
        category: 'Qualification',
        fileName: `Degree_${mt.name.replace(/\s+/g, '_')}.pdf`,
        uploadDate: mt.joiningDate,
        status: 'Verified',
      },
      {
        id: `doc-${mt.id}-2`,
        title: 'Aadhaar Card',
        category: 'ID Proof',
        fileName: `Aadhaar_${mt.name.replace(/\s+/g, '_')}.pdf`,
        uploadDate: mt.joiningDate,
        status: 'Verified',
      },
    ],
    loginCredentials: {
      username: mt.email,
      tempPassword: 'GWS#Teacher2025',
      passwordResetRequired: false,
      createdDate: mt.joiningDate,
    },
  }
}

// Append the derived roster (skipping the two detailed primaries) so the
// module opens with the full faculty.
for (const [idx, mt] of MOCK_ROSTER.entries()) {
  if (DETAILED_IDS.has(mt.id)) continue
  if (mt.archived) continue
  SEED_TEACHERS.push(deriveTeacherRecord(mt, idx))
}

// Initial audit log entries seeded into the store on first load.
export const INITIAL_AUDIT_LOGS = [
  {
    id: 'log-1',
    timestamp: '2025-07-20T10:30:00Z',
    category: 'Teacher Created' as const,
    actorName: 'Dr. Ananya Iyer',
    actorRole: 'Principal',
    targetTeacherId: 'T-014',
    targetTeacherName: 'Rohan Mehta',
    details: 'Registered Rohan Mehta as Senior Teacher (Mathematics)',
  },
  {
    id: 'log-2',
    timestamp: '2025-07-20T11:15:00Z',
    category: 'Position Assigned' as const,
    actorName: 'Dr. Ananya Iyer',
    actorRole: 'Principal',
    targetTeacherId: 'T-014',
    targetTeacherName: 'Rohan Mehta',
    details: 'Assigned position: Examination Incharge (Pending Teacher Acceptance)',
  },
]
