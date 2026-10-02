/**
 * hawkings-corpus — the complete, DETERMINISTIC data definition for the
 * Hawkings High School Prithvipur demo tenant (final-acceptance Phase 1–9).
 *
 * PURE DATA + PURE GENERATION: no DB, no clock, no randomness — the same
 * roster is produced on every run, in every environments (local PG, CI,
 * production transform). Seeds plant it; tests can assert against the
 * derived counts. Re-running a seed built on this module can never
 * create duplicates or drift the corpus.
 *
 * Corpus shape (the final acceptance contract):
 *   · 15 classes — Nursery, LKG, IKG, 1–12 — exactly one section (A).
 *   · 80 students (5–6 per class), realistic Ghazipur-region identities:
 *     unique admission numbers, roll numbers, guardians, DOB coherent
 *     with class level, contacts, Prithvipur addresses, blood groups,
 *     deterministic initial avatars.
 *   · Compact faculty: 1 principal + 1 office (management) + 15 teachers
 *     (3 pre-primary, 5 primary class teachers, 7 subject specialists).
 *   · Canonical subject set (ENG/HIN/MAT/EVS/SCI/SST/SAN/PHY/CHE/BIO/CED
 *     + non-examinable DRW/GPE) with a per-class CSA matrix (teacher +
 *     periods/week) that respects realistic faculty loads.
 *   · Fee schedule by stage with mixed payment states; salary scales.
 */

import { DEMO_CLASS_LEVELS, DEMO_SCHOOL_EMAIL_DOMAIN } from './seed-identity'

// ─────────────────────────────────────────────────────────────────────────
// Deterministic PRNG (LCG — stable across runtimes, no seed dependence on
// the clock). All generated identity particulars derive from fixed seeds.
// ─────────────────────────────────────────────────────────────────────────

export function sr(seed: number): () => number {
  let s = seed % 2147483647
  if (s <= 0) s += 2147483646
  return () => {
    s = (s * 48271) % 2147483647
    return (s - 1) / 2147483646
  }
}
export const pick = <T>(rnd: () => number, arr: readonly T[]): T => arr[Math.floor(rnd() * arr.length)]
export const pickI = (rnd: () => number, min: number, max: number) => min + Math.floor(rnd() * (max - min + 1))

// ─────────────────────────────────────────────────────────────────────────
// STAFF — principal, office, faculty (Phase 4/5)
// ─────────────────────────────────────────────────────────────────────────

export const PRINCIPAL = {
  name: 'Dr. (Smt.) Sunita Verma',
  email: `principal@${DEMO_SCHOOL_EMAIL_DOMAIN}`,
  phone: '+91 94152 22101',
  qualification: 'M.Sc (Chemistry), Ph.D, B.Ed',
  joined: '2005-06-15',
} as const

export const MANAGEMENT = {
  name: 'Shri Dinesh Yadav',
  email: `management@${DEMO_SCHOOL_EMAIL_DOMAIN}`,
  phone: '+91 94152 22102',
  qualification: 'M.Com',
  joined: '2011-07-01',
  role: 'School office — fee collection, records, correspondence',
} as const

export interface FacultyDef {
  n: number
  name: string
  gender: 'MALE' | 'FEMALE'
  qualification: string
  department: string
  /** employeeId = HHS-T-0NN */
  salaryMonthly: number
  joined: string
  /** class key this teacher is the class teacher of ('Nursery'…'12') */
  classTeacherOf: string
  phone: string
}

