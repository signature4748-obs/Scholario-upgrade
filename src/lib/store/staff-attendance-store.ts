'use client'

/**
 * staff-attendance-store — date-keyed staff attendance state.
 *
 * RETIRED (7-b — Mock Data Elimination): this store has ZERO importers.
 * The Principal Staff Attendance tab now renders an honest "not
 * configured" state (no DB model for staff attendance exists) and the
 * Teacher Personal Attendance module did the same earlier — neither
 * reads this store. It is kept on disk as a dev reference for the day a
 * real StaffAttendance model + API lands (the draft/submit state machine
 * here was sound; only its fabricated record source was not). Do not
 * import from new code.
 *
 * Brief §2-§15 (Phase 4): Every date has its own independent attendance
 * record with one of three states:
 *
 *   A. SUBMITTED / LOCKED    — read-only, immutable historical truth
 *   B. DRAFT / UNSUBMITTED   — editable, persisted across sessions
 *   C. NO ATTENDANCE ENTERED — editable, blank slate
 *
 * Brief §10 + §29: Drafts are persisted (localStorage) so they survive
 *   date changes, navigation, and page refreshes.
 *
 * Brief §11 + §14: Submission is EXPLICIT — `submitted: true` is a
 *   distinct flag, not inferred from "rows exist".
 *
 * Brief §16: Read-only rule is enforced in the store layer (the
 *   `mark()` / `markAllPresent()` / `submit()` actions refuse to
 *   mutate a submitted date). This is the "frontend bypass" guard —
 *   a real backend would also enforce this server-side.
 *
 * ATTEND-1 (correction pass): the seed is no longer a hardcoded block of
 * Dec-2025 dates. `STAFF_TODAY_DATE` is computed from the REAL clock at
 * module load, and the deterministic session history is built lazily by
 * `ensureSessionData({ sessionStart, today, isWorkingDay })`:
 *   a) PURGES byDate keys outside [sessionStart, today] (stale seeds),
 *   b) seeds every MISSING working day before today as SUBMITTED
 *      (submittedAt ~10:00 that date, records = getStaffAttendanceForDate),
 *   c) seeds today as a DRAFT,
 *   d) NEVER overwrites existing dates (idempotent — real marks/edits
 *      made in the app are preserved),
 *   e) non-working days get no records.
 * The action only calls set() when something actually changed, so wiring
 * it into a React effect cannot loop.
 *
 * NOTE (7-b): the record source `getStaffAttendanceForDate` derives
 * from the RETIRED STAFF_DEFS roster (now an empty array — see
 * src/lib/mock/attendance.ts), so any historical call yields honest
 * empty record lists, never fabricated staff rows.
 */

import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import {
  getStaffAttendanceForDate,
  type StaffAttendanceRecord,
  type AttendanceStatus,
} from '@/lib/mock/attendance'

/** Local YYYY-MM-DD from a Date (no timezone shift). */
function toLocalISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * Today's canonical date — computed from the REAL clock at module load so
 * every consumer (teacher My Attendance, principal staff tab) opens on the
 * live date. Exported as before; staff-tab.tsx imports it.
 */
export const STAFF_TODAY_DATE = toLocalISO(new Date())

/**
 * Brief §11: conceptual record model — submitted is explicit, not inferred.
 * One StaffDateState per date — keyed by `dateStr` (YYYY-MM-DD).
 */
export interface StaffDateState {
  date: string
  /** Explicit submission flag (Brief §14). `true` = read-only historical truth. */
  submitted: boolean
  /** ISO timestamp of submission (for display + audit). */
  submittedAt: string | null
  /** Submitted record — frozen snapshot of the records at submit time. */
  submittedRecords: StaffAttendanceRecord[]
  /** Current editable draft (the working state). Null = no draft yet. */
  draft: StaffAttendanceRecord[] | null
}

/** Options for `ensureSessionData`. */
export interface EnsureSessionDataOptions {
  /** First date of the academic session (YYYY-MM-DD). */
  sessionStart: string
  /** The real today (YYYY-MM-DD). */
  today: string
  /** Working-day predicate for THIS school's staff calendar
   *  (e.g. not Sunday, not a declared holiday). */
  isWorkingDay: (dateStr: string) => boolean
}

