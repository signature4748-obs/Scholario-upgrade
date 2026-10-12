/**
 * Library store — school library management.
 *
 * LIBRARY DB WIRING (this change): for a REAL tenant the module is now
 * server-authoritative — GET /api/library hydrates `serverBooks`/
 * `serverIssues` (fetched, NEVER persisted), and issue/return/add-book go
 * through POST /api/library (tenant-scoped, `school.library.manage`,
 * transactional stock guard). Failures surface honest errors — no local
 * fallback rows pretend to be real data. The DB has no columns/models for
 * fines, reservations or teacher borrowers, so those surfaces stay
 * honestly labeled preview features (server issues carry fine: 0 + the
 * Fines tab explains fine tracking is not server-backed yet).
 *
 * DEMO TENANT (School.isDemo): keeps the curated local showcase corpus
 * (localStorage, honestly labeled via DemoModuleNotice) — the store
 * operates exactly as before (local mutations). Server rows are ignored
 * in demo mode.
 *
 * Borrowers: students always come from the canonical roster store;
 * teacher options come from the REAL teacher directory (the fabricated
 * mock/teachers personas are retired from the Issue dialog — in server
 * mode teachers are excluded honestly: BookIssue's schema supports
 * student borrowers only).
 *
 * QA-FIX-B — TENANT-SCOPED PERSISTENCE: the LOCAL slices (books/issues/
 * reservations) remain persisted per-school namespace (demo mode data).
 * Server slices are derived (fetched) and never persisted.
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { useMemo } from 'react'
import { useStudentsStore } from '@/lib/store/students-store'
import { useTeachersStore } from '@/lib/store/teachers-store'
import { readIsDemoTenant, useIsDemoTenant } from '@/lib/store/demo-tenant'
import { makeDemoSeedApplier } from '@/lib/store/demo-tenant'
import { migrateLegacyScopedStore, createTenantScopedStorage } from '@/lib/tenant/tenant-storage'
import { DEFAULT_TENANT_ID } from '@/lib/tenant/schools'

migrateLegacyScopedStore('scholario-library-v1', DEFAULT_TENANT_ID)

export type BookCategory = 'Fiction' | 'Reference' | 'Textbooks' | 'Story Books' | 'Biography' | 'Magazines' | 'Science'
export type BookStatus = 'Available' | 'Low Stock' | 'Out of Stock'
export type IssueStatus = 'Issued' | 'Overdue' | 'Returned'
export type FineStatus = 'Pending' | 'Paid' | 'Waived'

export interface Book {
  id: string
  title: string
  author: string
  isbn: string
  category: BookCategory
  publisher?: string
  copies: number
  issued: number
  available: number
  status: BookStatus
}

export interface IssueRecord {
  id: string
  bookId: string
  bookTitle: string
  borrowerId: string
  borrowerName: string
  borrowerType: 'student' | 'teacher'
  admissionNo?: string
  class?: string
  issueDate: string
  dueDate: string
  returnDate?: string
  /** ISO timestamp of the last overdue reminder sent (set by sendReminder). */
  reminderSentAt?: string
  status: IssueStatus
  fine: number
  fineStatus: FineStatus
}

export interface Reservation {
  id: string
  bookId: string
  bookTitle: string
  borrowerId: string
  borrowerName: string
  date: string
  status: 'Waiting' | 'Notified' | 'Fulfilled'
}

const FINE_PER_DAY = 5

