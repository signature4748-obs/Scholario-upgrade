import { NextRequest } from 'next/server'
import { db, trackedTransaction } from '@/lib/db'
import { withUser, schoolScoped } from '@/lib/api'
import { auditEvent } from '@/lib/security/audit'

export const runtime = 'nodejs'

/**
 * /api/principal/academic — the AUTHORITATIVE academic configuration API.
 *
 * ARCHITECTURE (the single-source-of-truth rule):
 *
 *   Principal configuration (this API — the only write path)
 *           ↓
 *   Class · ClassSubjectAssignment · Subject · Class.classTeacherId
 *           ↓
 *   Timetable / Lesson Planner / Marks Entry / My Class / Attendance
 *           ↓
 *   Teacher experience (read paths all validate against this config)
 *
 * GET  — the full academic configuration of THIS school: every class with
 *        its Principal-configured subjects (ACTIVE ClassSubjectAssignment
 *        only — never invented), the subject catalog, class teachers and
 *        per-subject teaching load derived from the published timetable.
 *
 * POST — Principal-only mutations. Each action is a configuration act:
 *   · subject.add      { classId, subjectName }  → ensure Subject exists in
 *                       the catalog, then ACTIVE CSA for the class. The
 *                       subject becomes available in every dependent module.
 *   · subject.remove   { classId, subjectId }    → delete the CSA AND
 *                       cascade-delete the class's Timetable rows for that
 *                       subject (a removed subject must disappear from
 *                       current Teacher workflows). Historical exam marks
 *                       are preserved (they reference Subject, not CSA).
 *   · subject.rename   { subjectId, newName }    → school-wide rename of the
 *                       catalog subject; every dependent module follows.
 *   · subject.create   { name, code? }           → add a NEW catalog subject
 *                       (not yet assigned to any class).
 *   · classTeacher.set { classId, teacherName|null } → appoint/remove the
 *                       class teacher (capability gating for My Class).
 *
 *   · subjectTeacher.set { classId, subjectId, teacherUserId|null }
 *                       → appoint/remove the SUBJECT TEACHER for a
 *                       class's subject (the canonical ClassSubjectAssignment
 *                         .teacherUserId — Phase 4). Marks entry /
 *                       attendance / directory scope derive from this.
 *   · room.assign     { classId, roomId|null } → assign/clear the class's
 *                       homeroom from the canonical Room registry
 *                       (Phase 2). Class.room display name follows.
 *
 * PERMISSIONS: PRINCIPAL only, school-scoped. Teachers/students can never
 * write academic configuration; nothing here is client-fabricated.
 */

// ── GET ────────────────────────────────────────────────────────────────

export async function GET() {
  return withUser(
    async (user) => {
      const schoolId = schoolScoped(user)

      const [classes, catalog, schoolRow] = await Promise.all([
        db.class.findMany({
          where: { schoolId },
          orderBy: { name: 'asc' },
          include: {
            subjectAssignments: {
              where: { isActive: true },
              include: { subject: { select: { id: true, name: true, code: true, status: true } } },
              orderBy: { displayOrder: 'asc' },
            },
          },
        }),
        db.subject.findMany({
          where: { schoolId },
          orderBy: { name: 'asc' },
          select: { id: true, name: true, code: true, status: true },
        }),
        db.school.findUnique({ where: { id: schoolId }, select: { academicYear: true } }),
      ])

      // Teachers for class-teacher appointment (the real roster).
      const teachers = await db.teacher.findMany({
        where: { schoolId },
        include: { user: { select: { id: true, name: true, email: true } } },
      })
      // Class.classTeacherId stores the teacher's USER id (the canonical
      // reference every teacher-side reader expects — role, dashboard,
      // class-hub, attendance scope).
      const teacherByUserId = new Map(teachers.map((t) => [t.userId, t]))

      // Teaching load per (class, subject) — from the published timetable.
      const ttRows = await db.timetable.findMany({
        where: { schoolId, subjectId: { not: null } },
        select: { classId: true, subjectId: true, teacherName: true },
      })
      const load = new Map<string, { periods: number; teachers: Set<string> }>()
      for (const r of ttRows) {
        const k = `${r.classId}|${r.subjectId}`
        const cur = load.get(k) ?? { periods: 0, teachers: new Set<string>() }
        cur.periods += 1
        if (r.teacherName) cur.teachers.add(r.teacherName)
        load.set(k, cur)
      }

      // Canonical rooms (the school registry) + per-CSA appointed teacher.
      const rooms = await db.room.findMany({
        where: { schoolId },
        orderBy: [{ active: 'desc' }, { name: 'asc' }],
        select: {
          id: true, name: true, code: true, building: true, floor: true,
          capacity: true, type: true, active: true,
        },
      })
      const teacherNameById = new Map(teachers.map((t) => [t.userId, t.user.name ?? t.user.email]))

      return {
        academicSession: schoolRow?.academicYear ?? null,
        catalog: catalog.map((s) => ({ id: s.id, name: s.name, code: s.code, status: s.status })),
        rooms,
        teachers: teachers
          .map((t) => ({ id: t.id, userId: t.userId, name: t.user.name ?? t.user.email, email: t.user.email }))
          .sort((a, b) => a.name.localeCompare(b.name)),
        classes: classes.map((c) => {
          const classTeacher = c.classTeacherId ? teacherByUserId.get(c.classTeacherId) : null
          return {
            id: c.id,
            name: c.name,
            section: c.section,
            label: c.section ? `${c.name.replace(/\s*[-–]\s*[A-Z]$/u, '')} · ${c.section}` : c.name,
            room: c.room,
            roomId: c.roomId,
            classTeacher: classTeacher ? { id: classTeacher.id, name: classTeacher.user.name ?? '' } : null,
            subjects: c.subjectAssignments.map((a) => {
              const l = load.get(`${c.id}|${a.subjectId}`)
              return {
                subjectId: a.subjectId,
                name: a.subject.name,
                code: a.subject.code,
                isCore: a.isCore,
                examinable: a.examinable,
                periodsPerWeek: l?.periods ?? 0,
                teacherUserId: a.teacherUserId ?? null,
                teacherName: a.teacherUserId ? (teacherNameById.get(a.teacherUserId) ?? null) : null,
                teachers: l ? [...l.teachers].sort() : [],
              }
            }),
          }
        }),
      }
    },
    { roles: ['PRINCIPAL', 'SUPER_ADMIN'] },
  )
}