export const FACULTY: FacultyDef[] = [
  // ── Pre-primary (Nursery/LKG/IKG class teachers) ───────────────────────
  { n: 1, name: 'Smt. Kavita Singh', gender: 'FEMALE', qualification: 'B.A, D.El.Ed', department: 'Primary', salaryMonthly: 12000, joined: '2014-07-01', classTeacherOf: '1', phone: '+91 94152 22201' },
  { n: 2, name: 'Shri Ramesh Chandra Yadav', gender: 'MALE', qualification: 'B.A, D.El.Ed', department: 'Primary', salaryMonthly: 11000, joined: '2016-07-01', classTeacherOf: '2', phone: '+91 94152 22202' },
  { n: 3, name: 'Smt. Meena Kumari', gender: 'FEMALE', qualification: 'B.Sc, D.El.Ed', department: 'Primary', salaryMonthly: 12500, joined: '2012-07-01', classTeacherOf: '3', phone: '+91 94152 22203' },
  { n: 4, name: 'Smt. Sushma Devi', gender: 'FEMALE', qualification: 'B.A, D.El.Ed', department: 'Primary', salaryMonthly: 11000, joined: '2018-07-01', classTeacherOf: '4', phone: '+91 94152 22204' },
  { n: 5, name: 'Shri Vinod Kumar', gender: 'MALE', qualification: 'B.Sc, B.Ed', department: 'Primary', salaryMonthly: 13500, joined: '2010-07-01', classTeacherOf: '5', phone: '+91 94152 22205' },
  { n: 6, name: 'Smt. Rekha Devi', gender: 'FEMALE', qualification: 'B.El.Ed', department: 'Pre-Primary', salaryMonthly: 8000, joined: '2019-07-01', classTeacherOf: 'Nursery', phone: '+91 94152 22206' },
  { n: 7, name: 'Smt. Sunita Yadav', gender: 'FEMALE', qualification: 'B.El.Ed', department: 'Pre-Primary', salaryMonthly: 8000, joined: '2021-07-01', classTeacherOf: 'LKG', phone: '+91 94152 22207' },
  { n: 8, name: 'Smt. Pooja Maurya', gender: 'FEMALE', qualification: 'B.El.Ed', department: 'Pre-Primary', salaryMonthly: 8500, joined: '2020-07-01', classTeacherOf: 'IKG', phone: '+91 94152 22208' },
  // ── Subject specialists (6–12) ─────────────────────────────────────────
  { n: 9, name: 'Shri Ajay Kumar Mishra', gender: 'MALE', qualification: 'M.Sc (Mathematics), B.Ed', department: 'Mathematics', salaryMonthly: 24000, joined: '2009-07-01', classTeacherOf: '6', phone: '+91 94152 22209' },
  { n: 10, name: 'Smt. Neha Gupta', gender: 'FEMALE', qualification: 'M.Sc (Botany), B.Ed', department: 'Science', salaryMonthly: 23000, joined: '2013-07-01', classTeacherOf: '7', phone: '+91 94152 22210' },
  { n: 11, name: 'Smt. Farzana Parveen', gender: 'FEMALE', qualification: 'M.A (English), B.Ed', department: 'English', salaryMonthly: 22000, joined: '2011-07-01', classTeacherOf: '8', phone: '+91 94152 22211' },
  { n: 12, name: 'Smt. Archana Pandey', gender: 'FEMALE', qualification: 'M.A (Hindi), Shastri, B.Ed', department: 'Hindi / Sanskrit', salaryMonthly: 21500, joined: '2008-07-01', classTeacherOf: '9', phone: '+91 94152 22212' },
  { n: 13, name: 'Shri Devendra Pratap Singh', gender: 'MALE', qualification: 'M.A (History), B.Ed', department: 'Social Science', salaryMonthly: 21000, joined: '2015-07-01', classTeacherOf: '10', phone: '+91 94152 22213' },
  { n: 14, name: 'Shri Sunil Kumar Yadav', gender: 'MALE', qualification: 'M.Sc (Physics), B.Ed', department: 'Science / Computer', salaryMonthly: 26000, joined: '2007-07-01', classTeacherOf: '11', phone: '+91 94152 22214' },
  { n: 15, name: 'Smt. Shabana Bano', gender: 'FEMALE', qualification: 'M.Sc (Chemistry), B.Ed', department: 'Science', salaryMonthly: 25000, joined: '2012-07-01', classTeacherOf: '12', phone: '+91 94152 22215' },
]

export const facultyByN = (n: number): FacultyDef => {
  const f = FACULTY.find((t) => t.n === n)
  if (!f) throw new Error(`hawkings-corpus: faculty #${n} missing`)
  return f
}
export const facultyEmail = (n: number): string => `teacher${n}@${DEMO_SCHOOL_EMAIL_DOMAIN}`

// ─────────────────────────────────────────────────────────────────────────
// SUBJECTS + the class-subject-assignment matrix (Phase 2)
// ─────────────────────────────────────────────────────────────────────────

