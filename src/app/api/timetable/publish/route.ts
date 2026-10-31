import { NextRequest } from 'next/server'
import { db, trackedTransaction } from '@/lib/db'
import { withUser, schoolScoped } from '@/lib/api'
import { AppError, type AppErrorCode } from '@/lib/security/errors'
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
 *   2. resolve each distinct className → Class row (exact-name match
 *      first; label-normalized fallback for wizard-shaped {name,
 *      section} rows). TWO-PHASE, side-effect-free: validate EVERY
 *      payload class with zero writes first, then create the
 *      genuinely-new ones only after the guard below — so an
 *      ambiguous or refused payload can never leave half-created
 *      classes behind;
 *   3. resolve each distinct subject → Subject row (match by name; create
 *      when missing — same honest rule);
 *   4. STALE-SNAPSHOT GUARD — if the school already has timetable rows but
 *      ZERO of the payload's classes exist in the DB, this is almost
 *      certainly an unhydrated/mock snapshot trying to replace real data
 *      (the client blocks offline publishes; this is the server-side
 *      backstop). Refused — and the guard runs BEFORE the creation
 *      phase, so a refusal also leaves no ghost classes behind.
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
      //     PHASE-B follow-up (2026-10-23): TWO-PHASE, side-effect-free
      //     resolution. The original loop created each missing class the
      //     MOMENT it was encountered, so a payload like [genuinely-new
      //     class, ambiguous label] created the new row and only THEN
      //     threw INVALID_INPUT at the ambiguous one — the failed request
      //     left the new row behind (a partial write; the stale-snapshot
      //     refusal had the same ghost-class shape, since the guard ran
      //     after the loop). Now:
      //       2a — resolve/validate EVERY payload class first, with ZERO
      //            writes (exact name → label fallback → pending);
      //            an ambiguous reference refuses HERE, before any row
      //            exists;
      //       2b — the stale-snapshot guard (identical condition) also
      //            runs before any write — a refused snapshot leaves no
      //            ghost classes behind;
      //       2c — only then are the genuinely-new classes created, all
      //            of them, from the validated pending list.
      const classNames = [...new Set(drafts.map((d) => d.className))].filter(Boolean)
      const classByKey = new Map<string, { id: string; name: string; section: string | null }>()
      let payloadClassesExisting = 0
      const classesToCreate: { name: string; section: string | null }[] = []
      for (const name of classNames) {
        const existing = await db.class.findFirst({
          where: { schoolId, name },
          select: { id: true, name: true, section: true },
        })
        if (existing) {
          classByKey.set(name, existing)
          payloadClassesExisting += 1
          continue
        }

        // PHASE B (2026-10-23) — label-normalized fallback: the timetable
        // editor addresses classes by their DISPLAY LABEL — "Class 1 - A"
        // is the label classLabelOf, the editor classOptions and the
        // auto-timetable dialog all emit for the wizard/provisioning
        // shape {name:"Class 1", section:"A"} (name + SEPARATE section
        // column). A name-only lookup misses that shape and previously
        // CREATED a duplicate {name:"Class 1 - A"} row whose timetable
        // rows silently orphaned every student enrolled in the original
        // row (Phase A reproduction, audit pack 2026-10-23). When the
        // payload name carries the canonical label suffix —
        // BASE " - "/" – " SECTION — resolve to the EXISTING (base,
        // section) row instead of creating one:
        //   · the exact-name lookup above stays authoritative (a class
        //     whose NAME is itself the label — seeded "1-A"-style rows,
        //     and the duplicates on already-affected tenants — still
        //     exact-hits; data repair for those tenants is a separate
        //     owner decision, NOT done here);
        //   · the fallback only ever REUSES — it never creates, renames
        //     or merges; a miss falls through to the honest create path
        //     below unchanged;
        //   · matching is case-insensitive (the editor label mirrors the
        //     stored row's case, hand-written payloads need not) — so two
        //     case-colliding candidates are genuinely ambiguous and the
        //     route refuses with INVALID_INPUT rather than guessing;
        //   · fallback hits count as payloadClassesExisting, so the
        //     stale-snapshot guard below can never be bypassed by the
        //     normalized lookup.
        const label = name.match(/^(.+?)\s+[-–]\s+([^\s-]{1,8})$/)
        if (label) {
          const base = label[1].trim()
          const suffix = label[2].trim()
          const candidates = await db.class.findMany({
            where: {
              schoolId,
              name: { equals: base, mode: 'insensitive' },
              section: { equals: suffix, mode: 'insensitive' },
            },
            select: { id: true, name: true, section: true },
          })
          if (candidates.length > 1) {
            throw new AppError('INVALID_INPUT', {
              publicMessage: `Ambiguous class reference "${name}" — multiple existing classes match it. Rename the duplicates in Academic Configuration and publish again.`,
              internalDetail: `TIMETABLE_PUBLISH class-resolution ambiguity: ${candidates.length} rows match (name="${base}", section="${suffix}", case-insensitive) for payload class "${name}"`,
            })
          }
          if (candidates.length === 1) {
            classByKey.set(name, candidates[0])
            payloadClassesExisting += 1
            continue
          }
        }

        // Genuinely new — DEFERRED: recorded here, created only after
        // the WHOLE payload has validated (2c below), never as a
        // side effect of resolving earlier entries. The name may carry
        // its own section ("Grade 9 - A") — keep the full label as the
        // name (that's how the roster renders it) and derive a
        // single-letter section when one trails the label.
        const sectionMatch = name.match(/[-–\s]([A-Z])$/)
        classesToCreate.push({ name, section: sectionMatch ? sectionMatch[1] : null })
      }

      // 2b — STALE-SNAPSHOT GUARD (data-integrity backstop): the school has
      //     real rows, but NONE of the payload's classes match any existing
      //     class → the snapshot was never hydrated from this school's
      //     records. Refuse instead of wiping real schedules with a foreign
      //     universe (e.g. the retired demo/mock classes). The CONDITION is
      //     unchanged; the POSITION moved ahead of the creation phase (2c)
      //     so a refusal also guarantees the payload's classes were never
      //     created.
      const existingRowCount = await db.timetable.count({ where: { schoolId } })
      if (existingRowCount > 0 && payloadClassesExisting === 0) {
        throw new Error(
          'STALE_SNAPSHOT_REFUSED: this school already has a timetable, but none of the submitted classes match its records. Reload the Timetable module and publish again.',
        )
      }

      // 2c — the deliberate creation phase: every genuinely-new class,
      //     only after the FULL payload validated and the guard passed.
      //     (Outside the publish transaction on purpose: the payload
      //     conflict pre-check 4d below needs the created rows' ids to
      //     key its (classId, day, period) dedup.)
      for (const toCreate of classesToCreate) {
        classByKey.set(
          toCreate.name,
          await db.class.create({
            data: { schoolId, ...toCreate, capacity: 40 },
            select: { id: true, name: true, section: true },
          }),
        )
      }

      // 3 — subject names are resolved INSIDE the publish transaction below
      //     (Phase 3: subject auto-create + CSA ensure + deleteMany +
      //     createMany are ONE atomic unit — a crash between the delete and
      //     the write previously left the school with NO timetable at all;
      //     a subject (schoolId, code) collision retries once with a
      //     deterministic suffix).
      const subjectNames = [...new Set(drafts.map((d) => d.subject))].filter(Boolean)

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

      // 4d — PHASE 8 §2(A) payload-level duplicate pre-check (fast-path for
      //     precise, STABLE machine-readable domain errors): mirror the
      //     three DB uniques — (schoolId, classId, day, period), (schoolId,
      //     teacherUserId, day, period), (schoolId, roomId, day, period) —
      //     across the resolved drafts and throw the SPECIFIC domain
      //     AppError on the first duplicate, naming the room/teacher/class,
      //     day and period. NULL teacherUserId/roomId never conflict
      //     (Postgres treats NULLs as distinct — the same semantics as the
      //     DB keys, so the check can never reject a payload the DB would
      //     accept). The DB uniques remain the authority: this pre-check
      //     only buys a precise message + domain code BEFORE the
      //     transaction runs; it does not remove or weaken anything — a
      //     payload that passes here is still fully constrained at the
      //     createMany below (and under concurrent publishes, the P2002
      //     catch below is the backstop).
      const seenRoomKeys = new Set<string>()
      const seenTeacherKeys = new Set<string>()
      const seenClassKeys = new Set<string>()
      for (const d of draftsRoomResolved) {
        if (d.roomId) {
          const key = `${d.roomId}|${d.day}|${d.period}`
          if (seenRoomKeys.has(key)) {
            throw new AppError('ROOM_CONFLICT', {
              publicMessage: `Timetable conflict — ${d.room} is scheduled twice on ${d.day}, period ${d.period}. Resolve the overlap before publishing.`,
              internalDetail: `TIMETABLE_CONFLICT payload pre-check: duplicate (roomId, day, period) — room "${d.room}" on ${d.day} period ${d.period}`,
            })
          }
          seenRoomKeys.add(key)
        }
        if (d.teacherUserId) {
          const key = `${d.teacherUserId}|${d.day}|${d.period}`
          if (seenTeacherKeys.has(key)) {
            throw new AppError('TEACHER_CONFLICT', {
              publicMessage: `Timetable conflict — teacher ${d.teacherName} is scheduled twice on ${d.day}, period ${d.period}. Resolve the overlap before publishing.`,
              internalDetail: `TIMETABLE_CONFLICT payload pre-check: duplicate (teacherUserId, day, period) — teacher "${d.teacherName}" on ${d.day} period ${d.period}`,
            })
          }
          seenTeacherKeys.add(key)
        }
        const classId = classByKey.get(d.className)!.id
        const classKey = `${classId}|${d.day}|${d.period}`
        if (seenClassKeys.has(classKey)) {
          throw new AppError('CLASS_CONFLICT', {
            publicMessage: `Timetable conflict — class ${d.className} is scheduled twice on ${d.day}, period ${d.period}. Resolve the overlap before publishing.`,
            internalDetail: `TIMETABLE_CONFLICT payload pre-check: duplicate (classId, day, period) — class "${d.className}" on ${d.day} period ${d.period}`,
          })
        }
        seenClassKeys.add(classKey)
      }

      // 5 — replace-all within the school (publish = the new truth) — ONE
      //     $transaction (Phase 3): subject auto-create (with code-collision
      //     retry), CSA ensure, the deleteMany and the createMany commit
      //     atomically. The new Timetable DB uniques — (schoolId, classId,
      //     day, period), (schoolId, teacherUserId, day, period) and
      //     (schoolId, roomId, day, period) — make the DB the source of
      //     truth for class-slot / teacher-booking / room-booking
      //     conflicts; a duplicate payload is refused with a clean 409 and
      //     a STABLE machine-readable domain code (Phase 8 §2(A)):
      //     ROOM_CONFLICT / TEACHER_CONFLICT / CLASS_CONFLICT — the payload
      //     pre-check (4d) fires first with the precise message; the P2002
      //     catch below is the DB-level backstop with the same codes.
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
          // PHASE 8 §2(A): classify the STABLE domain code from the Prisma
          // message — both message forms carry the discriminating
          // substring (field list: "(`schoolId`,`roomId`,`day`,`period`)";
          // constraint name: "Timetable_schoolId_roomId_day_period_key").
          // roomId/teacherUserId are mutually exclusive across the three
          // Timetable uniques, so an unmatched P2002 is the class key.
          const domainCode: AppErrorCode = msg.includes('roomId')
            ? 'ROOM_CONFLICT'
            : msg.includes('teacherUserId')
              ? 'TEACHER_CONFLICT'
              : 'CLASS_CONFLICT'
          throw new AppError(domainCode, {
            publicMessage:
              domainCode === 'TEACHER_CONFLICT'
                ? 'Timetable conflict — this teacher is already booked at that day and period. Resolve the overlap before publishing.'
                : domainCode === 'ROOM_CONFLICT'
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
    { feature: 'timetable.publish', roles: ['PRINCIPAL'] },
  )
}
