/**
 * repair-room-integrity — one-shot (re-runnable) data repair for the
 * homeroom rule.
 *
 * WHY THIS EXISTS (audit 2026-09): the timetable seed once wrote
 * period-indexed rooms (`Room ${200 + period % 9}` — P1→201, P2→202, …)
 * onto EVERY class's rows. With 9 classes sharing 7 rooms, 40 room-slot
 * keys were double/triple-booked — the teacher "My Timetable" module
 * honestly surfaced them as ~35 room conflicts. The repair:
 *
 *   1. normalise every class homeroom to the canonical scheme
 *      `Room {grade}0{section}` (heals legacy "101" / "201" labels);
 *   2. rewrite every Timetable row's room to ITS CLASS's homeroom
 *      (the class stays put, teachers move).
 *
 * After the repair, a room can only collide if two classes share a
 * homeroom — impossible under the scheme — so the teacher conflict scan
 * goes quiet. Teacher/class conflicts are NOT touched (they were already
 * zero; those are real scheduling states, not label noise).
 *
 * Run: bun prisma/repair-room-integrity.ts
 */
import { db } from '../src/lib/db'

async function main() {
  const classes = await db.class.findMany({
    select: { id: true, name: true, section: true, room: true },
  })
  console.log(`classes: ${classes.length}`)

  let _normalized = 0
  const homeroomById = new Map<string, string>()
  for (const c of classes) {
    const grade = c.name.match(/\d+/)?.[0] ?? ''
    // Canonical scheme only applies to classes that follow the
    // "Grade N - S" naming; others keep whatever homeroom they have.
    const canonical = grade && c.section ? `Room ${grade}0${c.section}` : c.room
    homeroomById.set(c.id, canonical ?? '')
    if (canonical && canonical !== c.room) {
      await db.class.update({ where: { id: c.id }, data: { room: canonical } })
      _normalized += 1
      console.log(`  homeroom normalised: ${c.name} "${c.room}" → "${canonical}"`)
    }
  }

  const rows = await db.timetable.findMany({ select: { id: true, classId: true, room: true } })
  let rewritten = 0
  let already = 0
  let noRoom = 0
  for (const r of rows) {
    const target = homeroomById.get(r.classId)
    if (!target) {
      noRoom += 1
      continue
    }
    if (r.room === target) {
      already += 1
      continue
    }
    await db.timetable.update({ where: { id: r.id }, data: { room: target } })
    rewritten += 1
  }
  console.log(
    `timetable rows: ${rows.length} — rewritten ${rewritten}, already-correct ${already}, no-homeroom ${noRoom}`,
  )

  // Post-verify: any room-slot still used by 2+ classes?
  const after = await db.timetable.findMany({ select: { room: true, day: true, period: true, classId: true } })
  const use = new Map<string, Set<string>>()
  for (const r of after) {
    if (!r.room) continue
    const k = `${r.room}|${r.day}|${r.period}`
    const set = use.get(k) ?? new Set<string>()
    set.add(r.classId)
    use.set(k, set)
  }
  const collisions = [...use.entries()].filter(([, s]) => s.size > 1)
  console.log(`post-verify room-slot collisions across classes: ${collisions.length}`)
  for (const [k, s] of collisions.slice(0, 8)) console.log(`  COLLISION ${k} → ${s.size} classes`)

  await db.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