export interface SubjectDef {
  code: string
  name: string
  examinable: boolean
}

export const SUBJECTS: SubjectDef[] = [
  { code: 'ENG', name: 'English', examinable: true },
  { code: 'HIN', name: 'Hindi', examinable: true },
  { code: 'MAT', name: 'Mathematics', examinable: true },
  { code: 'EVS', name: 'Environmental Studies', examinable: true },
  { code: 'SCI', name: 'Science', examinable: true },
  { code: 'SST', name: 'Social Science', examinable: true },
  { code: 'SAN', name: 'Sanskrit', examinable: true },
  { code: 'PHY', name: 'Physics', examinable: true },
  { code: 'CHE', name: 'Chemistry', examinable: true },
  { code: 'BIO', name: 'Biology', examinable: true },
  { code: 'CED', name: 'Computer Education', examinable: true },
  { code: 'DRW', name: 'Drawing', examinable: false },
  { code: 'GPE', name: 'Games & Physical Education', examinable: false },
]

export interface CSADef {
  /** class level key: 'Nursery' | 'LKG' | 'IKG' | '1'…'12' */
  level: string
  code: string
  teacherN: number
  periodsPerWeek: number
}

/**
 * The CSA matrix. In the pre-primary and primary wings the CLASS
 * TEACHER teaches every subject of her own class; from class 6 the
 * subject specialists take over (with the senior-science teachers
 * covering 9–12). Loads stay realistic: the busiest teacher (Mathematics
 * 6–12) carries 37 of 48 weekly slots; primary class teachers ~29.
 */
