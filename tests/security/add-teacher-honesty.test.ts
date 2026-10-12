/**
 * ADD-TEACHER-HONESTY — no fabricated enrichment on teacher creation (M2/M3/M4).
 *
 * The bugs this pins (principal-side audit):
 *
 *   M2 — the Add Teacher wizard's class/subject options came from the mock
 *        `classList` ("Grade 9", "Grade 10" — or a hardcoded 15-class
 *        fallback). At submit the wizard matched the mock name against the
 *        REAL /api/classes rows — silent mismatch → the class-teacher
 *        appointment failed with a toast.
 *   M3 — buildNewTeacherRecord fabricated enrichment onto the new
 *        teacher's profile: attendance 100, a 50/20/15/10/5 salary split,
 *        examResponsibilities ['Invigilator'], and a "Verified"
 *        Degree_Certificate.pdf document that was never uploaded.
 *   M4 — the Employment-edit dialog's Department dropdown listed the 2
 *        mock departments; use-teachers-actions toasted a fabricated
 *        persona ('Rohan Mehta') in its no-argument login fallback.
 *
 * Invariants under test (source contracts, fail-closed on drift):
 *
 *   1. M2: the mock classList import is GONE from add-teacher-data; the
 *      wizard fetches real classes (fetchSchoolClasses) and passes them
 *      as the options; the steps component consumes the fetched options.
 *   2. M3: buildNewTeacherRecord produces the HONEST enrichment defaults
 *      (attendance 0, empty salary breakdown, empty exam
 *      responsibilities, empty documents) — same defaults as the server
 *      mapping (mapServerTeacher).
 *   3. M4: the mock `departments` import is gone from
 *      profile-edit-dialogs (options derive from the real roster); the
 *      fabricated-persona login handler is gone from use-teachers-actions.
 */
import { describe, test, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { REPO_ROOT } from '../helpers/repo-root'
import { buildNewTeacherRecord, type AddTeacherForm } from '@/components/principal/modules/teachers/add-teacher-data'

const read = (p: string): string => readFileSync(join(REPO_ROOT, p), 'utf8')

const FORM: AddTeacherForm = {
  name: 'Test Teacher',
  gender: 'Female',
  dob: '1990-01-01',
  bloodGroup: 'B+',
  aadhaarNo: '',
  nationality: 'Indian',
  religion: '',
  category: 'General',
  email: 'test.teacher@hawkings.test',
  phone: '9876543210',
  emergencyName: '',
  emergencyRelation: '',
  emergencyPhone: '',
  currentAddress: '1 Test Street',
  permAddress: '',
  sameAddress: true,
  district: '',
  state: '',
  pincode: '',
  degree: 'M.Sc',
  specialization: 'Mathematics',
  institution: 'Test University',
  year: '2012',
  score: '78%',
  profQualifications: 'B.Ed',
  totalExperience: '5',
  keyAchievements: '',
  prevOrg: '',
  prevDesignation: '',
  prevSalary: '0',
  prevDuration: '',
  joiningDate: '2026-10-01',
  employmentType: 'Full Time',
  inchargePosition: 'None',
  classTeacherRole: 'None',
  assistantClassTeacherRole: 'None',
  salary: '50000',
  bankName: '',
  accountNo: '',
  ifscCode: '',
  branchName: '',
  selectedClasses: ['Grade 6 - A'],
  selectedSubjects: ['Mathematics'],
  remarks: '',
  photo: null,
  signature: null,
} as unknown as AddTeacherForm

// ─── 1. M2 — real class options ──────────────────────────────────────────

describe('ADD-TEACHER-HONESTY · M2 — class options are the school’s real classes', () => {
  test('add-teacher-data no longer imports the mock class catalog', () => {
    const src = read('src/components/principal/modules/teachers/add-teacher-data.ts')
    expect(src).not.toMatch(/from\s+'@\/lib\/mock\/school'/)
    expect(src).not.toContain('availableClassesList')
  })

  test('the wizard fetches real classes and passes them as the options', () => {
    const src = read('src/components/principal/modules/teachers/add-teacher-wizard.tsx')
    expect(src).toContain("import { fetchSchoolClasses } from '../admission/lib/server-classes'")
    expect(src).toMatch(/fetchSchoolClasses\(\)/)
    expect(src).toMatch(/const \[classOptions, setClassOptions\]/)
    // the fetched options are what Step 4 consumes
    expect(src).toMatch(/availableInchargePositions, classOptions,/)
    expect(src).not.toContain('availableClassesList')
  })

  test('the steps component consumes the fetched class options', () => {
    const src = read('src/components/principal/modules/teachers/add-teacher-steps.tsx')
    expect(src).toMatch(/classOptions: string\[\]/)
    expect(src).not.toContain('availableClassesList')
  })
})

// ─── 2. M3 — honest enrichment defaults ──────────────────────────────────

describe('ADD-TEACHER-HONESTY · M3 — buildNewTeacherRecord fabricates nothing', () => {
  const record = buildNewTeacherRecord(FORM)

  test('attendance is 0 (no attendance records exist yet — "No records")', () => {
    expect(record.attendance).toBe(0)
  })

  test('salary breakdown is empty (never the fabricated 50/20/15/10/5 split)', () => {
    expect(record.salaryBreakdown).toEqual({
      basic: 0, hra: 0, da: 0, specialAllowance: 0, pfDeduction: 0, netPay: 0,
    })
  })

  test('exam responsibilities are empty (never the fabricated Invigilator)', () => {
    expect(record.examResponsibilities).toEqual([])
  })

  test('documents are empty (never a fabricated "Verified" certificate)', () => {
    expect(record.documents).toEqual([])
  })

  test('the identity fields the wizard actually collected survive (regression)', () => {
    expect(record.name).toBe(FORM.name)
    expect(record.email).toBe(FORM.email)
    expect(record.salary).toBe(50000)
    expect(record.subjects).toEqual(['Mathematics'])
    expect(record.classes).toEqual(['Grade 6 - A'])
    expect(record.status).toBe('Active')
    expect(record.loginCredentials.tempPassword).toBe('')
  })
})

// ─── 3. M4 — dialogs + actions honesty ───────────────────────────────────

describe('ADD-TEACHER-HONESTY · M4 — dialogs and actions carry no mock personas', () => {
  test('profile-edit-dialogs derives departments from the real roster (mock import gone)', () => {
    const src = read('src/components/principal/modules/teachers/profile-edit-dialogs.tsx')
    expect(src).not.toMatch(/from\s+'@\/lib\/mock\/school'/)
    expect(src).toMatch(/departmentOptions/)
    expect(src).toMatch(/useTeachersStore\(\(s\) => s\.teachers\)/)
  })

  test('the fabricated-persona login handler is gone from use-teachers-actions', () => {
    const src = read('src/components/principal/modules/teachers/use-teachers-actions.ts')
    // The handler (and its fabricated-persona fallback) is gone — the
    // retirement comment may mention the name it removed.
    expect(src).not.toMatch(/const handleLoginAsTeacher/)
    expect(src).not.toMatch(/from '@\/lib\/store\/auth-store'/)
    expect(src).not.toMatch(/switchTo\('teacher'\)/)
  })
})