// ── POST ───────────────────────────────────────────────────────────────

interface ActionBody {
  action?: string
  classId?: string
  subjectId?: string
  subjectName?: string
  newName?: string
  name?: string
  code?: string
  teacherName?: string | null
  teacherUserId?: string | null
  roomId?: string | null
}

export async function POST(req: NextRequest) {
  return withUser(
    async (user) => {
      if (user.role !== 'PRINCIPAL') throw new Error('FORBIDDEN')
      const schoolId = schoolScoped(user)
      const body = (await req.json().catch(() => ({}))) as ActionBody

      const ensureClass = async (classId: string) => {
        const cls = await db.class.findFirst({ where: { id: classId, schoolId }, select: { id: true, name: true, section: true } })
        if (!cls) throw new Error('CLASS_NOT_FOUND')
        return cls
      }
      const ensureSubject = async (subjectId: string) => {
        const subj = await db.subject.findFirst({ where: { id: subjectId, schoolId }, select: { id: true, name: true } })
        if (!subj) throw new Error('SUBJECT_NOT_FOUND')
        return subj
      }

      switch (body.action) {
        // ── Add an existing (or brand-new) subject to a class ──────────
        case 'subject.add': {
          const classId = body.classId?.trim()
          const subjectName = body.subjectName?.trim()
          if (!classId || !subjectName) throw new Error('MISSING_FIELDS')
          const cls = await ensureClass(classId)
          // Catalog lookup is case-insensitive so "mathematics" finds the
          // existing "Mathematics" row — one subject per name, no dupes.
          let subject = await db.subject.findFirst({
            where: { schoolId, name: { equals: subjectName, mode: 'insensitive' as const } },
            select: { id: true, name: true },
          })
          if (!subject) {
            subject = await db.subject.create({
              data: {
                schoolId,
                name: subjectName,
                code: subjectName.replace(/[^a-zA-Z]/g, '').slice(0, 4).toUpperCase() || 'SUB',
                status: 'Active',
              },
              select: { id: true, name: true },
            })
          }
          const existing = await db.classSubjectAssignment.findUnique({
            where: { classId_subjectId: { classId, subjectId: subject.id } },
            select: { id: true, isActive: true },
          })
          if (existing && existing.isActive) {
            return { ok: true, alreadyConfigured: true, classId, subjectId: subject.id }
          }
          if (existing) {
            await db.classSubjectAssignment.update({ where: { id: existing.id }, data: { isActive: true } })
          } else {
            const count = await db.classSubjectAssignment.count({ where: { classId } })
            await db.classSubjectAssignment.create({
              data: { schoolId, classId, subjectId: subject.id, isActive: true, displayOrder: count },
            })
          }
          await db.activityLog.create({
            data: {
              schoolId,
              userId: user.id,
              action: 'ACADEMIC_CONFIG_UPDATED',
              detail: `Subject "${subject.name}" configured for ${cls.name}${cls.section ? ` (${cls.section})` : ''}`,
            },
          })
          return { ok: true, classId, subjectId: subject.id, subjectName: subject.name }
        }

        // ── Remove a subject from a class (the config act) ─────────────
        case 'subject.remove': {
          const classId = body.classId?.trim()
          const subjectId = body.subjectId?.trim()
          if (!classId || !subjectId) throw new Error('MISSING_FIELDS')
          const cls = await ensureClass(classId)
          const subject = await ensureSubject(subjectId)
          // 1 — delete the CSA (the configuration itself).
          const csa = await db.classSubjectAssignment.findUnique({
            where: { classId_subjectId: { classId, subjectId } },
            select: { id: true },
          })
          if (!csa) return { ok: true, alreadyRemoved: true }
          await db.classSubjectAssignment.delete({ where: { id: csa.id } })
          // 2 — cascade: the class's timetable rows for this subject are no
          //     longer valid teaching entries — remove them (requirement:
          //     a removed subject disappears from current workflows).
          //     Historical exam marks / results are untouched (they keep
          //     their own Subject FK — history is never rewritten).
          const tt = await db.timetable.deleteMany({ where: { schoolId, classId, subjectId } })
          await db.activityLog.create({
            data: {
              schoolId,
              userId: user.id,
              action: 'ACADEMIC_CONFIG_UPDATED',
              detail: `Subject "${subject.name}" removed from ${cls.name}${cls.section ? ` (${cls.section})` : ''} (${tt.count} timetable slots cleared)`,
            },
          })
          return { ok: true, timetableRowsRemoved: tt.count }
        }

        // ── Rename a catalog subject (school-wide) ─────────────────────
        case 'subject.rename': {
          const subjectId = body.subjectId?.trim()
          const newName = body.newName?.trim()
          if (!subjectId || !newName) throw new Error('MISSING_FIELDS')
          const subject = await ensureSubject(subjectId)
          await db.subject.update({ where: { id: subjectId }, data: { name: newName } })
          await db.activityLog.create({
            data: {
              schoolId,
              userId: user.id,
              action: 'ACADEMIC_CONFIG_UPDATED',
              detail: `Subject renamed: "${subject.name}" → "${newName}"`,
            },
          })
          return { ok: true, subjectId, oldName: subject.name, newName }
        }

        // ── Create a NEW catalog subject (unassigned) ──────────────────
        case 'subject.create': {
          const name = body.name?.trim()
          if (!name) throw new Error('MISSING_FIELDS')
          const existing = await db.subject.findFirst({ where: { schoolId, name: { equals: name } }, select: { id: true } })
          if (existing) return { ok: true, subjectId: existing.id, alreadyExisted: true }
          const subject = await db.subject.create({
            data: {
              schoolId,
              name,
              code: body.code?.trim() || name.replace(/[^a-zA-Z]/g, '').slice(0, 4).toUpperCase() || 'SUB',
              status: 'Active',
            },
            select: { id: true, name: true },
          })
          return { ok: true, subjectId: subject.id, subjectName: subject.name }
        }

        // ── Appoint / remove a class teacher ───────────────────────────
        case 'classTeacher.set': {
          const classId = body.classId?.trim()
          if (!classId) throw new Error('MISSING_FIELDS')
          const cls = await ensureClass(classId)
          let teacherUserId: string | null = null
          if (body.teacherName != null && `${body.teacherName}`.trim() !== '') {
            const wanted = `${body.teacherName}`.trim()
            const match = await db.teacher.findFirst({
              where: { schoolId, user: { name: { equals: wanted } } },
              include: { user: { select: { name: true } } },
            })
            if (!match) throw new Error('TEACHER_NOT_FOUND')
            teacherUserId = match.userId
          }
          // Class.classTeacherId = the teacher's USER id — the canonical
          // reference the teacher-side capability gates read.
          await db.class.update({ where: { id: classId }, data: { classTeacherId: teacherUserId } })
          await db.activityLog.create({
            data: {
              schoolId,
              userId: user.id,
              action: 'ACADEMIC_CONFIG_UPDATED',
              detail: teacherUserId
                ? `Class teacher appointed for ${cls.name}${cls.section ? ` (${cls.section})` : ''}`
                : `Class teacher removed for ${cls.name}${cls.section ? ` (${cls.section})` : ''}`,
            },
          })
          // Phase 1 — class-teacher appointment changes teacher-side
          // authorization scope: auditable as a permission change.
          await auditEvent({
            schoolId,
            userId: user.id,
            action: 'PERMISSION_CHANGE',
            detail: teacherUserId
              ? `Class teacher appointed for ${cls.name}${cls.section ? ` (${cls.section})` : ''} (user ${teacherUserId})`
              : `Class teacher removed for ${cls.name}${cls.section ? ` (${cls.section})` : ''}`,
          }).catch(() => {})
          return { ok: true, classId, classTeacherId: teacherUserId }
        }

        // ── Appoint / remove the SUBJECT TEACHER for a class (Phase 4) ──
        case 'subjectTeacher.set': {
          const classId = body.classId?.trim()
          const subjectId = body.subjectId?.trim()
          if (!classId || !subjectId) throw new Error('MISSING_FIELDS')
          const cls = await ensureClass(classId)
          const subject = await ensureSubject(subjectId)
          const csa = await db.classSubjectAssignment.findUnique({
            where: { classId_subjectId: { classId, subjectId } },
            select: { id: true, teacherUserId: true },
          })
          if (!csa) throw new Error('SUBJECT_NOT_CONFIGURED_FOR_CLASS')

          let teacherUserId: string | null = null
          let teacherLabel = ''
          if (body.teacherUserId != null && `${body.teacherUserId}`.trim() !== '') {
            const match = await db.teacher.findFirst({
              where: { userId: body.teacherUserId, schoolId },
              include: { user: { select: { name: true } } },
            })
            if (!match) throw new Error('TEACHER_NOT_FOUND')
            teacherUserId = match.userId
            teacherLabel = match.user.name ?? 'Teacher'
          }

          if ((csa.teacherUserId ?? null) === teacherUserId) {
            return { ok: true, alreadyApplied: true, classId, subjectId, teacherUserId }
          }
          // ATOMIC: the canonical CSA appointment, the timetable display
          // sync, and the audit row commit together or not at all. The
          // timetable carries @@unique([schoolId, teacherUserId, day,
          // period]) — the teacher double-booking guard — so appointing a
          // teacher whose timetable cells would collide must ROLL BACK the
          // appointment too (previously the CSA committed and the sync
          // threw, leaving CSA ≠ timetable and a misleading CONFLICT).
          await trackedTransaction('subjectTeacher.set', async (tx) => {
            await tx.classSubjectAssignment.update({
              where: { id: csa.id },
              data: { teacherUserId },
            })
            // Keep the timetable display in step: the class's cells for this
            // subject follow the appointment (the schedule stays coherent
            // with the canonical configuration). A teacher double-booking
            // here fails the WHOLE appointment — resolve the timetable
            // conflict first, then appoint.
            //
            // TQA-5 (release bug): on RELEASE (teacherUserId=null) the
            // cells' teacherName must be cleared too — a stale display name
            // on a vacant slot re-granted the released teacher's scope via
            // the legacy name-fallback in teacher-scope.ts (assignment
            // removal must remove the server-side capability IMMEDIATELY).
            await tx.timetable.updateMany({
              where: { schoolId, classId, subjectId },
              data: teacherUserId
                ? { teacherUserId, ...(teacherLabel ? { teacherName: teacherLabel } : {}) }
                : { teacherUserId: null, teacherName: null },
            })
            await tx.activityLog.create({
              data: {
                schoolId,
                userId: user.id,
                action: 'ACADEMIC_CONFIG_UPDATED',
                detail: teacherUserId
                  ? `${teacherLabel} appointed subject teacher for ${subject.name} · ${cls.name}${cls.section ? ` (${cls.section})` : ''}`
                  : `Subject teacher released for ${subject.name} · ${cls.name}${cls.section ? ` (${cls.section})` : ''}`,
              },
            })
          })
          return { ok: true, classId, subjectId, teacherUserId }
        }

        // ── Assign / clear a class's homeroom (Phase 2) ──────────────
        case 'room.assign': {
          const classId = body.classId?.trim()
          if (!classId) throw new Error('MISSING_FIELDS')
          const cls = await ensureClass(classId)
          let roomId: string | null = null
          if (body.roomId != null && `${body.roomId}`.trim() !== '') {
            const room = await db.room.findFirst({ where: { id: body.roomId, schoolId } })
            if (!room) throw new Error('ROOM_NOT_FOUND')
            if (!room.active) throw new Error('ROOM_ARCHIVED — archived rooms cannot be assigned')
            roomId = room.id
          }
          const roomName = roomId
            ? (await db.room.findUnique({ where: { id: roomId } }))?.name ?? null
            : null
          await db.class.update({
            where: { id: classId },
            data: { roomId, room: roomName },
          })
          await db.activityLog.create({
            data: {
              schoolId,
              userId: user.id,
              action: 'ACADEMIC_CONFIG_UPDATED',
              detail: roomName
                ? `Room ${roomName} assigned to ${cls.name}${cls.section ? ` (${cls.section})` : ''}`
                : `Room cleared for ${cls.name}${cls.section ? ` (${cls.section})` : ''}`,
            },
          })
          return { ok: true, classId, roomId, roomName }
        }

        default:
          throw new Error('UNKNOWN_ACTION')
      }
    },
    { roles: ['PRINCIPAL'] },
  )
}