export const CSA_MATRIX: CSADef[] = [
  // Pre-primary — class teacher teaches all (activity-based timetable)
  { level: 'Nursery', code: 'ENG', teacherN: 6, periodsPerWeek: 6 },
  { level: 'Nursery', code: 'HIN', teacherN: 6, periodsPerWeek: 5 },
  { level: 'Nursery', code: 'MAT', teacherN: 6, periodsPerWeek: 4 },
  { level: 'Nursery', code: 'DRW', teacherN: 6, periodsPerWeek: 3 },
  { level: 'LKG', code: 'ENG', teacherN: 7, periodsPerWeek: 6 },
  { level: 'LKG', code: 'HIN', teacherN: 7, periodsPerWeek: 5 },
  { level: 'LKG', code: 'MAT', teacherN: 7, periodsPerWeek: 5 },
  { level: 'LKG', code: 'DRW', teacherN: 7, periodsPerWeek: 3 },
  { level: 'IKG', code: 'ENG', teacherN: 8, periodsPerWeek: 6 },
  { level: 'IKG', code: 'HIN', teacherN: 8, periodsPerWeek: 5 },
  { level: 'IKG', code: 'MAT', teacherN: 8, periodsPerWeek: 5 },
  { level: 'IKG', code: 'EVS', teacherN: 8, periodsPerWeek: 2 },
  { level: 'IKG', code: 'DRW', teacherN: 8, periodsPerWeek: 3 },

  // Primary 1–5 — class teacher teaches all
  { level: '1', code: 'ENG', teacherN: 1, periodsPerWeek: 7 },
  { level: '1', code: 'HIN', teacherN: 1, periodsPerWeek: 7 },
  { level: '1', code: 'MAT', teacherN: 1, periodsPerWeek: 7 },
  { level: '1', code: 'EVS', teacherN: 1, periodsPerWeek: 5 },
  { level: '1', code: 'DRW', teacherN: 1, periodsPerWeek: 3 },
  { level: '2', code: 'ENG', teacherN: 2, periodsPerWeek: 7 },
  { level: '2', code: 'HIN', teacherN: 2, periodsPerWeek: 7 },
  { level: '2', code: 'MAT', teacherN: 2, periodsPerWeek: 7 },
  { level: '2', code: 'EVS', teacherN: 2, periodsPerWeek: 5 },
  { level: '2', code: 'DRW', teacherN: 2, periodsPerWeek: 3 },
  { level: '3', code: 'ENG', teacherN: 3, periodsPerWeek: 7 },
  { level: '3', code: 'HIN', teacherN: 3, periodsPerWeek: 7 },
  { level: '3', code: 'MAT', teacherN: 3, periodsPerWeek: 7 },
  { level: '3', code: 'EVS', teacherN: 3, periodsPerWeek: 5 },
  { level: '3', code: 'DRW', teacherN: 3, periodsPerWeek: 3 },
  { level: '4', code: 'ENG', teacherN: 4, periodsPerWeek: 7 },
  { level: '4', code: 'HIN', teacherN: 4, periodsPerWeek: 7 },
  { level: '4', code: 'MAT', teacherN: 4, periodsPerWeek: 7 },
  { level: '4', code: 'EVS', teacherN: 4, periodsPerWeek: 5 },
  { level: '4', code: 'DRW', teacherN: 4, periodsPerWeek: 3 },
  { level: '5', code: 'ENG', teacherN: 5, periodsPerWeek: 6 },
  { level: '5', code: 'HIN', teacherN: 5, periodsPerWeek: 6 },
  { level: '5', code: 'MAT', teacherN: 5, periodsPerWeek: 7 },
  { level: '5', code: 'EVS', teacherN: 5, periodsPerWeek: 5 },
  { level: '5', code: 'DRW', teacherN: 5, periodsPerWeek: 2 },
  { level: '5', code: 'GPE', teacherN: 5, periodsPerWeek: 2 },

  // Middle 6–8 — specialists
  { level: '6', code: 'MAT', teacherN: 9, periodsPerWeek: 5 },
  { level: '6', code: 'SCI', teacherN: 10, periodsPerWeek: 5 },
  { level: '6', code: 'ENG', teacherN: 11, periodsPerWeek: 4 },
  { level: '6', code: 'HIN', teacherN: 12, periodsPerWeek: 4 },
  { level: '6', code: 'SST', teacherN: 13, periodsPerWeek: 4 },
  { level: '6', code: 'SAN', teacherN: 12, periodsPerWeek: 2 },
  { level: '6', code: 'GPE', teacherN: 13, periodsPerWeek: 2 },
  { level: '7', code: 'MAT', teacherN: 9, periodsPerWeek: 5 },
  { level: '7', code: 'SCI', teacherN: 10, periodsPerWeek: 5 },
  { level: '7', code: 'ENG', teacherN: 11, periodsPerWeek: 4 },
  { level: '7', code: 'HIN', teacherN: 12, periodsPerWeek: 4 },
  { level: '7', code: 'SST', teacherN: 13, periodsPerWeek: 4 },
  { level: '7', code: 'SAN', teacherN: 12, periodsPerWeek: 2 },
  { level: '7', code: 'GPE', teacherN: 13, periodsPerWeek: 2 },
  { level: '8', code: 'MAT', teacherN: 9, periodsPerWeek: 5 },
  { level: '8', code: 'SCI', teacherN: 10, periodsPerWeek: 5 },
  { level: '8', code: 'ENG', teacherN: 11, periodsPerWeek: 4 },
  { level: '8', code: 'HIN', teacherN: 12, periodsPerWeek: 4 },
  { level: '8', code: 'SST', teacherN: 13, periodsPerWeek: 4 },
  { level: '8', code: 'SAN', teacherN: 12, periodsPerWeek: 2 },
  { level: '8', code: 'GPE', teacherN: 13, periodsPerWeek: 2 },

  // Secondary 9–10
  { level: '9', code: 'MAT', teacherN: 9, periodsPerWeek: 6 },
  { level: '9', code: 'SCI', teacherN: 15, periodsPerWeek: 6 },
  { level: '9', code: 'ENG', teacherN: 11, periodsPerWeek: 5 },
  { level: '9', code: 'HIN', teacherN: 12, periodsPerWeek: 5 },
  { level: '9', code: 'SST', teacherN: 13, periodsPerWeek: 5 },
  { level: '9', code: 'CED', teacherN: 14, periodsPerWeek: 2 },
  { level: '9', code: 'GPE', teacherN: 13, periodsPerWeek: 1 },
  { level: '10', code: 'MAT', teacherN: 9, periodsPerWeek: 6 },
  { level: '10', code: 'SCI', teacherN: 15, periodsPerWeek: 6 },
  { level: '10', code: 'ENG', teacherN: 11, periodsPerWeek: 5 },
  { level: '10', code: 'HIN', teacherN: 12, periodsPerWeek: 5 },
  { level: '10', code: 'SST', teacherN: 13, periodsPerWeek: 5 },
  { level: '10', code: 'CED', teacherN: 14, periodsPerWeek: 2 },
  { level: '10', code: 'GPE', teacherN: 13, periodsPerWeek: 1 },

  // Senior secondary 11–12 (Science)
  { level: '11', code: 'PHY', teacherN: 14, periodsPerWeek: 6 },
  { level: '11', code: 'CHE', teacherN: 15, periodsPerWeek: 6 },
  { level: '11', code: 'MAT', teacherN: 9, periodsPerWeek: 5 },
  { level: '11', code: 'BIO', teacherN: 10, periodsPerWeek: 5 },
  { level: '11', code: 'ENG', teacherN: 11, periodsPerWeek: 4 },
  { level: '11', code: 'CED', teacherN: 14, periodsPerWeek: 2 },
  { level: '12', code: 'PHY', teacherN: 14, periodsPerWeek: 6 },
  { level: '12', code: 'CHE', teacherN: 15, periodsPerWeek: 6 },
  { level: '12', code: 'MAT', teacherN: 9, periodsPerWeek: 5 },
  { level: '12', code: 'BIO', teacherN: 10, periodsPerWeek: 5 },
  { level: '12', code: 'ENG', teacherN: 11, periodsPerWeek: 4 },
  { level: '12', code: 'CED', teacherN: 14, periodsPerWeek: 2 },
]