const SEED_BOOKS: Book[] = [
  { id: 'BK001', title: 'Wings of Fire', author: 'Dr. A.P.J. Abdul Kalam', isbn: '978-8173711466', category: 'Biography', publisher: 'Universities Press', copies: 12, issued: 4, available: 8, status: 'Available' },
  { id: 'BK002', title: 'The Jungle Book', author: 'Rudyard Kipling', isbn: '978-9380816798', category: 'Fiction', publisher: 'Penguin', copies: 15, issued: 6, available: 9, status: 'Available' },
  { id: 'BK003', title: 'Panchatantra Tales', author: 'Vishnu Sharma', isbn: '978-8126414838', category: 'Story Books', copies: 20, issued: 7, available: 13, status: 'Available' },
  { id: 'BK004', title: 'Mathematics for Class 2', author: 'NCERT', isbn: '978-8174507344', category: 'Textbooks', copies: 25, issued: 4, available: 21, status: 'Available' },
  { id: 'BK005', title: 'Our Environment', author: 'NCERT', isbn: '978-8174507351', category: 'Textbooks', copies: 25, issued: 5, available: 20, status: 'Available' },
  { id: 'BK006', title: 'Akbar and Birbal', author: 'Amar Chitra Katha', isbn: '978-8184820058', category: 'Story Books', copies: 10, issued: 4, available: 6, status: 'Available' },
  { id: 'BK007', title: 'Encyclopedia of Science', author: 'DK', isbn: '978-1405394834', category: 'Reference', copies: 6, issued: 3, available: 3, status: 'Low Stock' },
  { id: 'BK008', title: 'Tenali Raman Stories', author: 'Amar Chitra Katha', isbn: '978-8184820126', category: 'Story Books', copies: 12, issued: 4, available: 8, status: 'Available' },
  { id: 'BK009', title: 'A Brief History of Time', author: 'Stephen Hawking', isbn: '978-0553380163', category: 'Science', copies: 8, issued: 5, available: 3, status: 'Low Stock' },
  { id: 'BK010', title: 'Indian Constitution', author: 'DD Basu', isbn: '978-9350356400', category: 'Reference', copies: 5, issued: 0, available: 5, status: 'Available' },
  { id: 'BK011', title: 'The Wonder That Was India', author: 'A.L. Basham', isbn: '978-8187013946', category: 'Biography', copies: 4, issued: 4, available: 0, status: 'Out of Stock' },
  { id: 'BK012', title: 'Physics for Class 10', author: 'HC Verma', isbn: '978-8170189113', category: 'Textbooks', copies: 30, issued: 13, available: 17, status: 'Available' },
  { id: 'BK013', title: 'National Geographic Kids', author: 'Nat Geo', isbn: '978-1426338005', category: 'Magazines', copies: 15, issued: 8, available: 7, status: 'Available' },
  { id: 'BK014', title: 'The Discovery of India', author: 'Jawaharlal Nehru', isbn: '978-0143031031', category: 'Biography', copies: 6, issued: 2, available: 4, status: 'Available' },
  { id: 'BK015', title: 'Chemistry Lab Manual', author: 'NCERT', isbn: '978-8174507375', category: 'Textbooks', copies: 20, issued: 10, available: 10, status: 'Available' },
]

// Helper: get a student by ID from canonical store
function getStudent(id: string) {
  return useStudentsStore.getState().students.find((s) => s.id === id)
}

function getTeacher(id: string) {
  // REAL directory only — the fabricated mock/teachers personas are
  // retired from library flows (an honest 'not found' beats a fake lender).
  return useTeachersStore.getState().teachers.find((t) => t.id === id)
}

