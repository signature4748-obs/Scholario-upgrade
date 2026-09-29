import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
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
      if (!book || book.schoolId !== schoolId) throw new AppError('NOT_FOUND')
      if (book.available <= 0) throw new AppError('INVALID_INPUT', { publicMessage: 'No copies available' })

      // 3-c fix: the borrower must exist in THIS school before the
      // BookIssue row is created (BookIssue has no schoolId of its own).
      const student = await db.student.findFirst({
        where: { id: body.studentId, schoolId },
        select: { id: true },
      })
      if (!student) {
        throw new AppError('NOT_FOUND', {
          publicMessage: 'Student not found',
          internalDetail: `library issue: student ${body.studentId} missing or foreign tenant`,
        })
      }

      const issue = await db.$transaction([
        db.bookIssue.create({
          data: {
            bookId: book.id,
            studentId: student.id,
            dueDate: body.dueDate ? new Date(body.dueDate) : new Date(Date.now() + 14 * 86400000),
            status: 'ISSUED',
          },
        }),
        db.libraryBook.update({ where: { id: book.id }, data: { available: { decrement: 1 } } }),
      ])
      return issue[0]
    }

    if (action === 'return') {
      const issue = await db.bookIssue.findUnique({ where: { id: body.issueId }, include: { book: true } })
      if (!issue) throw new AppError('NOT_FOUND')
      if (issue.book.schoolId !== schoolId) throw new AppError('FORBIDDEN')
      await db.$transaction([
        db.bookIssue.update({ where: { id: issue.id }, data: { returnDate: new Date(), status: 'RETURNED' } }),
        db.libraryBook.update({ where: { id: issue.bookId }, data: { available: { increment: 1 } } }),
      ])
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
