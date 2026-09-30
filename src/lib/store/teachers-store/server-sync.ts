'use client'

/**
 * teachers-store/server-sync — hydrates the faculty store from the
 * canonical database (Phase 7: "No fake teacher names").
 *
 * Mirrors the students-store server-sync pattern (the codebase's
 * canonical hydration contract):
 *
 *   · ONE universe of teacher ids — after a successful sync the store's
 *     `teachers` array is REPLACED by the server's Teacher rows
 *     (canonical cuid ids, real User names/emails/phones). Consumers
 *     (principal Teachers module, class cards, salary employees,
 *     messaging contacts) all render the same real people.
 *   · Honest mapping — fields with no database source map to EMPTY
 *     values ('' / 0 / [] / undefined). Aadhaar numbers, bank account
 *     details, addresses, qualification histories and login credentials
 *     are NEVER invented; the UI renders its honest "Not provided"
 *     states for them.
 *   · Preservation by id — in-store enrichments that were keyed to a
 *     teacher id that STILL exists on the server (positions /
 *     responsibilities, appointment letters, documents, media, remarks)
 *     are carried over onto the synced record. Enrichments attached to
 *     retired ids (e.g. the old fabricated T-xxx seed universe) are
 *     pruned with their rows — exactly like the students-store prunes
 *     orphaned positions.
 *   · Failure keeps data — a failed fetch leaves the store's current
 *     content untouched and only flags `syncStatus: 'error'` so the
 *     Teachers module can offer an honest retry. Seed data is never
 *     re-injected.
 *   · Once per session — a module-level promise guard (reset only via
 *     `resetTeachersSyncGuard`).
 *
 * Data source: GET /api/teachers (PRINCIPAL / MANAGEMENT only — the
 * sync is triggered from the principal panel mount; teacher/student
 * sessions simply keep the persisted store contents).
 */

import type { TeacherRecord } from './types'
import { useTeachersStore } from './store'

// ── payload types (mirror /api/teachers GET) ────────────────────────

export interface ServerTeacherDto {
  id: string
  schoolId: string
  userId: string
  employeeId: string | null
  department: string | null
  qualification: string | null
  subjects: string | null
  createdAt: string
  user: { name: string; email: string | null; phone: string | null }
}

// ── mapping helpers ─────────────────────────────────────────────────

/** "Rohan Mehta" → "RM", "Socrates" → "So". Initials are presentation
 *  derived from a real name — never a fabricated identity field. */
function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return `${words[0][0]}${words[words.length - 1][0]}`.toUpperCase()
}

function emptySalaryBreakdown(): TeacherRecord['salaryBreakdown'] {
  return { basic: 0, hra: 0, da: 0, specialAllowance: 0, pfDeduction: 0, netPay: 0 }
}