// Build initial issues using canonical students
// (borrowers resolve against the students-store roster: STU-1…STU-42 →
// DSO2024001…DSO2024042 — names/classes below match that roster exactly).
const SEED_ISSUES: IssueRecord[] = [
  { id: 'ISS001', bookId: 'BK001', bookTitle: 'Wings of Fire', borrowerId: 'STU-20', borrowerName: 'Aarav Reddy', borrowerType: 'student', admissionNo: 'DSO2024020', class: 'Class 6-A', issueDate: '2025-11-12', dueDate: '2025-11-26', status: 'Overdue', fine: 20, fineStatus: 'Pending' },
  { id: 'ISS002', bookId: 'BK002', bookTitle: 'The Jungle Book', borrowerId: 'STU-2', borrowerName: 'Pari Kumar', borrowerType: 'student', admissionNo: 'DSO2024002', class: 'Pre-Nursery-A', issueDate: '2025-11-18', dueDate: '2025-12-02', status: 'Issued', fine: 0, fineStatus: 'Pending' },
  { id: 'ISS003', bookId: 'BK003', bookTitle: 'Panchatantra Tales', borrowerId: 'STU-10', borrowerName: 'Karan Singh', borrowerType: 'student', admissionNo: 'DSO2024010', class: 'Class 2-A', issueDate: '2025-11-20', dueDate: '2025-12-04', status: 'Issued', fine: 0, fineStatus: 'Pending' },
  { id: 'ISS004', bookId: 'BK007', bookTitle: 'Encyclopedia of Science', borrowerId: 'STU-29', borrowerName: 'Riya Gupta', borrowerType: 'student', admissionNo: 'DSO2024029', class: 'Class 9-B', issueDate: '2025-11-05', dueDate: '2025-11-19', status: 'Overdue', fine: 40, fineStatus: 'Pending' },
  { id: 'ISS005', bookId: 'BK006', bookTitle: 'Akbar and Birbal', borrowerId: 'STU-7', borrowerName: 'Aarav Desai', borrowerType: 'student', admissionNo: 'DSO2024007', class: 'KG-B', issueDate: '2025-11-22', dueDate: '2025-12-06', status: 'Issued', fine: 0, fineStatus: 'Pending' },
  { id: 'ISS006', bookId: 'BK009', bookTitle: 'A Brief History of Time', borrowerId: 'T-038', borrowerName: 'Pooja Bhatt', borrowerType: 'teacher', issueDate: '2025-11-15', dueDate: '2025-11-29', status: 'Overdue', fine: 15, fineStatus: 'Pending' },
  { id: 'ISS007', bookId: 'BK011', bookTitle: 'The Wonder That Was India', borrowerId: 'T-035', borrowerName: 'Rajesh Khanna', borrowerType: 'teacher', issueDate: '2025-11-10', dueDate: '2025-11-24', status: 'Overdue', fine: 35, fineStatus: 'Pending' },
  { id: 'ISS008', bookId: 'BK012', bookTitle: 'Physics for Class 10', borrowerId: 'STU-31', borrowerName: 'Sai Agarwal', borrowerType: 'student', admissionNo: 'DSO2024031', class: 'Class 10-A', issueDate: '2025-11-25', dueDate: '2025-12-09', status: 'Issued', fine: 0, fineStatus: 'Pending' },
  { id: 'ISS009', bookId: 'BK015', bookTitle: 'Chemistry Lab Manual', borrowerId: 'STU-28', borrowerName: 'Anika Reddy', borrowerType: 'student', admissionNo: 'DSO2024028', class: 'Class 9-A', issueDate: '2025-11-23', dueDate: '2025-12-07', status: 'Issued', fine: 0, fineStatus: 'Pending' },
  { id: 'ISS010', bookId: 'BK014', bookTitle: 'The Discovery of India', borrowerId: 'T-020', borrowerName: 'Deepa Menon', borrowerType: 'teacher', issueDate: '2025-11-28', dueDate: '2025-12-12', status: 'Issued', fine: 0, fineStatus: 'Pending' },
]

const SEED_RESERVATIONS: Reservation[] = [
  { id: 'RES001', bookId: 'BK011', bookTitle: 'The Wonder That Was India', borrowerId: 'STU-27', borrowerName: 'Myra Patel', date: '2025-11-20', status: 'Waiting' },
]

// Current-session borrower records — the logged-in student (Aarav Sharma,
// STU-58, Class 2) and teacher (Rohan Mehta, T-014) so their role
// views show REAL circulation data from this same store (no second source).
// Dates are relative to "today" so overdue/status computations stay honest.
function rel(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)
}
const SESSION_BORROWER_ISSUES: IssueRecord[] = [
  { id: 'ISS101', bookId: 'BK003', bookTitle: 'Panchatantra Tales', borrowerId: 'STU-58', borrowerName: 'Aarav Sharma', borrowerType: 'student', admissionNo: 'DSO2024058', class: 'Class 2-A', issueDate: rel(6), dueDate: rel(-8), status: 'Issued', fine: 0, fineStatus: 'Pending' },
  { id: 'ISS102', bookId: 'BK004', bookTitle: 'Mathematics for Class 2', borrowerId: 'STU-58', borrowerName: 'Aarav Sharma', borrowerType: 'student', admissionNo: 'DSO2024058', class: 'Class 2-A', issueDate: rel(20), dueDate: rel(-2), status: 'Overdue', fine: 10, fineStatus: 'Pending' },
  { id: 'ISS103', bookId: 'BK008', bookTitle: 'Tenali Raman Stories', borrowerId: 'STU-58', borrowerName: 'Aarav Sharma', borrowerType: 'student', admissionNo: 'DSO2024058', class: 'Class 2-A', issueDate: rel(40), dueDate: rel(26), returnDate: rel(25), status: 'Returned', fine: 0, fineStatus: 'Paid' },
  { id: 'ISS104', bookId: 'BK012', bookTitle: 'Physics for Class 10', borrowerId: 'T-014', borrowerName: 'Rohan Mehta', borrowerType: 'teacher', issueDate: rel(9), dueDate: rel(-5), status: 'Issued', fine: 0, fineStatus: 'Pending' },
  { id: 'ISS105', bookId: 'BK001', bookTitle: 'Wings of Fire', borrowerId: 'T-014', borrowerName: 'Rohan Mehta', borrowerType: 'teacher', issueDate: rel(35), dueDate: rel(33), returnDate: rel(30), status: 'Returned', fine: 0, fineStatus: 'Paid' },
]

