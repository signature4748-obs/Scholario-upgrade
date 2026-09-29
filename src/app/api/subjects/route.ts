import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withUser, schoolScoped } from '@/lib/api'
import { AppError } from '@/lib/security/errors'

export const runtime = 'nodejs'

const MARKS_MIN = 0
const MARKS_MAX = 1000

export async function GET(req: NextRequest) {
  return withUser(async (user) => {
    const schoolId = schoolScoped(user)
    const { searchParams } = new URL(req.url)
    const classId = searchParams.get('classId')
    const subjects = await db.subject.findMany({
      where: { schoolId, ...(classId ? { classId } : {}) },
      orderBy: { name: 'asc' },
    })
    return subjects
  })
}

export async function POST(req: NextRequest) {
  return withUser(
    async (user) => {
      const schoolId = schoolScoped(user)
      const body = await req.json().catch(() => ({}))
      const name = String(body.name || '').trim()
      const code = String(body.code || '').trim().toUpperCase()
      if (!name || !code) throw new AppError('INVALID_INPUT', { publicMessage: 'Name and code required' })

      // Task 4-d (audit 3-a fix #5): subjects are SCHOOL MASTER DATA —
      // the permission matrix grants 'school.masterdata.write' to
      // PRINCIPAL/MANAGEMENT only, and TEACHER is removed from this
      // route's roles. Grep-verified client evidence: NO surface under
      // src/components/** or src/lib/** calls POST /api/subjects (the
      // subjects registry flows through /api/students/roster and the
      // principal academics module) — no teacher flow to preserve.

      // classId is client input — verify the class belongs to the CALLER's
      // school before linking (cross-tenant FK guard, fail-safe 404).
      const classId =
        typeof body.classId === 'string' && body.classId.trim() ? body.classId.trim() : null
      if (classId) {
        const cls = await db.class.findFirst({
          where: { id: classId, schoolId },
          select: { id: true },
        })
        if (!cls) {
          throw new AppError('NOT_FOUND', { publicMessage: 'Class not found' })
        }
      }

      // Marks bounds — junk numbers must not poison exam mark scaling.
      const clampMarks = (value: unknown, fallback: number): number => {
        const n = Number(value)
        if (!Number.isFinite(n)) return fallback
        return Math.min(MARKS_MAX, Math.max(MARKS_MIN, Math.round(n)))
      }

      const s = await db.subject.create({
        data: {
          schoolId,
          classId,
          name,
          code,
          fullMarks: clampMarks(body.fullMarks, 100),
          passMarks: clampMarks(body.passMarks, 33),
        },
      })
      return s
    },
    // Audit 3-a fix #5 — master-data write is P/M (matrix:
    // 'school.masterdata.write'); TEACHER removed.
    { roles: ['PRINCIPAL', 'MANAGEMENT'] }
  )
}