/** Split the server's single CSV subjects column into display names. */
function subjectsOf(raw: string | null): string[] {
  return (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

/**
 * Map one database Teacher row onto the store's TeacherRecord shape.
 * Every field without a database source is EMPTY — never fabricated.
 */
export function mapServerTeacher(dto: ServerTeacherDto): TeacherRecord {
  const email = dto.user?.email ?? ''
  const name = dto.user?.name?.trim() || email.split('@')[0] || 'Unnamed teacher'
  return {
    id: dto.id, // canonical DB id — ONE teacher universe
    // The Teacher row's USER id — Class.classTeacherId and
    // ClassSubjectAssignment.teacherUserId reference it, so consumers
    // cross-referencing class data match id OR serverUserId.
    serverUserId: dto.userId,
    employeeId: dto.employeeId ?? '',
    teacherId: '', // no DB source — never fabricated
    name,
    avatar: initialsOf(name),
    gender: 'Other', // no DB source — neutral enum value, never asserted
    dob: '',
    bloodGroup: '',
    aadhaarNo: '', // THE fabricated-Aadhaar field — always empty
    nationality: '',
    religion: '',
    category: '',

    email,
    phone: dto.user?.phone ?? '',
    emergencyContact: { name: '', relation: '', phone: '' },
    currentAddress: '',
    permAddress: '',
    sameAddress: true,
    district: '',
    state: '',
    pincode: '',

    educationalQualifications: [],
    professionalQualifications: dto.qualification ? [dto.qualification] : [],
    totalExperience: 0,
    previousEmployment: { organization: '', designation: '', lastSalary: 0, duration: '' },

    joiningDate: '', // createdAt is the record's creation, NOT a joining date
    employmentType: 'Full Time', // structural default; profile shows real data when edited
    department: dto.department ?? '',
    designation: '', // no DB source — directory shows "Not provided"
    status: 'Active', // a Teacher row on the school roster IS active staff
    attendance: 0, // no attendance records exist yet — UI shows "No records"

    salary: 0,
    salaryBreakdown: emptySalaryBreakdown(),
    bankDetails: { bankName: '', accountNo: '', ifscCode: '', branchName: '' },

    subjects: subjectsOf(dto.subjects),
    classes: [],
    examResponsibilities: [],

    positions: [], // preserved from the previous store state (by id) in sync
    documents: [],
    appointmentLetter: undefined,
    letterArchive: [],
    photo: undefined,
    signature: undefined,
    isLocked: false,
    loginCredentials: {
      // Login rides the real User account — the username IS the email.
      username: email,
      tempPassword: '', // never fabricated; reset flow issues real temp creds
      passwordResetRequired: false,
      createdDate: dto.createdAt,
      lastLogin: undefined,
    },
    remarks: undefined,
  }
}

// ── sync ─────────────────────────────────────────────────────────────

let syncPromise: Promise<boolean> | null = null

/**
 * Fetch the canonical faculty roster and replace the store's teachers
 * array with the server rows. Runs at most once per browser session
 * (module-level promise guard); failures keep the existing store
 * content and flag `syncStatus: 'error'` for the honest retry affordance.
 */
export function syncTeachersFromServer(): Promise<boolean> {
  if (syncPromise) return syncPromise
  syncPromise = (async () => {
    useTeachersStore.setState({ syncStatus: 'syncing' })
    try {
      const res = await fetch('/api/teachers', { cache: 'no-store' })
      if (!res.ok) throw new Error(`teachers sync HTTP ${res.status}`)
      const envelope = (await res.json()) as { ok?: boolean; data?: unknown } | ServerTeacherDto[]
      // The API wraps responses as { ok, data } — unwrap before mapping.
      const rows = Array.isArray(envelope)
        ? envelope
        : envelope && Array.isArray((envelope as { data?: unknown }).data)
          ? ((envelope as { data: unknown }).data as ServerTeacherDto[])
          : []
      const teachers = rows
        .filter((r): r is ServerTeacherDto => !!r && typeof r.id === 'string')
        .map(mapServerTeacher)

      useTeachersStore.setState((state) => {
        // Preserve in-store enrichments keyed to ids that still exist
        // server-side (positions, letters, documents, media, remarks).
        // Enrichments attached to retired ids fall away with their rows.
        const prev = new Map(state.teachers.map((t) => [t.id, t]))
        const merged = teachers.map((fresh) => {
          const old = prev.get(fresh.id)
          if (!old) return fresh
          return {
            ...fresh,
            positions: old.positions ?? [],
            documents: old.documents ?? [],
            appointmentLetter: old.appointmentLetter,
            letterArchive: old.letterArchive,
            photo: old.photo,
            signature: old.signature,
            isLocked: old.isLocked,
            pendingPayrollUpdate: old.pendingPayrollUpdate,
            remarks: old.remarks,
          }
        })
        // Prune audit logs that target teachers no longer on the roster
        // (the fabricated seed logs referenced the retired T-xxx ids).
        const ids = new Set(teachers.map((t) => t.id))
        const auditLogs = state.auditLogs.filter((l) => ids.has(l.targetTeacherId))
        return { teachers: merged, auditLogs, syncStatus: 'synced' }
      })
      return true
    } catch (e) {
      // Keep whatever the store has — NEVER re-inject seed data.
      useTeachersStore.setState({ syncStatus: 'error' })
      console.warn('[teachers-store] roster sync failed — keeping existing store data:', e)
      return false
    }
  })()
  return syncPromise
}

/** Reset the once-per-session guard (explicit retry / tests). */
export function resetTeachersSyncGuard(): void {
  syncPromise = null
}