interface LibraryState {
  books: Book[]
  issues: IssueRecord[]
  reservations: Reservation[]
  search: string
  categoryFilter: string
  availabilityFilter: string
  /** FINAL-GATE (EG-9F/R4) — set once the demo seed has been applied. */
  demoSeeded?: boolean
  /** FINAL-GATE (EG-9F/R4) — one-shot demo-tier seeder (module root). */
  ensureDemoSeed: () => void

  /** DB feed (GET /api/library) — real tenants; never persisted. */
  serverBooks: Book[]
  serverIssues: IssueRecord[]
  serverStatus: 'idle' | 'loading' | 'ready' | 'error'
  /** True while a server mutation is in flight (UI disabling). */
  serverPending: boolean
  hydrateServerLibrary: (books: Book[], issues: IssueRecord[]) => void
  setServerStatus: (status: 'idle' | 'loading' | 'ready' | 'error') => void
  setServerPending: (pending: boolean) => void

  setSearch: (q: string) => void
  setCategoryFilter: (c: string) => void
  setAvailabilityFilter: (a: string) => void
  issueBook: (bookId: string, borrowerId: string, borrowerType: 'student' | 'teacher') => Promise<{ success: boolean; error?: string }>
  returnBook: (issueId: string) => Promise<{ success: boolean; error?: string }>
  sendReminder: (loanId: string) => void
  addBook: (book: Omit<Book, 'id' | 'issued' | 'available' | 'status'>) => Promise<{ success: boolean; error?: string }>
  payFine: (issueId: string) => void
  waiveFine: (issueId: string) => void
  addReservation: (bookId: string, borrowerId: string, borrowerName: string) => void
  getBorrowerOptions: () => Array<{ id: string; name: string; type: 'student' | 'teacher'; detail: string }>
}

// ─── DB row types (GET /api/library) ───────────────────────────────────

/** LibraryBook row subset as returned by the API. */
export interface LibraryBookDTO {
  id: string
  title: string
  author?: string | null
  isbn?: string | null
  category?: string | null
  publisher?: string | null
  copies: number
  available: number
  shelf?: string | null
  _count?: { issues?: number }
}

/** BookIssue row subset (status ISSUED, include book + student.user.name). */
export interface BookIssueDTO {
  id: string
  bookId: string
  book?: { title?: string | null; schoolId?: string }
  studentId: string
  student?: {
    admissionNo?: string | null
    user?: { name?: string | null }
  } | null
  issuedDate?: string | null
  dueDate: string
  returnDate?: string | null
  status: string
}

/** True when the module should operate server-authoritatively. */
function serverModeActive(): boolean {
  return useLibraryStore.getState().serverStatus === 'ready' && !readIsDemoTenant()
}

/** LibraryBook row → store Book (issued = copies − available; status derived). */
export function libraryBookToStoreBook(b: LibraryBookDTO): Book {
  const issued = Math.max(0, b.copies - b.available)
  const status: BookStatus = b.available <= 0 ? 'Out of Stock' : b.available <= 3 ? 'Low Stock' : 'Available'
  return {
    id: b.id,
    title: b.title,
    author: b.author ?? '—',
    isbn: b.isbn ?? '',
    category: (b.category ?? 'Reference') as Book['category'],
    publisher: b.publisher ?? undefined,
    copies: b.copies,
    issued,
    available: b.available,
    status,
  }
}

