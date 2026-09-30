'use client'

import { create } from 'zustand'

/**
 * teacher-roster-store — the school's REAL teacher roster (server truth).
 *
 * The Principal's timetable workspace uses this for its teacher picker,
 * faculty filters, conflict labels and auto-scheduler — so every teacher
 * the editor can assign is a teacher who actually exists at the school
 * (GET /api/teachers → Teacher rows joined with their User identity).
 *
 * PHASE 7 (Task 7-a) — HONEST EMPTY, NO MOCK FALLBACK:
 *   · The store starts EMPTY. Until the fetch resolves the pickers render
 *     their loading/empty states; consumers hydrate after ensure()
 *     settles, so ids are always consistent.
 *   · An empty server roster STAYS EMPTY — the timetable picker shows an
 *     honest "No teachers registered" state instead of a fabricated
 *     faculty list.
 *   · A FAILED fetch keeps the last server data (nothing on a cold
 *     session) — the mock universe is never re-injected.
 */

export interface TeacherPick {
  /** Stable id — the server Teacher.id (canonical, one universe). */
  id: string
  /** The teacher's USER id — Class.classTeacherId /
   *  ClassSubjectAssignment.teacherUserId convention. Class-data
   *  lookups match `id` OR `userId` (Phase 7: real appointments must
   *  resolve, not silently render "not assigned"). */
  userId: string
  employeeId: string
  name: string
  avatar: string
  department: string
  /** Comma-split subject codes/names (server stores one string column). */
  subjects: string[]
}

interface ServerTeacherRow {
  id: string
  userId: string
  employeeId: string | null
  department: string | null
  subjects: string | null
  user: { name: string; email?: string | null }
}

/** "Mrs. Kavita Sharma" → "KS", "Rohan Mehta" → "RM", "Socrates" → "S". */
function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  const last = words[words.length - 1]
  const prev = words[words.length - 2]
  return `${prev[0]}${last[0]}`.toUpperCase()
}

interface TeacherRosterState {
  /** Server roster once synced; EMPTY until then (never mock). */
  teachers: TeacherPick[]
  /** 'mock' = not yet resolved (legacy enum value, kept for consumer
   *  typing); 'server' = the list below IS the server's roster — even
   *  when that roster is empty. */
  source: 'mock' | 'server'
  /** ensure() in-flight promise guard (idempotent across consumers). */
  loading: boolean
  ensure: () => Promise<void>
}

let inflight: Promise<void> | null = null

export const useTeacherRosterStore = create<TeacherRosterState>((set) => ({
  teachers: [],
  source: 'mock',
  loading: false,
  ensure: () => {
    if (inflight) return inflight
    set({ loading: true })
    inflight = (async () => {
      try {
        const res = await fetch('/api/teachers', {
          cache: 'no-store',
          credentials: 'same-origin',
        })
        const json = (await res.json().catch(() => null)) as
          | { ok?: unknown; data?: unknown }
          | null
        if (!res.ok || !json || json.ok !== true) throw new Error('roster sync failed')
        // An EMPTY server roster is a valid, honest result — it stays
        // empty (the pickers show "No teachers registered").
        const rows = Array.isArray(json.data) ? (json.data as ServerTeacherRow[]) : []
        const picks: TeacherPick[] = rows.map((r) => ({
          id: r.id,
          userId: r.userId,
          employeeId: r.employeeId ?? '',
          name: r.user?.name ?? 'Unnamed teacher',
          avatar: initialsOf(r.user?.name ?? '?'),
          department: r.department ?? '',
          subjects: (r.subjects ?? '')
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
        }))
        set({ teachers: picks, source: 'server' })
      } catch {
        /* fetch failed — keep the last server data (empty on a cold
           session); NO mock fallback, ids stay consistent for this
           session */
      } finally {
        set({ loading: false })
      }
    })()
    return inflight
  },
}))

/** Imperative lookup (non-React modules: PDF builder etc.). Matches the
 *  Teacher row id OR the teacher's USER id — class data (Class
 *  .classTeacherId / ClassSubjectAssignment.teacherUserId) carries the
 *  USER id, so both spaces resolve (Phase 7). */
export const teacherById = (id: string): TeacherPick | undefined =>
  useTeacherRosterStore.getState().teachers.find((t) => t.id === id || t.userId === id)

/** Imperative name-by-id with fallback (mirrors the old getTeacherById). */
export const teacherNameById = (id: string): string | undefined => teacherById(id)?.name
