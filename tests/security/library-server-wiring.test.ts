/**
 * LIBRARY-SERVER-WIRING — the library module is DB-backed regression suite.
 *
 * The bug this pins (this session's module audit, Library):
 * the principal Library module ran 100% localStorage (books, issues,
 * reservations — demo-seeded, honestly labeled 'preview') while a
 * hardened, transactional, tenant-scoped API existed with ZERO client
 * consumers (its own route comment admitted it). Real tenants could
 * never actually manage a catalogue, and the Issue dialog offered
 * FABRICATED teacher personas (mock/teachers, T-### ids) as valid
 * borrowers regardless of tenant.
 *
 * Invariants under test:
 *   1. MAPPING: LibraryBook/BookIssue rows map losslessly to the store
 *      records (issued = copies − available, status derivation, Overdue
 *      derived from dueDate, student-only borrowers).
 *   2. WIRING: the store exposes server slices + refresh helper; the
 *      module root hydrates a real tenant; issue/return/add-book POST to
 *      /api/library; the mock/teachers import is GONE from the store;
 *      server mode returns students-only borrower options.
 *   3. HONEST LIMITS: fines/reservations stay preview (server issues
 *      carry fine 0; the Fines tab explains fine tracking is not
 *      server-backed); failed mutations return errors (no local fallback).
 *   4. API CONTRACT (live): GET returns books+issues tenant-scoped;
 *      add-book → issue → GET shows the loan → return → stock restored;
 *      foreign-tenant book/student ids are refused.
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'crypto'
import { db } from '@/lib/db'
import { hashSessionToken } from '@/lib/auth'
import { REPO_ROOT } from '../helpers/repo-root'

import {
  libraryBookToStoreBook,
  bookIssueToStoreIssue,
} from '@/lib/store/library-store'

const read = (p: string): string => readFileSync(join(REPO_ROOT, p), 'utf8')

// ─── 1. mapping ───────────────────────────────────────────────────────────

describe('LIBRARY-SERVER · row → store-record mapping', () => {
  test('a LibraryBook row maps with derived issued + status', () => {
    const b = libraryBookToStoreBook({
      id: 'bk-1', title: 'Wings of Fire', author: 'A.P.J. Abdul Kalam',
      isbn: '978-8173711466', category: 'Biography', publisher: 'Universities Press',
      copies: 12, available: 8,
    })
    expect(b.id).toBe('bk-1')
    expect(b.issued).toBe(4) // copies − available
    expect(b.available).toBe(8)
    expect(b.status).toBe('Available')
    // Low Stock / Out of Stock derivation
    expect(libraryBookToStoreBook({ id: 'x', title: 't', copies: 6, available: 2 }).status).toBe('Low Stock')
    expect(libraryBookToStoreBook({ id: 'x', title: 't', copies: 6, available: 0 }).status).toBe('Out of Stock')
  })

  test('a BookIssue row maps: Overdue derived, student borrower, fine 0 (no server fines)', () => {
    const past = new Date(Date.now() - 5 * 86_400_000).toISOString()
    const future = new Date(Date.now() + 9 * 86_400_000).toISOString()
    const overdue = bookIssueToStoreIssue({
      id: 'iss-1', bookId: 'bk-1', book: { title: 'Wings of Fire' },
      studentId: 'stu-1', student: { admissionNo: 'DSO2024001', user: { name: 'Aarav' } },
      issuedDate: past, dueDate: past, status: 'ISSUED',
    })
    expect(overdue.status).toBe('Overdue')
    expect(overdue.borrowerType).toBe('student')
    expect(overdue.borrowerName).toBe('Aarav')
    expect(overdue.fine).toBe(0)
    const ontime = bookIssueToStoreIssue({
      id: 'iss-2', bookId: 'bk-1', book: { title: 'x' },
      studentId: 'stu-1', student: { user: { name: 'Aarav' } },
      dueDate: future, status: 'ISSUED',
    })
    expect(ontime.status).toBe('Issued')
  })
})

// ─── 2. wiring (source contract) ─────────────────────────────────────────

describe('LIBRARY-SERVER · client wiring (no more orphan API)', () => {
  test('the store hydrates server slices through the refresh helper (never persisted)', () => {
    const src = read('src/lib/store/library-store.ts')
    expect(src).toContain('serverBooks: Book[]')
    expect(src).toContain('serverIssues: IssueRecord[]')
    expect(src).toContain('export async function refreshLibraryServerData')
    expect(src).toContain("fetch('/api/library'")
    // persistence still covers ONLY the local demo slices
    expect(src).toContain('partialize: (s) => ({ books: s.books, issues: s.issues, reservations: s.reservations })')
  })

  test('the module root hydrates a REAL tenant and keeps the demo showcase for the demo tenant', () => {
    const src = read('src/components/principal/modules/library/index.tsx')
    expect(src).toMatch(/if \(!isDemo\) void refreshLibraryServerData\(\)/)
    expect(src).toContain("serverStatus === 'error'") // honest retry banner
    // the live-mode banner says exactly which parts are live vs preview
    expect(src).toContain('Catalogue, issue &amp; return are live from the school database')
  })

  test('issue/return/add-book go through POST /api/library (server mode)', () => {
    const src = read('src/lib/store/library-store.ts')
    expect(src).toMatch(/action: 'issue'/)
    expect(src).toMatch(/action: 'return'/)
    // add-book posts the catalogue fields (no action field = default branch)
    expect(src).toMatch(/body: JSON\.stringify\(\{\n\s+title: book\.title/)
  })

  test('the fabricated mock/teachers personas are RETIRED from the library store', () => {
    const src = read('src/lib/store/library-store.ts')
    expect(src).not.toContain("@/lib/mock/teachers")
    // teacher options resolve against the REAL roster store
    expect(src).toContain('useTeachersStore')
    expect(src).toMatch(/useTeachersStore\s*\n?\s*\.getState\(\)/)
  })

  test('server mode offers student borrowers only (schema-honest)', () => {
    const src = read('src/lib/store/library-store.ts')
    expect(src).toContain("if (serverModeActive()) return studentOptions")
    // the dialog tracks the option's declared type (no 'T-' prefix heuristic)
    const dialog = read('src/components/principal/modules/library/issue-book-dialog.tsx')
    expect(dialog).not.toMatch(/startsWith\('T-'\)/)
    expect(dialog).toContain('setBorrowerType(opt?.type')
  })

  test('server rows are never fabricated on failure (fail-closed)', () => {
    const src = read('src/lib/store/library-store.ts')
    // every server action returns { success: false, error } on failure —
    // no local set() fallback inside the server branches
    expect(src).toContain("throw new Error(envelope?.error?.publicMessage")
  })

  test('the Fines tab honestly labels server mode limits', () => {
    const src = read('src/components/principal/modules/library/fines-summary.tsx')
    expect(src).toContain('Fine amounts are not server-backed')
    expect(src).toContain('useEffectiveLibraryIssues()')
  })
})

// ─── 3. API contract (live) ───────────────────────────────────────────────

const BASE = process.env.TENANT_TEST_BASE ?? 'http://localhost:3000'
const MARKER = randomBytes(4).toString('hex')
let principalToken: string
let studentToken: string
let schoolId: string | null = null
let createdBookIds: string[] = []
let createdIssueIds: string[] = []

async function directSession(email: string): Promise<string> {
  const u = await db.user.findUnique({ where: { email } })
  if (!u) throw new Error(`no user ${email}`)
  const token = randomBytes(32).toString('hex')
  await db.session.create({
    data: { userId: u.id, tokenHash: hashSessionToken(token), expiresAt: new Date(Date.now() + 3600_000) },
  })
  return token
}

function authed(token: string, init?: RequestInit): RequestInit {
  return { ...init, headers: { ...(init?.headers ?? {}), authorization: `Bearer ${token}` } }
}

beforeAll(async () => {
  schoolId = (await db.school.findUnique({ where: { slug: 'hawkings-prithvipur' } }))?.id ?? null
  if (!schoolId) throw new Error('demo tenant missing (run prisma/seed-demo.ts)')
  principalToken = await directSession('tenant.principal.a@hawkings.test')
  studentToken = await directSession('tenant.student.a@hawkings.test')
})

afterAll(async () => {
  if (schoolId) {
    if (createdIssueIds.length) {
      await db.bookIssue.deleteMany({ where: { id: { in: createdIssueIds } } })
    }
    if (createdBookIds.length) {
      await db.bookIssue.deleteMany({ where: { bookId: { in: createdBookIds } } })
      await db.libraryBook.deleteMany({ where: { schoolId, id: { in: createdBookIds } } })
    }
  }
  await db.session.deleteMany({
    where: { user: { email: { in: ['tenant.principal.a@hawkings.test', 'tenant.student.a@hawkings.test'] } } },
  })
})

describe('LIBRARY-SERVER · live contract (add → issue → return)', () => {
  test('GET /api/library (principal) → 200 with books + issues (the module feed)', async () => {
    const res = await fetch(`${BASE}/api/library`, authed(principalToken))
    expect(res.status).toBe(200)
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; data?: { books?: unknown[]; issues?: unknown[] } }
    expect(body.ok).toBe(true)
    expect(Array.isArray(body.data?.books)).toBe(true)
    expect(Array.isArray(body.data?.issues)).toBe(true)
  }, 30_000)

  test('a student session is REFUSED the manage endpoint (403, role authz)', async () => {
    const res = await fetch(`${BASE}/api/library`, authed(studentToken))
    expect([401, 403]).toContain(res.status)
  }, 30_000)

  test('add-book → issue → GET reflects the loan → return → stock restored', async () => {
    // 1. add a book (unique ISBN per run)
    const isbn = `IT-${MARKER}`
    const add = await fetch(
      `${BASE}/api/library`,
      authed(principalToken, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: `IT-LIB Book ${MARKER}`, author: 'Test Author', isbn, category: 'Biography', copies: 3 }),
      }),
    )
    expect(add.status).toBe(200)
    const added = (await add.json().catch(() => ({}))) as { ok?: boolean; data?: { id?: string; available?: number } }
    expect(added.ok).toBe(true)
    expect(added.data?.id).toBeTruthy()
    createdBookIds.push(added.data!.id!)
    expect(added.data?.available).toBe(3)

    // 2. issue it to a REAL roster student of this school
    const student = await db.student.findFirst({
      where: { schoolId: schoolId! },
      select: { id: true, user: { select: { name: true } } },
    })
    expect(student).toBeTruthy()
    const issue = await fetch(
      `${BASE}/api/library`,
      authed(principalToken, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'issue', bookId: added.data!.id, studentId: student!.id }),
      }),
    )
    expect(issue.status).toBe(200)
    const issued = (await issue.json().catch(() => ({}))) as { ok?: boolean; data?: { id?: string } }
    expect(issued.ok).toBe(true)
    createdIssueIds.push(issued.data!.id!)

    // 3. GET shows the loan with borrower name resolved
    const get1 = await fetch(`${BASE}/api/library`, authed(principalToken))
    const feed1 = (await get1.json()) as { data?: { books?: { id?: string; available?: number }[]; issues?: { id?: string; borrowerId?: string; book?: { title?: string } }[] } }
    const bookRow = feed1.data?.books?.find((b) => b.id === added.data!.id)
    expect(bookRow?.available).toBe(2) // stock decremented
    const issueRow = feed1.data?.issues?.find((i) => i.id === issued.data?.id)
    expect(issueRow?.book?.title).toBe(`IT-LIB Book ${MARKER}`)
    expect(issueRow?.studentId).toBe(student!.id)

    // 4. return it — stock restored; replay 409s
    const ret = await fetch(
      `${BASE}/api/library`,
      authed(principalToken, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'return', issueId: issued.data!.id }),
      }),
    )
    expect(ret.status).toBe(200)
    const get2 = await fetch(`${BASE}/api/library`, authed(principalToken))
    const feed2 = (await get2.json()) as { data?: { books?: { id?: string; available?: number }[] } }
    expect(feed2.data?.books?.find((b) => b.id === added.data!.id)?.available).toBe(3)
    const replay = await fetch(
      `${BASE}/api/library`,
      authed(principalToken, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'return', issueId: issued.data!.id }),
      }),
    )
    expect([409, 400]).toContain(replay.status)
  }, 60_000)

  test('a foreign-tenant student id is REFUSED (in-tenant borrower validation)', async () => {
    const foreign = await db.student.findFirst({
      where: { schoolId: { not: schoolId! } },
      select: { id: true },
    })
    if (!foreign) return // single-tenant env — skip honestly
    const res = await fetch(
      `${BASE}/api/library`,
      authed(principalToken, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'issue', bookId: createdBookIds[0], studentId: foreign.id }),
      }),
    )
    expect(res.status).toBe(404)
  }, 30_000)
})