// ─────────────────────────────────────────────────────────────────────────
// STUDENTS — the deterministic 80-student roster (Phase 3)
// ─────────────────────────────────────────────────────────────────────────

const MALE_FIRST = [
  'Aarav', 'Aditya', 'Arjun', 'Krishna', 'Mohan', 'Sohan', 'Ram', 'Shyam', 'Vijay', 'Ajay',
  'Abhay', 'Aman', 'Anand', 'Chandan', 'Danish', 'Imran', 'Irfan', 'Kaif', 'Salman', 'Sahil',
  'Sonu', 'Monu', 'Rahul', 'Rohit', 'Vikas', 'Dinesh', 'Ganesh', 'Kartik', 'Ravi', 'Sunil',
  'Deepak', 'Mukesh', 'Suresh', 'Nitesh', 'Harsh', 'Ashish', 'Vivek', 'Manish', 'Sachin', 'Golu',
  'Uday', 'Pranav', 'Devansh', 'Ayaan', 'Vedant', 'Rudra', 'Atharv', 'Karan', 'Nakul', 'Ishaan',
] as const
const FEMALE_FIRST = [
  'Anjali', 'Sunita', 'Pooja', 'Priya', 'Radha', 'Rani', 'Rita', 'Sita', 'Gita', 'Kajal',
  'Kiran', 'Kajri', 'Nisha', 'Neha', 'Reena', 'Sana', 'Sameena', 'Shabnam', 'Zainab', 'Fatima',
  'Ayesha', 'Chandni', 'Muskan', 'Simran', 'Sneha', 'Riya', 'Priyanka', 'Khushi', 'Jyoti', 'Arti',
  'Kavita', 'Babli', 'Roshni', 'Anshu', 'Mahima', 'Aditi', 'Nidhi', 'Shalini', 'Preeti', 'Divya',
  'Aarohi', 'Isha', 'Myra', 'Anvi', 'Pihu', 'Gauri', 'Ira', 'Vanya', 'Yamini', 'Avni',
] as const
const LAST: readonly string[] = [
  'Singh', 'Yadav', 'Kumar', 'Verma', 'Gupta', 'Mishra', 'Tiwari', 'Pandey', 'Maurya', 'Kushwaha',
  'Chauhan', 'Rajbhar', 'Prajapati', 'Sah', 'Jaiswal', 'Dubey', 'Alam', 'Khan', 'Ansari', 'Shah',
  'Ram', 'Prasad', 'Pratap', 'Gautam', 'Sahu', 'Bhardwaj', 'Dwivedi', 'Upadhyay', 'Kashyap', 'Bhatt',
]
const FATHER_FIRST = [
  'Ramesh', 'Mahesh', 'Suresh', 'Dinesh', 'Rajesh', 'Mukesh', 'Ramesh Chandra', 'Ram Prakash', 'Shyam Sundar', 'Krishna Kumar',
  'Mohammad', 'Ishtiyaq', 'Nasim', 'Anis', 'Omkar', 'Upendra', 'Devendra', 'Ravindra', 'Brajesh', 'Manoj',
  'Santosh', 'Chhotelal', 'Ramashish', 'Vishwanath', 'Hariom', 'Lal Bahadur', 'Girish', 'Nandlal', 'Jitendra', 'Satyendra',
] as const
const MOTHER_FIRST = [
  'Sunita', 'Geeta', 'Rekha', 'Sushma', 'Meena', 'Pooja', 'Kavita', 'Anita', 'Sarita', 'Munni',
  'Farzana', 'Rukhsana', 'Shabana', 'Zainab', 'Ayesha', 'Nirmala', 'Urmila', 'Kiran', 'Gyanvati', 'Phoolmati',
] as const
const LOCALITIES = [
  'Ward 1, Near Gram Panchayat Bhawan, Prithvipur, Ghazipur — 233226',
  'Ward 2, Station Road, Prithvipur, Ghazipur — 233226',
  'Ward 3, Main Market Road, Prithvipur, Ghazipur — 233226',
  'Ward 4, Near Hanuman Mandir, Prithvipur, Ghazipur — 233226',
  'Kasmipur Road, Prithvipur, Ghazipur — 233226',
  'Near Block Development Office, Prithvipur, Ghazipur — 233226',
  'Chandwak Road, Prithvipur, Ghazipur — 233226',
  'Bhadaura Road, Prithvipur, Ghazipur — 233226',
  'Post — Prithvipur, Ghazipur — 233226',
  'Near Primary Health Centre, Prithvipur, Ghazipur — 233226',
  'Vishesharpur, Post Prithvipur, Ghazipur — 233226',
  'Saidpur Karwat, Post Prithvipur, Ghazipur — 233226',
] as const
const BLOOD = ['A+', 'B+', 'O+', 'AB+', 'A-', 'B-'] as const

