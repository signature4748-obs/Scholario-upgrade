import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { withAuthz } from '@/lib/security/authz'
import { parseJsonBody, parseQuery, idSchema, safeText, enumSchema, boundedInt } from '@/lib/security/validation'

export const runtime = 'nodejs'

/**
 * Question bank — school-scoped staff surface (audit 3-b).
 *
 * Client usage was verified before gating: NO student/parent surface
 * consumes /api/questions (the question-bank UI lives in the staff exams
 * domain only), so the answer key is served in full to
 * PRINCIPAL / MANAGEMENT / TEACHER via the server-side capability
 * 'school.questionbank.read' — everyone else is refused at the gate.
 */
export async function GET(req: NextRequest) {
  return withAuthz({ permission: 'school.questionbank.read' }, async (ctx) => {
    const { subjectId, classId, difficulty } = await parseQuery(
      req,
      z
        .object({
          subjectId: idSchema.optional(),
          classId: idSchema.optional(),
          difficulty: enumSchema(['EASY', 'MEDIUM', 'HARD']).optional(),
        })
        .strict(),
    )
    const questions = await db.questionBank.findMany({
      where: {
        schoolId: ctx.schoolId,
        ...(subjectId ? { subjectId } : {}),
        ...(classId ? { classId } : {}),
        ...(difficulty ? { difficulty } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    })
    return questions
  })
}

const questionPostSchema = z
  .object({
    subjectId: idSchema.optional(),
    classId: idSchema.optional(),
    question: safeText(2000),
    optionA: safeText(1000).optional(),
    optionB: safeText(1000).optional(),
    optionC: safeText(1000).optional(),
    optionD: safeText(1000).optional(),
    answer: safeText(400).optional(),
    type: enumSchema(['MCQ', 'TRUE_FALSE', 'SHORT_ANSWER', 'LONG_ANSWER', 'FILL_IN_THE_BLANK']).optional(),
    difficulty: enumSchema(['EASY', 'MEDIUM', 'HARD']).optional(),
    marks: boundedInt(1, 100).optional(),
  })
  .strict()

export async function POST(req: NextRequest) {
  return withAuthz({ permission: 'school.questionbank.write' }, async (ctx) => {
    const body = await parseJsonBody(req, questionPostSchema)

    // FK-in-tenant (audit 3-b LOW): subjectId/classId, when given, must
    // belong to the caller's school before they are linked into the row.
    if (body.subjectId) {
      const subject = await db.subject.findFirst({
        where: { id: body.subjectId, schoolId: ctx.schoolId },
        select: { id: true },
      })
      if (!subject) throw new Error('NOT_FOUND')
    }
    if (body.classId) {
      const cls = await db.class.findFirst({
        where: { id: body.classId, schoolId: ctx.schoolId },
        select: { id: true },
      })
      if (!cls) throw new Error('NOT_FOUND')
    }

    const q = await db.questionBank.create({
      data: {
        schoolId: ctx.schoolId,
        subjectId: body.subjectId ?? null,
        classId: body.classId ?? null,
        question: body.question,
        optionA: body.optionA ?? null,
        optionB: body.optionB ?? null,
        optionC: body.optionC ?? null,
        optionD: body.optionD ?? null,
        answer: body.answer ?? '',
        type: body.type ?? 'MCQ',
        difficulty: body.difficulty ?? 'MEDIUM',
        marks: body.marks ?? 1,
      },
    })
    return q
  })
}

export async function DELETE(req: NextRequest) {
  return withAuthz({ permission: 'school.questionbank.write' }, async (ctx) => {
    const { id } = await parseQuery(req, z.object({ id: idSchema }).strict())
    // Tenant guard (audit 3-b CRITICAL): the delete is scoped to the
    // caller's school — a foreign-tenant id deletes nothing and 404s.
    const deleted = await db.questionBank.deleteMany({ where: { id, schoolId: ctx.schoolId } })
    if (deleted.count === 0) throw new Error('NOT_FOUND')
    return { id }
  })
}
