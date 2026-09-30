import { assertModuleEnabled } from '@/lib/platform/module-flags'
import { NextRequest } from 'next/server'
import { db, trackedTransaction } from '@/lib/db'
import { withAuthz } from '@/lib/security/authz'
import { AppError } from '@/lib/security/errors'

export const runtime = 'nodejs'

/// Library catalogue + issue register.
///
/// 3-c fixes:
///   · GET: gated through the permission matrix ('school.library.manage',
///     PRINCIPAL / MANAGEMENT) instead of a route-local roles array.
///     (Client-grep: the principal Library module renders the
///     library-store mock — no client fetches this route.)
///   · POST 'issue': body.studentId is validated in-tenant BEFORE the
///     BookIssue.create (db.student.findFirst({ id, schoolId }) → 404).
///     BookIssue has NO schoolId column — its tenancy is transitive via
///     the book, so an unvalidated studentId was a cross-tenant FK write
///     (any school's student id could be linked to this school's book).
export async function GET() {
  return withAuthz({ permission: 'school.library.manage' }, async (ctx) => {
    // PHASE 6 — platform module switch (school override ?? platform master).
    await assertModuleEnabled(ctx.schoolId, 'library')
    const schoolId = ctx.schoolId
    const books = await db.libraryBook.findMany({
      where: { schoolId },
      orderBy: { title: 'asc' },
      include: { _count: { select: { issues: true } } },
      take: 300,
    })
    const issues = await db.bookIssue.findMany({
      where: { status: 'ISSUED', book: { schoolId } },
      include: { book: true, student: { include: { user: { select: { name: true } } } } },
      take: 100,
    })
    return { books, issues }
  })
}

export async function POST(req: NextRequest) {
  return withAuthz({ permission: 'school.library.manage' }, async (ctx) => {
    const schoolId = ctx.schoolId
    const body = await req.json().catch(() => ({}))
    const action = body.action

    if (action === 'issue') {
      const book = await db.libraryBook.findUnique({ where: { id: body.bookId } })
      if (!book || book.schoolId !== schoolId) throw new AppError('RESOURCE_NOT_FOUND')
      if (book.available <= 0) throw new AppError('INVALID_INPUT', { publicMessage: 'No copies available' })

      // 3-c fix: the borrower must exist in THIS school before the
      // BookIssue row is created (BookIssue has no schoolId of its own).
      const student = await db.student.findFirst({
        where: { id: body.studentId, schoolId },
        select: { id: true },
      })
      if (!student) {
        throw new AppError('RESOURCE_NOT_FOUND', {
          publicMessage: 'Student not found',
          internalDetail: `library issue: student ${body.studentId} missing or foreign tenant`,
        })
      }

      // Phase 3: the issue + the stock decrement are one interactive
      // transaction with the availability RE-CHECKED inside it — two
      // concurrent issues of the last copy can no longer both decrement
      // (the available 0..copies DB bound-guard backstops).
      const issue = await trackedTransaction('library-issue', async (tx) => {
        const fresh = await tx.libraryBook.findUnique({
          where: { id: book.id },
          select: { available: true },
        })
        if (!fresh || fresh.available <= 0) {
          throw new AppError('INVALID_INPUT', { publicMessage: 'No copies available' })
        }
        const created = await tx.bookIssue.create({
          data: {
            bookId: book.id,
            studentId: student.id,
            dueDate: body.dueDate ? new Date(body.dueDate) : new Date(Date.now() + 14 * 86400000),
            status: 'ISSUED',
          },
        })
        await tx.libraryBook.update({ where: { id: book.id }, data: { available: { decrement: 1 } } })
        return created
      })
      return issue
    }

    if (action === 'return') {
      const issue = await db.bookIssue.findUnique({ where: { id: body.issueId }, include: { book: true } })
      if (!issue) throw new AppError('RESOURCE_NOT_FOUND')
      if (issue.book.schoolId !== schoolId) throw new AppError('FORBIDDEN')
      const returnedAt = new Date()
      // Phase 3: CONDITIONAL transition — only an ISSUED row can be
      // returned. count === 0 → the book was already returned (a replayed
      // request lost the race) → 409 CONFLICT, and the stock counter is
      // NOT incremented again (closes the double-increment bug).
      const transitioned = await trackedTransaction('library-return', async (tx) => {
        const transition = await tx.bookIssue.updateMany({
          where: { id: issue.id, status: 'ISSUED' },
          data: { returnDate: returnedAt, status: 'RETURNED' },
        })
        if (transition.count === 1) {
          await tx.libraryBook.update({
            where: { id: issue.bookId },
            data: { available: { increment: 1 } },
          })
        }
        return transition.count
      })
      if (transitioned === 0) {
        throw new AppError('CONFLICT', {
          publicMessage: 'This book is already returned',
          internalDetail: `library return: issue ${issue.id} was not in ISSUED state (already returned)`,
        })
      }
      return { ok: true }
    }

    // add book
    const title = String(body.title || '').trim()
    if (!title) throw new AppError('INVALID_INPUT', { publicMessage: 'Title required' })
    const copies = Number(body.copies) || 1
    const book = await db.libraryBook.create({
      data: {
        schoolId,
        title,
        author: body.author || null,
        isbn: body.isbn || null,
        category: body.category || null,
        publisher: body.publisher || null,
        copies,
        available: copies,
        shelf: body.shelf || null,
      },
    })
    return book
  })
}