/** Students per class level — sums to exactly 80. */
const CLASS_SIZES: Record<string, number> = {
  Nursery: 6, LKG: 6, IKG: 5,
  '1': 5, '2': 6, '3': 5, '4': 5, '5': 5,
  '6': 5, '7': 5, '8': 5,
  '9': 6, '10': 6,
  '11': 5, '12': 5,
}

/**
 * Sibling pairs — intentionally modelled (a real school has families
 * across levels). Each entry shares one guardian account: [classA#idxA,
 * classB#idxB, family last name, father, mother].
 */
const SIBLING_PAIRS: [string, number, string, number, string, string, string][] = [
  ['5', 1, '1', 2, 'Kumar', 'Ramashish Kumar', 'Phoolmati Devi'],
  ['8', 0, '3', 1, 'Yadav', 'Chhotelal Yadav', 'Munni Devi'],
  ['11', 2, '6', 3, 'Mishra', 'Vishwanath Mishra', 'Kiran Mishra'],
  ['9', 4, '12', 0, 'Khan', 'Ishtiyaq Khan', 'Rukhsana Khan'],
  ['Nursery', 5, 'IKG', 2, 'Singh', 'Hariom Singh', 'Sushma Singh'],
]

export interface RosterStudentDef {
  /** class level key ('Nursery'…'12') */
  level: string
  classLabel: string
  /** 0-based index within the class (roll = idx+1) */
  idx: number
  rollNo: string
  admissionNo: string
  name: string
  gender: 'MALE' | 'FEMALE'
  dob: string
  father: string
  mother: string
  guardianName: string
  guardianPhone: string
  guardianEmail: string
  studentEmail: string
  studentPhone: string | null
  address: string
  bloodGroup: string
  /** years enrolled (drives the admission year encoded in admissionNo) */
  yearsEnrolled: number
}

