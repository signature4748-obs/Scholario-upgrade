import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { withPlatform } from '@/lib/platform/authz'
import { platformAuditEvent } from '@/lib/platform/audit'
import { AppError } from '@/lib/security/errors'
import { parseJsonBody, strictBody, safeText } from '@/lib/security/validation'
import { clientIpFromHeaders } from '@/lib/security/rate-limit'
import { subjectCodeOf } from '@/lib/platform/subject-code'

export const runtime = 'nodejs'

/** Stream vocabulary exactly as documented on Class.stream (schema.prisma). */
const CLASS_STREAMS = [
  'Science-PCM',
  'Science-PCB',
  'Science-PCMB',
  'Commerce',
  'Humanities',
  'General',
] as const

const bootstrapSchema = strictBody({
  academicYear: z
    .string()
    .trim()
    .regex(/^[0-9]{4}[-/][0-9]{4}$/, 'use the YYYY-YYYY format')
    .optional(),
  board: z.enum(['CBSE', 'UP_BOARD', 'ICSE', 'STATE', 'CUSTOM']).optional(),
  workingDays: z.array(z.enum(['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'])).max(7).optional(),
  classes: z
    .array(
      strictBody({
        name: safeText(40),
        sections: z.array(safeText(8)).max(12).default([]),
        stream: z.enum(CLASS_STREAMS).optional(),
      }),
    )
    .max(40)
    .optional(),
  subjects: z.array(safeText(60)).max(60).optional(),
})