/** BookIssue row → store IssueRecord (Overdue derived from dueDate; no server fines). */
export function bookIssueToStoreIssue(i: BookIssueDTO): IssueRecord {
  const due = String(i.dueDate).slice(0, 10)
  const today = new Date().toISOString().slice(0, 10)
  return {
    id: i.id,
    bookId: i.bookId,
    bookTitle: i.book?.title ?? '—',
    borrowerId: i.studentId,
    borrowerName: i.student?.user?.name ?? '—',
    borrowerType: 'student',
    admissionNo: i.student?.admissionNo ?? undefined,
    class: undefined,
    issueDate: String(i.issuedDate ?? i.dueDate).slice(0, 10),
    dueDate: due,
    status: due < today ? 'Overdue' : 'Issued',
    fine: 0,
    fineStatus: 'Pending',
  }
}

export const useLibraryStore = create<LibraryState>()(
  persist(
    (set, get) => ({
  // FINAL-GATE (EG-9F/R4) — the seed corpus above is the sanctioned DEMO
  // TIER content (School.isDemo): the store boots EMPTY and the Library
  // module roots apply it once per session via `ensureDemoSeed`. A real
  // production tenant keeps the honest empty state; persisted tenant-
  // scoped state always wins over re-seeding.
  books: [],
  issues: [],
  reservations: [],
  search: '',
  categoryFilter: 'all',
  availabilityFilter: 'all',
  ensureDemoSeed: () => ensureLibraryDemoSeed(),

  serverBooks: [],
  serverIssues: [],
  serverStatus: 'idle',
  serverPending: false,
  hydrateServerLibrary: (books, issues) => set({ serverBooks: books, serverIssues: issues, serverStatus: 'ready' }),
  setServerStatus: (status) => set({ serverStatus: status }),
  setServerPending: (pending) => set({ serverPending: pending }),

  setSearch: (q) => set({ search: q }),
  setCategoryFilter: (c) => set({ categoryFilter: c }),
  setAvailabilityFilter: (a) => set({ availabilityFilter: a }),

  issueBook: async (bookId, borrowerId, borrowerType) => {
    // SERVER MODE (real tenants): tenant-scoped POST with the
    // transactional stock guard; the feed refetches on success. A
    // failure returns the honest server error — no local fallback row.
    if (serverModeActive()) {
      if (borrowerType === 'teacher') {
        return {
          success: false,
          error: 'Teacher lending is not supported yet (the library register supports student borrowers).',
        }
      }
      const book = get().serverBooks.find((b) => b.id === bookId)
      if (!book) return { success: false, error: 'Book not found' }
      if (book.available <= 0) return { success: false, error: 'No copies available' }
      const due = new Date()
      due.setDate(due.getDate() + 14)
      const student = getStudent(borrowerId)
      if (!student) return { success: false, error: 'Student not found' }
      set({ serverPending: true })
      try {
        const res = await fetch('/api/library', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({
            action: 'issue',
            bookId,
            studentId: borrowerId,
            dueDate: due.toISOString().slice(0, 10),
          }),
        })
        const envelope = (await res.json().catch(() => null)) as { ok?: unknown; error?: { publicMessage?: string; message?: string } } | null
        if (!res.ok || !envelope || envelope.ok !== true) {
          throw new Error(envelope?.error?.publicMessage ?? envelope?.error?.message ?? 'The book could not be issued.')
        }
        await refreshLibraryServerData()
        return { success: true }
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : 'The book could not be issued.' }
      } finally {
        set({ serverPending: false })
      }
    }

    // DEMO MODE — the sanctioned local showcase (unchanged semantics).
    const state = get()
    const book = state.books.find((b) => b.id === bookId)
    if (!book) return { success: false, error: 'Book not found' }
    if (book.available <= 0) return { success: false, error: 'No copies available' }

    let borrowerName = ''
    let admissionNo: string | undefined
    let classInfo: string | undefined

    if (borrowerType === 'student') {
      const student = getStudent(borrowerId)
      if (!student) return { success: false, error: 'Student not found' }
      borrowerName = student.name
      admissionNo = student.admissionNo
      classInfo = student.className
    } else {
      const teacher = getTeacher(borrowerId)
      if (!teacher) return { success: false, error: 'Teacher not found' }
      borrowerName = teacher.name
    }

    const now = new Date()
    const due = new Date(now)
    due.setDate(due.getDate() + 14)

    const issue: IssueRecord = {
      id: `ISS${Date.now()}`,
      bookId,
      bookTitle: book.title,
      borrowerId,
      borrowerName,
      borrowerType,
      admissionNo,
      class: classInfo,
      issueDate: now.toISOString().split('T')[0],
      dueDate: due.toISOString().split('T')[0],
      status: 'Issued',
      fine: 0,
      fineStatus: 'Pending',
    }

    set({
      issues: [issue, ...state.issues],
      books: state.books.map((b) => b.id === bookId
        ? { ...b, issued: b.issued + 1, available: b.available - 1, status: b.available - 1 <= 0 ? 'Out of Stock' : b.available - 1 <= 3 ? 'Low Stock' : 'Available' }
        : b),
    })
    return { success: true }
  },

  returnBook: async (issueId) => {
    // SERVER MODE: conditional ISSUED→RETURNED transition (409 on replay);
    // the feed refetches so stock counters converge from the DB.
    if (serverModeActive()) {
      set({ serverPending: true })
      try {
        const res = await fetch('/api/library', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ action: 'return', issueId }),
        })
        const envelope = (await res.json().catch(() => null)) as { ok?: unknown; error?: { publicMessage?: string; message?: string } } | null
        if (!res.ok || !envelope || envelope.ok !== true) {
          throw new Error(envelope?.error?.publicMessage ?? envelope?.error?.message ?? 'The return could not be recorded.')
        }
        await refreshLibraryServerData()
        return { success: true }
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : 'The return could not be recorded.' }
      } finally {
        set({ serverPending: false })
      }
    }

    // DEMO MODE (unchanged).
    const state = get()
    const issue = state.issues.find((i) => i.id === issueId)
    if (!issue || issue.status === 'Returned') return { success: false, error: 'Already returned' }

    const now = new Date()
    const due = new Date(issue.dueDate)
    const daysLate = Math.max(0, Math.ceil((now.getTime() - due.getTime()) / (1000 * 60 * 60 * 24)))
    const fine = daysLate * FINE_PER_DAY

    set({
      issues: state.issues.map((i) => i.id === issueId
        ? { ...i, status: 'Returned', returnDate: now.toISOString().split('T')[0], fine, fineStatus: fine > 0 ? 'Pending' : 'Pending' }
        : i),
      books: state.books.map((b) => b.id === issue.bookId
        ? { ...b, issued: b.issued - 1, available: b.available + 1, status: b.available + 1 <= 3 && b.available + 1 < b.copies ? 'Low Stock' : 'Available' }
        : b),
    })
    return { success: true }
  },

  sendReminder: (loanId) => {
    const state = get()
    const issue = state.issues.find((i) => i.id === loanId)
    if (!issue || issue.status === 'Returned') return
    set({
      issues: state.issues.map((i) => i.id === loanId
        ? { ...i, reminderSentAt: new Date().toISOString() }
        : i),
    })
  },

  addBook: async (book) => {
    // SERVER MODE: the catalogue write goes to the DB (tenant-scoped
    // create with available = copies); the feed refetches on success.
    if (serverModeActive()) {
      set({ serverPending: true })
      try {
        const res = await fetch('/api/library', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({
            title: book.title,
            author: book.author ?? null,
            isbn: book.isbn ?? null,
            category: book.category ?? null,
            publisher: book.publisher ?? null,
            copies: book.copies,
          }),
        })
        const envelope = (await res.json().catch(() => null)) as { ok?: unknown; error?: { publicMessage?: string; message?: string } } | null
        if (!res.ok || !envelope || envelope.ok !== true) {
          throw new Error(envelope?.error?.publicMessage ?? envelope?.error?.message ?? 'The book could not be added.')
        }
        await refreshLibraryServerData()
        return { success: true }
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : 'The book could not be added.' }
      } finally {
        set({ serverPending: false })
      }
    }

    // DEMO MODE (unchanged).
    const state = get()
    const id = `BK${String(state.books.length + 1).padStart(3, '0')}${Date.now().toString(36)}`
    const newBook: Book = {
      ...book,
      id,
      issued: 0,
      available: book.copies,
      status: 'Available',
    }
    set({ books: [newBook, ...state.books] })
    return { success: true }
  },

  payFine: (issueId) => {
    const state = get()
    set({
      issues: state.issues.map((i) => i.id === issueId ? { ...i, fineStatus: 'Paid' } : i),
    })
  },

  waiveFine: (issueId) => {
    const state = get()
    // The fine AMOUNT is a recorded fact — waiving forgives collection, it
    // must not erase the incurred amount (payFine keeps it too). Zeroing it
    // here made every "Waived ₹" figure in the Fines summary read ₹0.
    set({
      issues: state.issues.map((i) => i.id === issueId ? { ...i, fineStatus: 'Waived' } : i),
    })
  },

  addReservation: (bookId, borrowerId, borrowerName) => {
    const state = get()
    const book = state.books.find((b) => b.id === bookId)
    if (!book) return
    const reservation: Reservation = {
      id: `RES${Date.now()}`,
      bookId,
      bookTitle: book.title,
      borrowerId,
      borrowerName,
      date: new Date().toISOString().split('T')[0],
      status: 'Waiting',
    }
    set({ reservations: [reservation, ...state.reservations] })
  },

  getBorrowerOptions: () => {
    const students = useStudentsStore.getState().students.filter((s) => s.status === 'Active')
    const studentOptions = students.slice(0, 20).map((s) => ({
      id: s.id,
      name: s.name,
      type: 'student' as const,
      detail: `${s.admissionNo} · ${s.className}-${s.section}`,
    }))
    // SERVER MODE: student borrowers only — BookIssue's schema has no
    // teacher column, so offering teachers would silently fail.
    if (serverModeActive()) return studentOptions
    // DEMO MODE: the REAL teacher directory (roster-synced records),
    // never the fabricated mock/teachers personas.
    const teacherOptions = useTeachersStore
      .getState()
      .teachers.slice(0, 10)
      .map((t) => ({
        id: t.id,
        name: t.name,
        type: 'teacher' as const,
        detail: `${t.designation} · ${t.department}`,
      }))
    return [...studentOptions, ...teacherOptions]
  },
    }),
    {
      name: 'scholario-library-v1',
      storage: createTenantScopedStorage('scholario-library-v1'),
      // v2 — borrowers re-pointed to the canonical students-store roster
      // (names/classes/admission numbers now cross-module consistent).
      // Version bump discards stale v1 seed state once and re-seeds.
      version: 3,
      // DATA slices only — search/filters are UI state, actions are functions.
      partialize: (s) => ({ books: s.books, issues: s.issues, reservations: s.reservations }),
    },
  ),
)