interface StaffAttendanceStoreState {
  /** Date-keyed attendance state. Starts empty; `ensureSessionData`
   *  (or manual marking) populates it. */
  byDate: Record<string, StaffDateState>
  /** Actions */
  getDateString: (date: string) => StaffDateState
  mark: (date: string, staffId: string, status: AttendanceStatus) => void
  markAllPresent: (date: string) => void
  submit: (date: string) => boolean
  /** Lazily build the deterministic session history (idempotent, never
   *  overwrites existing dates). See the header comment. */
  ensureSessionData: (opts: EnsureSessionDataOptions) => void
  /** Reset to a blank slate (dev only). The session history rebuilds on
   *  the next `ensureSessionData` call. */
  reset: () => void
}

/** Build the "no attendance entered" state for a date with no record yet. */
function buildEmptyState(date: string): StaffDateState {
  return {
    date,
    submitted: false,
    submittedAt: null,
    submittedRecords: [],
    draft: null,
  }
}

/** Build the default draft records for a date (deterministic per date). */
function buildDefaultDraft(date: string): StaffAttendanceRecord[] {
  return getStaffAttendanceForDate(date)
}

export const useStaffAttendanceStore = create<StaffAttendanceStoreState>()(
  persist(
    (set, get) => ({
      byDate: {},

      getDateString: (date) => {
        return get().byDate[date] ?? buildEmptyState(date)
      },

      /**
       * Brief §6: mark a single staff member's status for a date.
       * Brief §16: REFUSES to mutate a submitted date (frontend bypass guard).
       * Brief §27: persists the draft so it survives date changes / refresh.
       */
      mark: (date, staffId, status) => {
        const existing = get().byDate[date] ?? buildEmptyState(date)
        // Brief §4 + §16: submitted dates are read-only — refuse the mutation.
        if (existing.submitted) {
          if (typeof window !== 'undefined') {
            console.warn(
              `[staff-attendance] Cannot mark ${staffId} on ${date} — attendance already submitted (read-only).`
            )
          }
          return
        }
        const baseDraft = existing.draft ?? buildDefaultDraft(date)
        const nextDraft = baseDraft.map((r) => {
          if (r.id !== staffId) return r
          const checkIn = status === 'present'
            ? '08:30 AM'
            : status === 'late'
            ? '09:00 AM'
            : null
          const checkOut = status === 'present' || status === 'late' ? '03:45 PM' : null
          return { ...r, status, checkIn, checkOut }
        })
        set((state) => ({
          byDate: {
            ...state.byDate,
            [date]: { ...existing, draft: nextDraft },
          },
        }))
      },

      /**
       * Brief §3 + §19: Mark All Present — only for editable dates.
       * Brief §16: REFUSES on submitted dates (frontend bypass guard).
       */
      markAllPresent: (date) => {
        const existing = get().byDate[date] ?? buildEmptyState(date)
        if (existing.submitted) {
          if (typeof window !== 'undefined') {
            console.warn(
              `[staff-attendance] Cannot mark all present on ${date} — attendance already submitted (read-only).`
            )
          }
          return
        }
        const baseDraft = existing.draft ?? buildDefaultDraft(date)
        const nextDraft = baseDraft.map((r) => ({
          ...r,
          status: 'present' as AttendanceStatus,
          checkIn: '08:30 AM',
          checkOut: '03:45 PM',
        }))
        set((state) => ({
          byDate: {
            ...state.byDate,
            [date]: { ...existing, draft: nextDraft },
          },
        }))
      },

      /**
       * Brief §7 + §15: Submit Attendance — finalizes the draft.
       * Brief §15: Returns false (rejects) if already submitted, preventing
       *   accidental double-submission.
       * Brief §16: After submission, the date is permanently read-only.
       * Brief §29: After submit, refresh still shows read-only (persisted).
       */
      submit: (date) => {
        const existing = get().byDate[date] ?? buildEmptyState(date)
        // Brief §15: prevent double submission
        if (existing.submitted) return false
        // If there's no draft, there's nothing to submit
        const draft = existing.draft ?? buildDefaultDraft(date)
        set((state) => ({
          byDate: {
            ...state.byDate,
            [date]: {
              ...existing,
              submitted: true,
              submittedAt: new Date().toISOString(),
              submittedRecords: draft,
              draft, // draft becomes the read-only snapshot too
            },
          },
        }))
        return true
      },

      /**
       * ATTEND-1: lazily build the deterministic session history.
       * Idempotent — existing dates are NEVER overwritten, so real marks,
       * edits and submissions made in the app always win. Only calls set()
       * when something actually changed (loop-safe in React effects).
       */
      ensureSessionData: ({ sessionStart, today, isWorkingDay }) => {
        const current = get().byDate
        const next: Record<string, StaffDateState> = {}
        let changed = false

        // (a) Purge keys outside [sessionStart, today] — removes stale
        //     seeds from old localStorage versions.
        for (const [date, state] of Object.entries(current)) {
          if (date >= sessionStart && date <= today) {
            next[date] = state
          } else {
            changed = true
          }
        }

        // (b) + (c): seed every missing working day in [sessionStart, today].
        const [sy, sm, sd] = sessionStart.split('-').map(Number)
        const [ty, tm, td] = today.split('-').map(Number)
        const cursor = new Date(sy, sm - 1, sd)
        const end = new Date(ty, tm - 1, td)
        while (cursor <= end) {
          const dateStr = toLocalISO(cursor)
          if (isWorkingDay(dateStr) && !next[dateStr]) {
            changed = true
            if (dateStr < today) {
              // (b) past working day → deterministic SUBMITTED history
              const records = getStaffAttendanceForDate(dateStr)
              next[dateStr] = {
                date: dateStr,
                submitted: true,
                submittedAt: `${dateStr}T10:00:00.000Z`,
                submittedRecords: records,
                draft: records,
              }
            } else {
              // (c) today → editable DRAFT (submitted by the Principal later)
              next[dateStr] = {
                date: dateStr,
                submitted: false,
                submittedAt: null,
                submittedRecords: [],
                draft: getStaffAttendanceForDate(dateStr),
              }
            }
          }
          cursor.setDate(cursor.getDate() + 1)
        }

        if (changed) set({ byDate: next })
      },

      reset: () => {
        set({ byDate: {} })
      },
    }),
    {
      name: 'scholario-staff-attendance',
      version: 2,
      // Stale persisted seeds (the old hardcoded Dec-2025 block) are
      // discarded on upgrade — ensureSessionData rebuilds the session
      // history deterministically on the next module mount.
      migrate: () => ({ byDate: {} }),
      storage: createJSONStorage(() => {
        // Brief §10 + §29: persist to localStorage so drafts + submitted
        // states survive page refresh. Falls back to in-memory storage
        // if localStorage is unavailable (SSR / private browsing).
        if (typeof window === 'undefined') {
          return {
            getItem: () => null,
            setItem: () => {},
            removeItem: () => {},
          }
        }
        return window.localStorage
      }),
      partialize: (state) => ({ byDate: state.byDate }),
    }
  )
)