/**
 * POST /api/platform/schools/[id]/academic-bootstrap — the Setup
 * wizard's Academic configuration step (PHASE 2).
 *
 * The platform has NO other write path into a school's academic
 * structure after provisioning (classes/subjects/rooms are school-owned
 * routine work; the school-plane APIs are session-scoped to the
 * principal). This route covers the ONE-TIME initial configuration only:
 * the session year, the working week, the initial class/section grid
 * (with optional streams) and the initial subject list.
 *
 * IDEMPOTENT BY CONSTRUCTION — safe on Save-and-Continue and retries:
 *   · one Class row per (name, section) — existing pairs (payload-internal
 *     AND already persisted in the tenant) are skipped, never duplicated;
 *   · one Subject row per school-unique name (code derived by the SHARED
 *     subjectCodeOf used by provisioning — same vocabulary);
 *   · academicYear/board/workingDays are plain field writes (last save
 *     wins, audited).
 *
 * The school keeps full ownership AFTER handover: classes, sections,
 * subjects, streams and class-teacher appointments remain the
 * principal's routine work (school-plane APIs) — this route does not
 * duplicate those surfaces.
 *
 * Transaction: every write in ONE db.$transaction — a failure rolls the
 * whole step back (no half-configured structure). P2002 maps to a typed
 * CONFLICT (the in-tenant dedupe makes this a narrow race backstop).
 *
 * Permission: schools.manage. Audited: platform.school.academic_configured.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return withPlatform({ permission: 'schools.manage' }, async (ctx) => {
    const body = await parseJsonBody(req, bootstrapSchema)
    const ip = clientIpFromHeaders(req.headers)

    const school = await db.school.findUnique({
      where: { id },
      select: { id: true, name: true, academicYear: true, board: true, settings: true },
    })
    if (!school) {
      throw new AppError('RESOURCE_NOT_FOUND', {
        publicMessage: 'School not found',
        internalDetail: 'academic-bootstrap: no such school',
      })
    }

    const hasWork =
      body.academicYear !== undefined ||
      body.board !== undefined ||
      body.workingDays !== undefined ||
      (body.classes?.length ?? 0) > 0 ||
      (body.subjects?.length ?? 0) > 0
    if (!hasWork) {
      throw new AppError('INVALID_INPUT', {
        publicMessage: 'Nothing to save — send at least one academic field',
      })
    }

    const result = await db.$transaction(async (tx) => {
      // 1. School-level fields (+ the settings-JSON working week — the
      //    SAME keys provisioning writes; existing settings keys are
      //    preserved, never overwritten).
      let settingsUpdate: string | undefined
      if (body.workingDays) {
        let parsed: Record<string, unknown> = {}
        try {
          const parsedRaw = JSON.parse(school.settings || '{}') as unknown
          if (parsedRaw && typeof parsedRaw === 'object' && !Array.isArray(parsedRaw)) {
            parsed = parsedRaw as Record<string, unknown>
          }
        } catch {
          parsed = {}
        }
        parsed.workingDays = body.workingDays
        settingsUpdate = JSON.stringify(parsed)
      }
      await tx.school.update({
        where: { id: school.id },
        data: {
          ...(body.academicYear !== undefined ? { academicYear: body.academicYear } : {}),
          ...(body.board !== undefined ? { board: body.board } : {}),
          ...(settingsUpdate !== undefined ? { settings: settingsUpdate } : {}),
        },
      })

      // 2. Subjects — dedupe against the school's EXISTING catalogue by
      //    case-insensitive name; codes via the shared derivation.
      let subjectsCreated = 0
      let subjectsSkipped = 0
      if (body.subjects?.length) {
        const existing = await tx.subject.findMany({
          where: { schoolId: school.id },
          select: { name: true },
        })
        const existingNames = new Set(existing.map((s) => s.name.trim().toLowerCase()))
        const usedCodes = new Set<string>()
        const seen = new Set<string>()
        for (const name of body.subjects) {
          const key = name.trim().toLowerCase()
          if (!key) continue
          if (existingNames.has(key) || seen.has(key)) {
            subjectsSkipped += 1
            continue
          }
          seen.add(key)
          await tx.subject.create({
            data: {
              schoolId: school.id,
              name: name.trim(),
              code: subjectCodeOf(name.trim(), usedCodes),
            },
          })
          subjectsCreated += 1
        }
      }

      // 3. Classes (+ sections, + optional stream) — dedupe against the
      //    tenant's EXISTING (name, section) grid first.
      let classesCreated = 0
      let sectionsCreated = 0
      let sectionsSkipped = 0
      if (body.classes?.length) {
        const existingClasses = await tx.class.findMany({
          where: { schoolId: school.id },
          select: { name: true, section: true },
        })
        const existingPairs = new Set(
          existingClasses.map((c) => `${c.name.trim().toLowerCase()}|${(c.section ?? '').toLowerCase()}`),
        )
        const seenClass = new Set<string>()
        for (const cls of body.classes) {
          const sections = cls.sections.length > 0 ? cls.sections : [null]
          let classRowCreated = false
          for (const section of sections) {
            const key = `${cls.name.trim().toLowerCase()}|${(section ?? '').toLowerCase()}`
            if (existingPairs.has(key) || seenClass.has(key)) {
              sectionsSkipped += 1
              continue
            }
            seenClass.add(key)
            await tx.class.create({
              data: {
                schoolId: school.id,
                name: cls.name.trim(),
                section,
                ...(cls.stream ? { stream: cls.stream } : {}),
              },
            })
            sectionsCreated += 1
            classRowCreated = true
          }
          if (classRowCreated) classesCreated += 1
        }
      }

      return { classesCreated, sectionsCreated, sectionsSkipped, subjectsCreated, subjectsSkipped }
    })

    await platformAuditEvent({
      adminId: ctx.admin.id,
      action: 'platform.school.academic_configured',
      targetType: 'SCHOOL',
      targetId: school.id,
      schoolId: school.id,
      ip,
      reason: 'academic bootstrap (setup wizard)',
      metadata: {
        ...result,
        academicYear: body.academicYear ?? undefined,
        board: body.board ?? undefined,
        workingDays: body.workingDays ?? undefined,
      },
    })

    return { ok: true, ...result }
  })
}