// ─── FINAL-GATE (EG-9F/R4) demo-tier seeder ──────────────────────────
// Built lazily on first call (the store exists by then). Applies the
// sanctioned demo corpus at most once, never over non-pristine state —
// see makeDemoSeedApplier guard rules.
let _ensureLibraryDemoSeed: (() => void) | null = null
function ensureLibraryDemoSeed(): void {
  _ensureLibraryDemoSeed ??= makeDemoSeedApplier(useLibraryStore, {
    books: SEED_BOOKS,
    issues: [...SESSION_BORROWER_ISSUES, ...SEED_ISSUES],
    reservations: SEED_RESERVATIONS,
  })
  _ensureLibraryDemoSeed()
}

// ─── Server feed (GET /api/library) ─────────────────────────────────

/**
 * Fetch the school's catalogue + active issue register and hydrate the
 * store's server slices. Fail-closed: on failure the previous server rows
 * stay and serverStatus flips to 'error' (the module shows an honest retry
 * banner; it never fabricates rows). Callers: the module root on mount and
 * the server mutations after success.
 */
export async function refreshLibraryServerData(): Promise<void> {
  const store = useLibraryStore.getState()
  store.setServerStatus('loading')
  try {
    const res = await fetch('/api/library', { cache: 'no-store', credentials: 'same-origin' })
    let json: unknown = null
    try {
      json = await res.json()
    } catch {
      /* non-JSON body — handled below */
    }
    const envelope = json as
      | { ok?: unknown; data?: { books?: LibraryBookDTO[]; issues?: BookIssueDTO[] } }
      | null
    if (!res.ok || !envelope || envelope.ok !== true || !Array.isArray(envelope.data?.books)) {
      throw new Error(`library feed failed (${res.status})`)
    }
    const books = (envelope.data?.books ?? []).map(libraryBookToStoreBook)
    const issues = (envelope.data?.issues ?? []).map(bookIssueToStoreIssue)
    useLibraryStore.getState().hydrateServerLibrary(books, issues)
  } catch {
    useLibraryStore.getState().setServerStatus('error')
  }
}

