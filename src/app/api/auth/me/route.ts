import { getCurrentUser, getCurrentSession, parseUserAgent } from '@/lib/auth'
import { api } from '@/lib/api'

export const runtime = 'nodejs'

/**
 * GET /api/auth/me
 *
 * Session identity (server truth) for the shell + Settings. SS-1 adds the
 * CURRENT session's context (started/expires/device) — never the token —
 * and the account's lastLoginAt so Login & Security can render real
 * sign-in information instead of fabricating it.
 *
 * SD-3 — STUDENT users additionally get their server-resolved enrollment
 * context (class label + roll number) so the shell identity surfaces
 * (sidebar, role label) never disagree with the server-side dashboard.
 */
export async function GET() {
  return api(async () => {
    const user = await getCurrentUser()
    if (!user) throw new Error('UNAUTHORIZED')
    // Task 4-d (fix #9) — mirror withUser semantics: a non-ACTIVE account
    // (suspended/pending) must not read its own session context.
    if (user.status !== 'ACTIVE') throw new Error('UNAUTHORIZED')

    const session = await getCurrentSession()
    const ua = parseUserAgent(session?.userAgent ?? null)

    return {
      user: { ...user, student: user.role === 'STUDENT' ? await getStudentContext(user) : undefined },
      session: session
        ? {
            createdAt: session.createdAt,
            expiresAt: session.expiresAt,
            userAgent: session.userAgent,
            ipAddress: session.ipAddress,
            device: ua,
          }
        : null,
      lastLoginAt: await getLastLoginAt(user.id),
    }
  })
}

/** Server-side enrollment resolution: user → student → class (never the
 *  client roster). Returns null when the account has no student record.
 *  Carries every identity-bearing particular the student-facing surfaces
 *  (profile, ID card, headers) display — so they can never disagree with
 *  the session/DB truth. */
async function getStudentContext(user: { id: string; schoolId: string | null }) {
  const { db } = await import('@/lib/db')
  const row = await db.user.findUnique({
    where: { id: user.id },
    include: { student: { include: { class: { select: { name: true, section: true } } } } },
  })
  const student = row?.student
  if (!student) return null
  // The class name may already carry the section ("Grade 9 - A") — never
  // render it twice.
  const cls = student.class
  const classLabel = cls
    ? cls.section && new RegExp(`[-–\\s]${cls.section.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i').test(cls.name)
      ? cls.name
      : `${cls.name}${cls.section ? ` - ${cls.section}` : ''}`
    : null
  return {
    classLabel,
    rollNo: student.rollNo,
    admissionNo: student.admissionNo,
    dob: student.dob,
    gender: student.gender,
    bloodGroup: student.bloodGroup,
    guardianName: student.guardianName,
    guardianPhone: student.guardianPhone,
    address: student.address,
  }
}

async function getLastLoginAt(userId: string) {
  const { db } = await import('@/lib/db')
  const row = await db.user.findUnique({
    where: { id: userId },
    select: { lastLoginAt: true },
  })
  return row?.lastLoginAt ?? null
}
