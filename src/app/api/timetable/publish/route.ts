import { NextRequest } from 'next/server'
import { db, trackedTransaction } from '@/lib/db'
import { withUser, schoolScoped } from '@/lib/api'
import { AppError } from '@/lib/security/errors'
import { slotsToServerRows, type PublishableSlot } from '@/lib/timetable/server-mapping'
import { publishToSchool } from '@/lib/realtime/publish'

export const runtime = 'nodejs'

/**
 * POST /api/timetable/publish — sync the school's Timetable rows with the
 * Principal's PUBLISHED master schedule.
 *
 * PERMISSION MODEL:
 *   · PRINCIPAL only (role check server-side; a student/teacher can never
 *     write the master timetable);
 *   · school-scoped via the session — the sync only ever touches THIS
 *     school's rows.
 *
 * SEMANTICS — replace-all within the school (a publish IS the new truth):
 *   1. map slots → row drafts (ladder period → teaching period, time →
 *      "HH:MM", via the shared server-mapping algorithm);
 *   2. resolve each distinct className → Class row (match by name;
 *      create when the Principal schedules a class the school has not
 *      registered yet);
 *   3. resolve each distinct subject → Subject row (match by name; create
 *      when missing — same honest rule);
 *   4. STALE-SNAPSHOT GUARD — if the school already has timetable rows but
 *      ZERO of the payload's classes exist in the DB, this is almost
 *      certainly an unhydrated/mock snapshot trying to replace real data
 *      (the client blocks offline publishes; this is the server-side
 *      backstop). Refused with 409.
 *   5. delete all existing Timetable rows for the school, then write the
 *      new set in one createMany;
 *   6. log the publication to ActivityLog (platform audit trail).
 *
 * Students and teachers read these rows on their next module load — the
 * Principal publishes → the whole school sees it (one data universe).
 */

interface PublishBody {
  slots: PublishableSlot[]
}

const MAX_SLOTS = 600