// ─── Hook: Library Analytics ─────────────────────────────────────────

/** True (reactive) when the module runs server-authoritatively. */
export function useLibraryServerMode(): boolean {
  const serverStatus = useLibraryStore((s) => s.serverStatus)
  const isDemo = useIsDemoTenant()
  return serverStatus === 'ready' && !isDemo
}

/** Effective catalogue — server rows in server mode, local/demo otherwise. */
export function useEffectiveLibraryBooks(): Book[] {
  const local = useLibraryStore((s) => s.books)
  const server = useLibraryStore((s) => s.serverBooks)
  return useLibraryServerMode() ? server : local
}

/** Effective issue register — server rows in server mode, local/demo otherwise. */
export function useEffectiveLibraryIssues(): IssueRecord[] {
  const local = useLibraryStore((s) => s.issues)
  const server = useLibraryStore((s) => s.serverIssues)
  return useLibraryServerMode() ? server : local
}

export function useLibraryData() {
  const localBooks = useLibraryStore((s) => s.books)
  const localIssues = useLibraryStore((s) => s.issues)
  const reservations = useLibraryStore((s) => s.reservations)
  const serverBooks = useLibraryStore((s) => s.serverBooks)
  const serverIssues = useLibraryStore((s) => s.serverIssues)
  const serverMode = useLibraryServerMode()

  // SERVER MODE: DB rows are the truth (demo tenant keeps the curated
  // local showcase; while loading both fall back to local/empty honestly).
  const books = serverMode ? serverBooks : localBooks
  const issues = serverMode ? serverIssues : localIssues

  return useMemo(() => {
    const totalBooks = books.reduce((s, b) => s + b.copies, 0)
    const totalIssued = books.reduce((s, b) => s + b.issued, 0)
    const totalAvailable = books.reduce((s, b) => s + b.available, 0)
    const overdue = issues.filter((i) => i.status === 'Overdue')
    const totalFines = issues.filter((i) => i.fineStatus === 'Pending').reduce((s, i) => s + i.fine, 0)
    const collectedFines = issues.filter((i) => i.fineStatus === 'Paid').reduce((s, i) => s + i.fine, 0)
    const activeIssues = issues.filter((i) => i.status !== 'Returned')

    const byCategory = [
      { name: 'Fiction', value: books.filter((b) => b.category === 'Fiction').reduce((s, b) => s + b.copies, 0), color: 'oklch(0.55 0.14 162)' },
      { name: 'Reference', value: books.filter((b) => b.category === 'Reference').reduce((s, b) => s + b.copies, 0), color: 'oklch(0.65 0.16 75)' },
      { name: 'Textbooks', value: books.filter((b) => b.category === 'Textbooks').reduce((s, b) => s + b.copies, 0), color: 'oklch(0.6 0.18 300)' },
      { name: 'Story Books', value: books.filter((b) => b.category === 'Story Books').reduce((s, b) => s + b.copies, 0), color: 'oklch(0.7 0.15 200)' },
      { name: 'Biography', value: books.filter((b) => b.category === 'Biography').reduce((s, b) => s + b.copies, 0), color: 'oklch(0.62 0.2 25)' },
      { name: 'Science', value: books.filter((b) => b.category === 'Science').reduce((s, b) => s + b.copies, 0), color: 'oklch(0.55 0.16 250)' },
      { name: 'Magazines', value: books.filter((b) => b.category === 'Magazines').reduce((s, b) => s + b.copies, 0), color: 'oklch(0.7 0.15 60)' },
    ]

    // Copy before sorting — .sort() mutates in place and would reorder the
    // persisted catalogue (visible in the Books Catalogue after visiting Reports).
    const mostIssued = [...books].sort((a, b) => b.issued - a.issued).slice(0, 5)

    return {
      books, issues, reservations,
      serverMode,
      analytics: {
        totalBooks, totalIssued, totalAvailable,
        overdueCount: overdue.length,
        totalFines, collectedFines,
        activeIssuesCount: activeIssues.length,
        byCategory, mostIssued,
        overdue, activeIssues,
      },
    }
  }, [books, issues, reservations, serverMode])
}
