import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { AppError } from '@/lib/security/errors'
import { withPlatform } from '@/lib/platform/authz'
import { platformAuditEvent } from '@/lib/platform/audit'
import { parseJsonBody, strictBody } from '@/lib/security/validation'
import { clientIpFromHeaders } from '@/lib/security/rate-limit'
import { z } from 'zod'

export const runtime = 'nodejs'

const studentAccessSchema = strictBody({
  action: z.enum(['pause', 'resume']),
  reason: z.string().min(10).max(400),
})

/**
 * POST /api/platform/schools/[id]/student-access — the DISTINCT,
 * clearly-named "pause student access" operation (mission §3). This is
 * NOT a school suspension: the tenant and its staff keep working while
 * ONLY student accounts lose access.
 *
 * Enforcement is SERVER-SIDE and real — never a database flag with no
 * effect:
 *   · pause  → every STUDENT User of this school whose account is not
 *     already locked gets User.subscriptionStatus = 'LOCKED'. The
 *     documented LOCKED semantics (src/lib/entitlement + withUser,
 *     regression-tested in tests/security/subscription-lock.test.ts)
 *     reject every business API with SUBSCRIPTION_REQUIRED while the
 *     account can still authenticate and see its identity/subscription
 *     surfaces. Records, admission numbers, marks, fees and attendance
 *     are preserved untouched.
 *   · resume → only the accounts the pause actually locked (the
 *     affectedUserIds recorded in School.settings.studentAccessPause),
 *     and only those still LOCKED, return to 'ACTIVE'. Accounts locked
 *     individually for other reasons are never blindly unlocked.
 *
 * The affected id list lives in the school's settings JSON
 * (platform-owned key, merge-preserved by the school-plane
 * mergeSettings contract) because audit metadata is bounded (2000
 * chars) — the audit row carries the count + reason; the settings
 * record carries the resumable scope.
 *
 * Honest semantics displayed in the UI: a pause covers the students
 * that exist at pause time. Students admitted afterwards are NOT
 * auto-locked — pause again to include them.
 *
 * Permission: schools.manage + STEP-UP. Effects + reason audited
 * (platform.school.student_access_paused / _resumed).
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return withPlatform(
    { permission: 'schools.manage', stepUp: true },
    async (ctx) => {
      const body = await parseJsonBody(req, studentAccessSchema)
      const ip = clientIpFromHeaders(req.headers)

      const school = await db.school.findUnique({ where: { id } })
      if (!school) {
        throw new AppError('RESOURCE_NOT_FOUND', { publicMessage: 'School not found' })
      }

      // The platform-owned settings JSON is merged key-by-key on the
      // school plane (mergeSettings) — unknown-to-school keys persist.
      let settings: Record<string, unknown> = {}
      try {
        settings = school.settings ? (JSON.parse(school.settings) as Record<string, unknown>) : {}
      } catch {
        settings = {}
      }
      const pauseRecord = settings.studentAccessPause as
        | { pausedAt: string; reason: string; actorId: string; affectedCount: number; affectedUserIds: string[] }
        | undefined

      if (body.action === 'pause') {
        if (pauseRecord) {
          throw new AppError('CONFLICT', {
            publicMessage: 'Student access is already paused for this school — resume it first',
          })
        }

        const result = await db.$transaction(async (tx) => {
          // Lock exactly the school's currently-unlocked student accounts.
          const affected = await tx.user.findMany({
            where: { schoolId: school.id, role: 'STUDENT', subscriptionStatus: { not: 'LOCKED' } },
            select: { id: true },
          })
          const affectedUserIds = affected.map((u) => u.id)
          if (affectedUserIds.length > 0) {
            await tx.user.updateMany({
              where: { id: { in: affectedUserIds } },
              data: { subscriptionStatus: 'LOCKED' },
            })
          }
          const nextSettings = {
            ...settings,
            studentAccessPause: {
              pausedAt: new Date().toISOString(),
              reason: body.reason,
              actorId: ctx.admin.id,
              affectedCount: affectedUserIds.length,
              affectedUserIds,
            },
          }
          await tx.school.update({
            where: { id: school.id },
            data: { settings: JSON.stringify(nextSettings) },
          })
          return { affectedCount: affectedUserIds.length, affectedUserIds }
        })

        await platformAuditEvent({
          adminId: ctx.admin.id,
          action: 'platform.school.student_access_paused',
          targetType: 'SCHOOL',
          targetId: school.id,
          schoolId: school.id,
          ip,
          reason: body.reason,
          metadata: { affectedCount: result.affectedCount },
        })

        return {
          paused: true as const,
          affectedCount: result.affectedCount,
          note:
            result.affectedCount === 0
              ? 'No unlocked student accounts existed at pause time — nothing was locked. Students admitted after this point are not automatically paused; pause again to include them.'
              : 'Student accounts are locked out of business APIs (server-enforced) and can still sign in to review their account status. Students admitted later are not automatically paused.',
        }
      }

      // ── resume ─────────────────────────────────────────────────────
      if (!pauseRecord) {
        throw new AppError('CONFLICT', {
          publicMessage: 'Student access is not paused for this school',
        })
      }
      const scopedIds = Array.isArray(pauseRecord.affectedUserIds) ? pauseRecord.affectedUserIds : []

      const result = await db.$transaction(async (tx) => {
        // Resume ONLY the pause's scope, only accounts still LOCKED
        // (an individually-locked account keeps its lock), and only
        // student accounts still belonging to this tenant.
        const resumed = await tx.user.updateMany({
          where: {
            id: { in: scopedIds },
            schoolId: school.id,
            role: 'STUDENT',
            subscriptionStatus: 'LOCKED',
          },
          data: { subscriptionStatus: 'ACTIVE' },
        })
        const nextSettings = { ...settings }
        delete nextSettings.studentAccessPause
        await tx.school.update({
          where: { id: school.id },
          data: { settings: JSON.stringify(nextSettings) },
        })
        return { resumedCount: resumed.count }
      })

      await platformAuditEvent({
        adminId: ctx.admin.id,
        action: 'platform.school.student_access_resumed',
        targetType: 'SCHOOL',
        targetId: school.id,
        schoolId: school.id,
        ip,
        reason: body.reason,
        metadata: { resumedCount: result.resumedCount, pausedScope: scopedIds.length },
      })

      return {
        paused: false as const,
        resumedCount: result.resumedCount,
        note:
          result.resumedCount === scopedIds.length
            ? 'All paused student accounts were restored.'
            : `${scopedIds.length - result.resumedCount} account(s) from the original pause were left locked — they were locked individually for other reasons, or no longer belong to this school.`,
      }
    },
    { method: 'POST' },
  )
}