/* ──────────────────────────────────────────────────────────
   Brief §13: Date state helpers — for the calendar/day indicators.
   ────────────────────────────────────────────────────────── */
export type DateState = 'submitted' | 'draft' | 'empty'

export function getDateState(date: string): DateState {
  const state = useStaffAttendanceStore.getState().getDateString(date)
  if (state.submitted) return 'submitted'
  if (state.draft) return 'draft'
  return 'empty'
}

/**
 * Get all dates with a known state — used to render calendar day indicators.
 * Returns Map<dateStr, DateState>.
 */
export function getDateStateMap(): Record<string, DateState> {
  const byDate = useStaffAttendanceStore.getState().byDate
  const map: Record<string, DateState> = {}
  for (const [date, state] of Object.entries(byDate)) {
    if (state.submitted) map[date] = 'submitted'
    else if (state.draft) map[date] = 'draft'
    else map[date] = 'empty'
  }
  return map
}

/**
 * Brief §26: detect unsaved changes — when draft differs from submitted
 * records (for re-editing) or from the default seeded draft (for new dates).
 * Returns true if there are unsaved local changes that haven't been submitted.
 */
export function hasUnsavedChanges(date: string): boolean {
  const state = useStaffAttendanceStore.getState().getDateString(date)
  if (state.submitted) return false
  // If no draft at all, no changes
  if (!state.draft) return false
  // If draft exists and not submitted, there are pending unsaved changes.
  // Compare to the default draft (what would have been generated if the
  // user hadn't touched anything) to detect "no changes from default".
  const defaultDraft = buildDefaultDraft(date)
  if (defaultDraft.length !== state.draft.length) return true
  return state.draft.some((r, i) => {
    const base = defaultDraft[i]
    return base.status !== r.status || base.checkIn !== r.checkIn
  })
}