export async function POST(req: NextRequest) {
  return withUser(
    async (user) => {
      if (user.role !== 'PRINCIPAL') throw new Error('FORBIDDEN')
      const schoolId = schoolScoped(user)

      const body = (await req.json().catch(() => ({}))) as Partial<PublishBody>
      const slots = Array.isArray(body.slots) ? body.slots : []
      if (slots.length === 0) throw new Error('EMPTY_TIMETABLE')
      if (slots.length > MAX_SLOTS) throw new Error('TOO_MANY_SLOTS')

      // 1 — shared ladder-aware mapping (same algorithm the read path uses).
      const drafts = slotsToServerRows(slots)
      if (drafts.length === 0) throw new Error('UNPARSEABLE_SLOTS')

      // 2 — resolve classes (name → row; create genuinely new classes).
      //     Track how many payload classes ALREADY exist — the stale-snapshot
      //     guard below needs to know.
      const classNames = [...new Set(drafts.map((d) => d.className))].filter(Boolean)
      const classByKey = new Map<string, { id: string; name: string; section: string | null }>()
      let payloadClassesExisting = 0
      for (const name of classNames) {
        const existing = await db.class.findFirst({
          where: { schoolId, name },
          select: { id: true, name: true, section: true },
        })
        if (existing) {
          classByKey.set(name, existing)
          payloadClassesExisting += 1
        } else {
          // Name may carry its own section ("Grade 9 - A") — keep the full
          // label as the name (that's how the roster renders it) and derive
          // a single-letter section when one trails the label.
          const sectionMatch = name.match(/[-–\s]([A-Z])$/)
          classByKey.set(
            name,
            await db.class.create({
              data: { schoolId, name, section: sectionMatch ? sectionMatch[1] : null, capacity: 40 },
              select: { id: true, name: true, section: true },
            }),
          )
        }
      }

      // 3 — subject names are resolved INSIDE the publish transaction below
      //     (Phase 3: subject auto-create + CSA ensure + deleteMany +
      //     createMany are ONE atomic unit — a crash between the delete and
      //     the write previously left the school with NO timetable at all;
      //     a subject (schoolId, code) collision retries once with a
      //     deterministic suffix).
      const subjectNames = [...new Set(drafts.map((d) => d.subject))].filter(Boolean)

      // 4 — STALE-SNAPSHOT GUARD (data-integrity backstop): the school has
      //     real rows, but NONE of the payload's classes match any existing
      //     class → the snapshot was never hydrated from this school's
      //     records. Refuse instead of wiping real schedules with a foreign
      //     universe (e.g. the retired demo/mock classes).
      const existingRowCount = await db.timetable.count({ where: { schoolId } })
      if (existingRowCount > 0 && payloadClassesExisting === 0) {
        throw new Error(
          'STALE_SNAPSHOT_REFUSED: this school already has a timetable, but none of the submitted classes match its records. Reload the Timetable module and publish again.',
        )
      }

      // 4b — resolve TEACHER names to relational ids (IQ3000 Phase 4):
      //     each draft's teacherName is matched against the school's
      //     Teacher roster (case-insensitive) so the published rows carry
      //     BOTH the display name and the canonical teacherUserId that
      //     scope resolution joins on. Unresolvable names stay display-only.
      const teacherRoster = await db.teacher.findMany({
        where: { schoolId },
        select: { userId: true, user: { select: { name: true } } },
      })
      const teacherIdByName = new Map<string, string>()
      for (const t of teacherRoster) {
        const n = (t.user.name ?? '').trim().toLowerCase()
        if (n) teacherIdByName.set(n, t.userId)
      }
      const draftsResolved = drafts.map((d) => ({
        ...d,
        teacherUserId: d.teacherName ? (teacherIdByName.get(d.teacherName.trim().toLowerCase()) ?? null) : null,
      }))

      // 4c — TQA-9: resolve ROOM names to canonical Room rows the same
      //     way (case-insensitive trim; ACTIVE rooms only — archived rooms
      //     are excluded from new scheduling exactly like the homeroom
      //     room.assign guard). Unresolvable names keep the display text
      //     with roomId = null (never invented, never renamed silently).
      //     The (schoolId, roomId, day, period) unique then makes the DB
      //     the source of truth for ROOM double-booking too.
      const roomRoster = await db.room.findMany({
        where: { schoolId, active: true },
        select: { id: true, name: true },
      })
      const roomKey = (name: string) => name.trim().toLowerCase()
      const roomIdByName = new Map<string, string>()
      for (const r of roomRoster) {
        if (r.name) roomIdByName.set(roomKey(r.name), r.id)
      }
      const draftsRoomResolved = draftsResolved.map((d) => ({
        ...d,
        roomId: d.room ? (roomIdByName.get(roomKey(d.room)) ?? null) : null,
      }))

      // 5 — replace-all within the school (publish = the new truth) — ONE
      //     $transaction (Phase 3): subject auto-create (with code-collision
      //     retry), CSA ensure, the deleteMany and the createMany commit
      //     atomically. The new Timetable DB uniques — (schoolId, classId,
      //     day, period) and (schoolId, teacherUserId, day, period) — make
      //     the DB the source of truth for class-slot / teacher-booking
      //     conflicts; a P2002 is translated to a clean 409
      //     TIMETABLE_CONFLICT (the payload itself scheduled the same class
      //     or teacher twice at one day/period).
      let removedCount = 0
      let writtenCount = 0
      let csaCreated = 0
      let subjectCount = 0
      try {
        const txResult = await trackedTransaction('timetable-publish', async (tx) => {
          // 3 — resolve subjects (name → row; create when missing). A
          //     (schoolId, code) collision (two subjects mapping to the
          //     same 4-letter code) retries ONCE with a deterministic
          //     suffix.
          const subjectByKey = new Map<string, { id: string }>()
          for (const name of subjectNames) {
            const existing = await tx.subject.findFirst({
              where: { schoolId, name },
              select: { id: true },
            })
            if (existing) {
              subjectByKey.set(name, existing)
            } else {
              const baseCode = name.slice(0, 4).toUpperCase()
              let created: { id: string }
              try {
                created = await tx.subject.create({
                  data: { schoolId, name, code: baseCode, status: 'Active' },
                  select: { id: true },
                })
              } catch (e) {
                const err = e as { code?: string }
                if (err?.code !== 'P2002') throw e
                created = await tx.subject.create({
                  data: { schoolId, name, code: `${baseCode}-2`, status: 'Active' },
                  select: { id: true },
                })
              }
              subjectByKey.set(name, created)
            }
          }

          // The publish IS a Principal configuration act: every (class,
          // subject) it schedules becomes ACTIVE ClassSubjectAssignment
          // config, so a published timetable can never contain an
          // "unconfigured subject" cell (no orphaned rows, ever).
          const pairs = new Set(
            drafts.flatMap((d) => {
              const cls = classByKey.get(d.className)
              const subj = subjectByKey.get(d.subject)
              return cls && subj ? [[cls.id, subj.id] as const] : []
            })
          )
          let csaEnsureCount = 0
          for (const [classId, subjectId] of pairs) {
            const existing = await tx.classSubjectAssignment.findUnique({
              where: { classId_subjectId: { classId, subjectId } },
              select: { id: true, isActive: true },
            })
            if (!existing) {
              await tx.classSubjectAssignment.create({
                data: { schoolId, classId, subjectId, isActive: true },
              })
              csaEnsureCount += 1
            } else if (!existing.isActive) {
              await tx.classSubjectAssignment.update({
                where: { id: existing.id },
                data: { isActive: true },
              })
              csaEnsureCount += 1
            }
          }

          const removed = await tx.timetable.deleteMany({ where: { schoolId } })
          const written = await tx.timetable.createMany({
            data: draftsRoomResolved.map((d) => ({
              schoolId,
              classId: classByKey.get(d.className)!.id,
              subjectId: subjectByKey.get(d.subject)?.id ?? null,
              day: d.day,
              period: d.period,
              startTime: d.startTime,
              endTime: d.endTime,
              teacherUserId: d.teacherUserId,
              teacherName: d.teacherName,
              roomId: d.roomId,
              room: d.room || null,
            })),
          })
          return {
            removedCount: removed.count,
            writtenCount: written.count,
            csaEnsureCount,
            subjectCount: subjectByKey.size,
          }
        })
        removedCount = txResult.removedCount
        writtenCount = txResult.writtenCount
        csaCreated = txResult.csaEnsureCount
        subjectCount = txResult.subjectCount
      } catch (e) {
        const err = e as { code?: string; message?: string }
        if (err?.code === 'P2002') {
          const msg = err.message ?? ''
          const teacherConflict = msg.includes('teacherUserId')
          const roomConflict = msg.includes('roomId')
          throw new AppError('CONFLICT', {
            publicMessage: teacherConflict
              ? 'Timetable conflict — this teacher is already booked at that day and period. Resolve the overlap before publishing.'
              : roomConflict
                ? 'Timetable conflict — that room is already booked at that day and period. Resolve the overlap before publishing.'
                : 'Timetable conflict — this class already has a slot at that day and period. Resolve the overlap before publishing.',
            internalDetail: `TIMETABLE_CONFLICT P2002: ${msg.slice(0, 300)}`,
          })
        }
        throw e
      }

      // 5 — audit trail (platform activity feed reads these).
      const published = await db.activityLog.create({
        data: {
          schoolId,
          userId: user.id,
          action: 'TIMETABLE_PUBLISHED',
          detail: `${writtenCount} slots across ${classByKey.size} classes (replaced ${removedCount} rows)`,
        },
      })

      // PHASE 8B — school-wide realtime 'timetable' frame (fire-and-forget):
      // the "master schedule changed" moment the legacy event-stream emitted
      // from this exact ActivityLog row. Student/teacher timetable views bump
      // their version counter and live-refresh on receipt.
      // AWAITED (Phase 8C-N fix): Vercel freezes the function the moment
      // the response is returned — a fire-and-forget publish fetch was
      // silently killed mid-flight and never delivered. publishToSchool is
      // fire-safe (never throws) and bounded (3s abort), so awaiting only
      // guarantees completion before the freeze.
      await publishToSchool(schoolId, 'all', 'timetable', {
        id: published.id,
        at: published.createdAt.toISOString(),
        schoolId,
        detail: `${writtenCount} slots across ${classByKey.size} classes (replaced ${removedCount} rows)`,
        actor: user.name ?? null,
      })

      return {
        rowsWritten: writtenCount,
        rowsReplaced: removedCount,
        classes: classByKey.size,
        subjects: subjectCount,
        subjectConfigsEnsured: csaCreated,
      }
    },
    { roles: ['PRINCIPAL'] },
  )
}
