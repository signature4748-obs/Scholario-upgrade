/**
 * IQ3000 migration — backfill the canonical Room registry and the
 * relational subject-teacher appointments from existing data.
 *
 * Idempotent; safe to re-run.
 *
 *  1. Rooms: every distinct Class.room string becomes a canonical Room row
 *     (school-scoped, unique name); Class.roomId is linked; Class.room is
 *     kept as the display projection (unchanged values).
 *  2. Timetable.teacherUserId: resolve each row's teacherName against the
 *     school's Teacher roster (case-insensitive) — display names become
 *     relational ids where they resolve.
 *  3. ClassSubjectAssignment.teacherUserId: for every (class, subject) with
 *     resolvable timetable teachers, appoint the majority teacher on the
 *     CSA row — the canonical subject-teacher assignment going forward.
 */
import { db as _db } from '../src/lib/db'
import { PrismaClient } from '@prisma/client'

// direct client (script runs outside the Next module graph)
const p = new PrismaClient()

async function migrateRooms() {
  const classes = await p.class.findMany({
    where: { room: { not: null } },
    select: { id: true, schoolId: true, room: true, capacity: true, roomId: true },
  })
  const roomNames = new Map<string, { schoolId: string; name: string }>()
  for (const c of classes) {
    const name = (c.room ?? '').trim()
    if (!name) continue
    roomNames.set(`${c.schoolId}|${name.toLowerCase()}`, { schoolId: c.schoolId, name })
  }
  let created = 0
  for (const [, r] of roomNames) {
    const existing = await p.room.findFirst({
      where: { schoolId: r.schoolId, name: { equals: r.name } },
    })
    if (!existing) {
      await p.room.create({
        data: { schoolId: r.schoolId, name: r.name, type: 'Classroom' },
      })
      created++
    }
  }
  let linked = 0
  for (const c of classes) {
    const name = (c.room ?? '').trim()
    if (!name || c.roomId) continue
    const room = await p.room.findFirst({
      where: { schoolId: c.schoolId, name: { equals: name } },
    })
    if (room) {
      await p.class.update({ where: { id: c.id }, data: { roomId: room.id } })
      linked++
    }
  }
  return { distinctNames: roomNames.size, created, linked }
}

async function migrateTimetableTeachers() {
  const teachers = await p.teacher.findMany({
    select: { userId: true, schoolId: true, user: { select: { name: true } } },
  })
  // schoolId → lowercase name → userId
  const bySchool = new Map<string, Map<string, string>>()
  for (const t of teachers) {
    const n = (t.user.name ?? '').trim().toLowerCase()
    if (!n) continue
    const m = bySchool.get(t.schoolId) ?? new Map<string, string>()
    m.set(n, t.userId)
    bySchool.set(t.schoolId, m)
  }
  const rows = await p.timetable.findMany({
    where: { teacherName: { not: null }, teacherUserId: null },
    select: { id: true, schoolId: true, teacherName: true },
  })
  let resolved = 0
  for (const r of rows) {
    const n = (r.teacherName ?? '').trim().toLowerCase()
    const uid = bySchool.get(r.schoolId)?.get(n)
    if (uid) {
      await p.timetable.update({ where: { id: r.id }, data: { teacherUserId: uid } })
      resolved++
    }
  }
  return { rows: rows.length, resolved }
}

async function migrateCsaTeachers() {
  // (classId|subjectId) → teacherUserId tally from resolvable timetable rows
  const rows = await p.timetable.findMany({
    where: { subjectId: { not: null }, teacherUserId: { not: null } },
    select: { classId: true, subjectId: true, teacherUserId: true },
  })
  const tally = new Map<string, Map<string, number>>()
  for (const r of rows) {
    if (!r.subjectId) continue
    const k = `${r.classId}|${r.subjectId}`
    const m = tally.get(k) ?? new Map<string, number>()
    m.set(r.teacherUserId!, (m.get(r.teacherUserId!) ?? 0) + 1)
    tally.set(k, m)
  }
  const csas = await p.classSubjectAssignment.findMany({
    where: { teacherUserId: null },
    select: { id: true, classId: true, subjectId: true },
  })
  let appointed = 0
  for (const csa of csas) {
    const m = tally.get(`${csa.classId}|${csa.subjectId}`)
    if (!m) continue
    let best: string | null = null
    let bestN = 0
    for (const [uid, n] of m) {
      if (n > bestN) {
        best = uid
        bestN = n
      }
    }
    if (best) {
      await p.classSubjectAssignment.update({
        where: { id: csa.id },
        data: { teacherUserId: best },
      })
      appointed++
    }
  }
  return { csas: csas.length, appointed }
}

async function main() {
  const rooms = await migrateRooms()
  const tt = await migrateTimetableTeachers()
  // CSA after timetable so the tallies see the freshly resolved ids
  const csa = await migrateCsaTeachers()
  console.log('rooms:', JSON.stringify(rooms))
  console.log('timetable teachers:', JSON.stringify(tt))
  console.log('csa teachers:', JSON.stringify(csa))
  // sanity
  console.log('rooms now:', await p.room.count())
  console.log('classes linked:', await p.class.count({ where: { roomId: { not: null } } }))
  console.log('csa appointed:', await p.classSubjectAssignment.count({ where: { teacherUserId: { not: null } } }))
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => p.$disconnect())