/** Build the deterministic 80-student roster (pure — no DB, no clock). */
export function buildStudentRoster(): RosterStudentDef[] {
  const usedNames = new Set<string>()
  const usedEmails = new Set<string>()
  const usedAdmission = new Set<string>()
  const roster: RosterStudentDef[] = []

  // Pre-assign the sibling families so every member gets identical
  // guardian particulars.
  const familyFor = new Map<string, { last: string; father: string; mother: string; phone: string; email: string }>()
  for (const [la, ia, lb, ib, last, father, mother] of SIBLING_PAIRS) {
    const rndFam = sr(910000 + la.length * 31 + ia + ib * 7 + last.length)
    const phone = `+91 9${pickI(rndFam, 400000000, 899999999)}`
    const email = uniqueEmail(`${father.split(' ')[0].toLowerCase()}.${last.toLowerCase()}`, 'gmail.com', usedEmails, rndFam)
    for (const k of [`${la}#${ia}`, `${lb}#${ib}`]) {
      familyFor.set(k, { last, father, mother, phone, email })
    }
  }

  let seq = 0 // global deterministic ordering (drives phones)
  for (const lv of DEMO_CLASS_LEVELS) {
    const size = CLASS_SIZES[lv.key] ?? 5
    const numeric = Number(lv.key)
    const isPrePrimary = !Number.isFinite(numeric)
    for (let i = 0; i < size; i++) {
      seq += 1
      const rnd = sr(seq * 7919)
      const famKey = `${lv.key}#${i}`
      const fam = familyFor.get(famKey)

      const gender: 'MALE' | 'FEMALE' = rnd() > 0.48 ? 'MALE' : 'FEMALE'
      const first = gender === 'MALE' ? pick(rnd, MALE_FIRST) : pick(rnd, FEMALE_FIRST)
      let last = fam?.last ?? pick(rnd, LAST)
      if (!fam) {
        while (usedNames.has(`${first} ${last}`)) last = LAST[(LAST.indexOf(last) + 1) % LAST.length]
      }
      const name = `${first} ${last}`
      usedNames.add(name)

      // Father/mother: shared for siblings, generated otherwise.
      const fatherFirst = fam ? fam.father.split(' ')[0] : pick(rnd, FATHER_FIRST)
      const father = fam?.father ?? `${fatherFirst} ${last}`
      const mother = fam?.mother ?? `${pick(rnd, MOTHER_FIRST)} Devi`

      // DOB coherent with the class level (session 2026-27 started
      // April 2026): class N → birth year ≈ 2026 − (N + 5); pre-primary
      // Nursery/LKG/IKG → 2023/2022/2021 (± up to 1 year).
      const birthYear = isPrePrimary
        ? { Nursery: 2023, LKG: 2022, IKG: 2021 }[lv.key as 'Nursery' | 'LKG' | 'IKG'] - pickI(rnd, 0, 1)
        : 2026 - (numeric + 5) - pickI(rnd, 0, 1)
      const dob = `${birthYear}-${String(pickI(rnd, 1, 12)).padStart(2, '0')}-${String(pickI(rnd, 1, 28)).padStart(2, '0')}`

      // Years enrolled: 1..min(levelIndex+1, 6) → admission year.
      const levelIndex = DEMO_CLASS_LEVELS.findIndex((c) => c.key === lv.key)
      const yearsEnrolled = pickI(rnd, 1, Math.min(levelIndex + 1, 6))
      const admissionYear = 2026 - yearsEnrolled
      let admissionNo = `HHSP-${admissionYear}-${String(seq).padStart(3, '0')}`
      while (usedAdmission.has(admissionNo)) admissionNo = `${admissionNo}A`
      usedAdmission.add(admissionNo)

      const studentEmail = uniqueEmail(`${first}.${last}`.toLowerCase(), DEMO_SCHOOL_EMAIL_DOMAIN, usedEmails, rnd)
      // Seniors (6+) carry their own mobile; juniors use the guardian's.
      const studentPhone = !isPrePrimary && numeric >= 6
        ? `+91 9${pickI(rnd, 600000000, 899999999)}`
        : null
      const guardianPhone = fam?.phone ?? `+91 9${pickI(rnd, 400000000, 599999999)}`

      roster.push({
        level: lv.key,
        classLabel: lv.label,
        idx: i,
        rollNo: String(i + 1).padStart(2, '0'),
        admissionNo,
        name,
        gender,
        dob,
        father,
        mother,
        guardianName: `Shri ${father}`,
        guardianPhone,
        guardianEmail: fam?.email ?? uniqueEmail(`${fatherFirst.replace(/\s.*/, '').toLowerCase()}.${last.toLowerCase()}`, 'gmail.com', usedEmails, rnd),
        studentEmail,
        studentPhone,
        address: `${pick(rnd, LOCALITIES)}`,
        bloodGroup: pick(rnd, BLOOD),
        yearsEnrolled,
      })
    }
  }
  return roster
}

