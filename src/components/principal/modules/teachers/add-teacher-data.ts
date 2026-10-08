// Static data, initial form state, and the buildNewTeacherRecord helper
// for the Add Teacher wizard. Kept separate so the wizard component
// file stays under the 300-line budget.

import { classList } from '@/lib/mock/school'
import type {
  TeacherRecord,
  PositionAssignment,
  TeacherMediaRecord,
} from '@/lib/store/teachers-store'
import { createAppointmentLetterSnapshot } from '@/lib/store/teachers-store/letter-factory'

export const availableClassesList: string[] = (classList && classList.length > 0)
  ? classList.map((c) => (typeof c === 'string' ? c : c.name))
  : [
      'Nursery', 'LKG', 'UKG',
      'Class 1-A', 'Class 2-A', 'Class 3-A', 'Class 4-A', 'Class 5-A',
      'Class 6-A', 'Class 7-A', 'Class 8-A', 'Class 9-A', 'Class 10-A',
      'Class 11-A', 'Class 12-A',
    ]

export const subjectList: string[] = [
  'Mathematics', 'Physics', 'Chemistry', 'Biology', 'Science', 'English',
  'Hindi', 'Social Studies', 'History', 'Geography', 'Computer Science',
  'Economics', 'Business Studies', 'Accountancy', 'Physical Education',
  'Art & Craft', 'EVS', 'Music/Dance',
]

export const masterInchargePositions: string[] = [
  'Examination Incharge',
  'Sports Incharge',
  'Discipline Incharge',
  'Cultural Coordinator',
  'Transport Incharge',
  'Laboratory Incharge',
  'Library Incharge',
  'Time Table Coordinator',
  'Academic Incharge',
  'Fee & Scholarship Incharge',
  'House Master / Mistress',
]

export const allPermissions = [
  { key: 'view_assigned_classes', label: 'View Assigned Classes' },
  { key: 'enter_subject_marks', label: 'Enter Subject Marks' },
  { key: 'take_class_attendance', label: 'Take Class Attendance' },
  { key: 'view_own_timetable', label: 'View Own Timetable' },
  { key: 'view_full_class_profile', label: 'View Full Class Profile' },
  { key: 'generate_marksheets', label: 'Generate Marksheets' },
  { key: 'manage_school_exams', label: 'Manage School Exams' },
  { key: 'manage_discipline', label: 'Manage Discipline Notes' },
  { key: 'manage_sports', label: 'Manage Sports Rosters' },
  { key: 'manage_transports', label: 'Manage Transport Routes' },
  { key: 'manage_timetable', label: 'Master Timetable Editing' },
  { key: 'admin_broad_access', label: 'Broad Administrative Access' },
]

export interface AddTeacherForm {
  name: string; gender: 'Male' | 'Female'; dob: string; bloodGroup: string
  aadhaarNo: string; nationality: string; religion: string; category: string
  email: string; phone: string
  emergencyName: string; emergencyRelation: string; emergencyPhone: string
  currentAddress: string; permAddress: string; sameAddress: boolean
  district: string; state: string; pincode: string
  degree: string; specialization: string; institution: string
  year: string; score: string; profQualifications: string
  totalExperience: number; keyAchievements: string
  prevOrg: string; prevDesignation: string; prevSalary: number; prevDuration: string
  joiningDate: string; employmentType: 'Full Time' | 'Part Time' | 'Probation'
  salary: number; bankName: string; accountNo: string; ifscCode: string; branchName: string
  inchargePosition: string; classTeacherRole: string; assistantClassTeacherRole: string
  selectedClasses: string[]; selectedSubjects: string[]; remarks: string
  /** Server-stored photo media record (uploaded + validated via API). */
  photo: TeacherMediaRecord | null
  /** Server-stored signature media record. */
  signature: TeacherMediaRecord | null
}

export const initialFormState: AddTeacherForm = {
  name: '',
  gender: 'Male',
  dob: '',
  bloodGroup: '',
  aadhaarNo: '',
  nationality: 'Indian',
  religion: '',
  category: '',
  email: '',
  phone: '',
  emergencyName: '',
  emergencyRelation: 'Father',
  emergencyPhone: '',
  currentAddress: '',
  permAddress: '',
  sameAddress: true,
  district: '',
  state: '',
  pincode: '',
  degree: '',
  specialization: '',
  institution: '',
  year: '',
  score: '',
  profQualifications: '',
  totalExperience: 0,
  keyAchievements: '',
  prevOrg: '',
  prevDesignation: '',
  prevSalary: 0,
  prevDuration: '',
  joiningDate: '',
  employmentType: 'Full Time',
  salary: 0,
  bankName: '',
  accountNo: '',
  ifscCode: '',
  branchName: '',
  inchargePosition: 'None',
  classTeacherRole: 'None',
  assistantClassTeacherRole: 'None',
  selectedClasses: [],
  selectedSubjects: [],
  remarks: '',
  photo: null,
  signature: null,
}

/**
 * Build a fully-formed TeacherRecord (with positions, salary breakdown,
 * appointment letter, and login credentials) from the wizard form state.
 */