function uniqueEmail(base: string, domain: string, used: Set<string>, rnd: () => number): string {
  let email = `${base}@${domain}`
  while (used.has(email)) email = `${base}${pickI(rnd, 2, 99)}@${domain}`
  used.add(email)
  return email
}

// ─────────────────────────────────────────────────────────────────────────
// FEES — stage-based schedule + per-student state mix (Phase 9)
// ─────────────────────────────────────────────────────────────────────────

export interface FeeStageDef {
  tuitionTerm: number
  annual: number
  examTerm: number
}

/** Term fee schedule by stage (session 2026-27, term = 4 months). */
export function feeStageFor(level: string): FeeStageDef {
  const n = Number(level)
  if (!Number.isFinite(n)) return { tuitionTerm: 3200, annual: 2000, examTerm: 200 } // pre-primary
  if (n <= 5) return { tuitionTerm: 4000, annual: 2500, examTerm: 300 }
  if (n <= 8) return { tuitionTerm: 4800, annual: 3000, examTerm: 400 }
  if (n <= 10) return { tuitionTerm: 6000, annual: 3500, examTerm: 500 }
  return { tuitionTerm: 7200, annual: 4000, examTerm: 600 }
}

/**
 * Per-student fee state mix (deterministic; drives Fee + Payment +
 * FeeTransaction rows so dashboards reconcile with the ledger):
 *
 *   annual      → 95% PAID (verified, receipted)
 *   tuition T1  → 70% PAID · 15% PARTIAL · 15% UNPAID (past due → overdue)
 *   exam T1     → 60% PAID · 8% PENDING-VERIFICATION · 32% UNPAID
 *   tuition T2  → 10% PARTIAL · 90% UNPAID (just billed)
 */
export type FeeStateShape = 'PAID' | 'PARTIAL' | 'UNPAID' | 'PENDING_VERIFY'

export function feeShapeFor(studentSeq: number): {
  annual: FeeStateShape
  tuitionT1: FeeStateShape
  examT1: FeeStateShape
  tuitionT2: FeeStateShape
  partialFraction: number
} {
  const r = studentSeq % 20
  return {
    annual: r === 3 ? 'UNPAID' : 'PAID',
    tuitionT1: r % 7 === 0 ? 'PARTIAL' : r % 13 === 0 ? 'UNPAID' : 'PAID',
    examT1: r % 12 === 0 ? 'PENDING_VERIFY' : r % 3 === 0 ? 'UNPAID' : 'PAID',
    tuitionT2: r % 10 === 0 ? 'PARTIAL' : 'UNPAID',
    partialFraction: [0.4, 0.5, 0.6][r % 3],
  }
}

// ─────────────────────────────────────────────────────────────────────────
// ROOMS — homerooms + special rooms (Phase 6)
// ─────────────────────────────────────────────────────────────────────────

export const SPECIAL_ROOMS = [
  { name: 'Science Lab', code: 'RM-SLAB', type: 'Science Lab', capacity: 30 },
  { name: 'Computer Lab', code: 'RM-CLAB', type: 'Computer Lab', capacity: 24 },
  { name: 'Library', code: 'RM-LIB', type: 'Library', capacity: 40 },
  { name: 'Staff Room', code: 'RM-STAFF', type: 'Staff Room', capacity: 20 },
  { name: "Principal's Office", code: 'RM-POFF', type: 'Other', capacity: 4 },
] as const

// ─────────────────────────────────────────────────────────────────────────
// Derived counts (the acceptance contract)
// ─────────────────────────────────────────────────────────────────────────

export const ROSTER_SIZE = buildStudentRoster().length
export const CLASS_COUNT = DEMO_CLASS_LEVELS.length
export const CSA_COUNT = CSA_MATRIX.length
export const TEACHER_COUNT = FACULTY.length