export function buildNewTeacherRecord(form: AddTeacherForm): TeacherRecord {
  const seq = String(Math.floor(100 + Math.random() * 899))
  const empId = `EMP-${seq}`
  const teacherId = `TCH-2025-${seq}`
  const basic = Math.round(form.salary * 0.5)
  const hra = Math.round(form.salary * 0.2)
  const da = Math.round(form.salary * 0.15)
  const sa = Math.round(form.salary * 0.1)
  const pf = Math.round(form.salary * 0.05)

  const finalDepartment = form.inchargePosition !== 'None' ? form.inchargePosition : 'Academic'
  const finalDesignation = form.classTeacherRole !== 'None'
    ? `Class Teacher (${form.classTeacherRole})`
    : form.inchargePosition !== 'None'
      ? form.inchargePosition
      : 'Subject Teacher'

  const initPositions: PositionAssignment[] = [
    {
      id: `pa-init-${seq}`,
      positionId: 'pos-subject-teacher',
      positionTitle: 'Subject Teacher',
      assignedDate: new Date().toISOString().split('T')[0],
      assignedBy: 'Dr. Ananya Iyer',
      status: 'Active',
      effectiveDate: form.joiningDate,
    },
  ]

  if (form.inchargePosition !== 'None') {
    initPositions.push({
      id: `pa-inc-${seq}`,
      positionId: `pos-inc-${form.inchargePosition.toLowerCase().replace(/\s+/g, '-')}`,
      positionTitle: form.inchargePosition,
      assignedDate: new Date().toISOString().split('T')[0],
      assignedBy: 'Dr. Ananya Iyer',
      status: 'Active',
      effectiveDate: form.joiningDate,
    })
  }

  if (form.classTeacherRole !== 'None') {
    initPositions.push({
      id: `pa-ct-${seq}`,
      positionId: 'pos-class-teacher',
      positionTitle: `Class Teacher (${form.classTeacherRole})`,
      assignedDate: new Date().toISOString().split('T')[0],
      assignedBy: 'Dr. Ananya Iyer',
      status: 'Active',
      effectiveDate: form.joiningDate,
    })
  }

  if (form.assistantClassTeacherRole !== 'None') {
    initPositions.push({
      id: `pa-act-${seq}`,
      positionId: 'pos-asst-class-teacher',
      positionTitle: `Assistant Class Teacher (${form.assistantClassTeacherRole})`,
      assignedDate: new Date().toISOString().split('T')[0],
      assignedBy: 'Dr. Ananya Iyer',
      status: 'Active',
      effectiveDate: form.joiningDate,
    })
  }

  return {
    id: `T-${seq}`,
    employeeId: empId,
    teacherId,
    name: form.name,
    avatar: form.name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase(),
    gender: form.gender,
    dob: form.dob,
    bloodGroup: form.bloodGroup,
    aadhaarNo: form.aadhaarNo,
    nationality: form.nationality,
    religion: form.religion,
    category: form.category,
    email: form.email,
    phone: form.phone,
    emergencyContact: { name: form.emergencyName, relation: form.emergencyRelation, phone: form.emergencyPhone },
    currentAddress: form.currentAddress,
    permAddress: form.sameAddress ? form.currentAddress : form.permAddress,
    sameAddress: form.sameAddress,
    district: form.district,
    state: form.state,
    pincode: form.pincode,
    educationalQualifications: [{ degree: form.degree, specialization: form.specialization, institution: form.institution, year: form.year, score: form.score }],
    professionalQualifications: form.profQualifications.split(',').map((s) => s.trim()).filter(Boolean),
    totalExperience: Number(form.totalExperience),
    keyAchievements: form.keyAchievements,
    previousEmployment: { organization: form.prevOrg, designation: form.prevDesignation, lastSalary: Number(form.prevSalary), duration: form.prevDuration },
    joiningDate: form.joiningDate,
    employmentType: form.employmentType,
    department: finalDepartment,
    designation: finalDesignation,
    status: 'Active',
    attendance: 100,
    salary: Number(form.salary),
    salaryBreakdown: { basic, hra, da, specialAllowance: sa, pfDeduction: pf, netPay: form.salary - pf },
    bankDetails: { bankName: form.bankName, accountNo: form.accountNo, ifscCode: form.ifscCode, branchName: form.branchName },
    subjects: form.selectedSubjects,
    classes: form.selectedClasses,
    examResponsibilities: ['Invigilator'],
    positions: initPositions,
    photo: form.photo ?? undefined,
    signature: form.signature ?? undefined,
    documents: [
      { id: `doc-${seq}-1`, title: 'Educational Qualification Certificate', category: 'Qualification', fileName: 'Degree_Certificate.pdf', uploadDate: new Date().toISOString().split('T')[0], status: 'Verified' },
    ],
    appointmentLetter: createAppointmentLetterSnapshot({
      employeeId: empId,
      teacherName: form.name,
      designation: finalDesignation,
      department: finalDepartment,
      joiningDate: form.joiningDate,
      monthlySalary: Number(form.salary),
      teacherAddress: form.currentAddress,
      issueSeq: 1,
    }),
    loginCredentials: {
      username: form.email,
      // NEVER fabricated: the real one-time credential is generated
      // server-side by POST /api/teachers and surfaced ONCE in the
      // wizard's success toast (the server response is the only source).
      tempPassword: '',
      passwordResetRequired: true,
      createdDate: new Date().toISOString().split('T')[0],
    },
    remarks: form.remarks,
  }
}
