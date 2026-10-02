/**
 * seed-teacher-hub — demo data for the Teacher Hub modules (Hawkings)
 * (Parent Connect / Student Behavior).
 *
 * Principles (same as seed-student-dashboard.ts):
 *  • runtime-resolved ids only — school by slug, teacher by email, students
 *    by class roster; NO hardcoded cuids;
 *  • idempotent — deletes this school's Teacher Hub rows, then re-creates;
 *  • relative dates (daysAgo/daysAhead) so the demo never goes stale;
 *  • honest data — every conversation message, behavior record and
 *    follow-up is a real row the modules will actually read.
 *
 * Run: bun run db:seed-teacher-hub
 */

import { assertSeedable } from './seed-guard'
import { DEMO_SCHOOL_SLUG } from './seed-identity'
import { db } from '../src/lib/db'

const daysAgo = (n: number, h = 10, m = 0): Date => {
  const d = new Date()
  d.setDate(d.getDate() - n)
  d.setHours(h, m, 0, 0)
  return d
}
const daysAhead = (n: number, h = 10, m = 0): Date => daysAgo(-n, h, m)

async function main() {
  // Phase 8A — shared seed lock (fail-safe, first statement).
  assertSeedable('seed-teacher-hub')

  const school = await db.school.findFirst({ where: { slug: DEMO_SCHOOL_SLUG } })
  if (!school) throw new Error(`${DEMO_SCHOOL_SLUG} not found`)

  // HAWKINGS corpus: the hub teacher is the 1-A class teacher (faculty #1,
  // Smt. Kavita Singh — teacher1@hawkingshigh.edu); the co-teacher is
  // faculty #2 (2-A). The roster's guardians already carry proper names.
  const teacherUser = await db.user.findFirst({ where: { email: 'teacher1@hawkingshigh.edu' } })
  if (!teacherUser) throw new Error('Demo teacher user (teacher1@hawkingshigh.edu) not found')
  const teacher = await db.teacher.findUnique({ where: { userId: teacherUser.id } })
  if (!teacher) throw new Error('Teacher profile row not found for demo teacher')

  const coTeacherUser = await db.user.findFirst({ where: { email: 'teacher2@hawkingshigh.edu' } })

  // 1. The hub teacher IS the class teacher of 1-A (corpus-owned —
  // re-asserted idempotently).
  const class1A = await db.class.findFirst({
    where: { schoolId: school.id, name: '1-A' },
    include: { students: { where: { guardianId: { not: null } }, orderBy: { rollNo: 'asc' }, include: { user: { select: { name: true } } } } },
  })
  if (!class1A) throw new Error('Class 1-A not found')
  await db.class.update({ where: { id: class1A.id }, data: { classTeacherId: teacherUser.id } })

  const students = class1A.students
  const byRoll = new Map(students.map((s) => [s.rollNo ?? '', s]))
  const firstNameOf = (roll: string) => (byRoll.get(roll)?.user?.name ?? 'Student').split(' ')[0]
  const studentName = (roll: string) => byRoll.get(roll)?.id
  const _guardianUser = async (roll: string) => {
    const student = byRoll.get(roll)
    if (!student?.guardianId) throw new Error(`No guardian user for roll ${roll}`)
    const guardian = await db.user.findUnique({ where: { id: student.guardianId } })
    if (!guardian) throw new Error(`Guardian user missing for roll ${roll}`)
    return guardian
  }

  // 3. Idempotent wipe of this school's Teacher Hub data.
  await db.teacherFollowUp.deleteMany({ where: { schoolId: school.id } })
  await db.parentMessage.deleteMany({ where: { schoolId: school.id } })
  await db.parentConversation.deleteMany({ where: { schoolId: school.id } })
  await db.behaviorRecord.deleteMany({ where: { schoolId: school.id } })
  await db.behaviorCategory.deleteMany({ where: { schoolId: school.id } })
  await db.messageTemplate.deleteMany({ where: { schoolId: school.id, kind: 'parent-connect' } })

  // 4. Behavior categories — school-configurable taxonomy (spec §C).
  const categories: { key: string; label: string; kind: string; sortOrder: number }[] = [
    { key: 'positive-recognition', label: 'Positive Recognition', kind: 'positive', sortOrder: 1 },
    { key: 'class-participation', label: 'Class Participation', kind: 'any', sortOrder: 2 },
    { key: 'leadership', label: 'Leadership', kind: 'positive', sortOrder: 3 },
    { key: 'collaboration', label: 'Collaboration', kind: 'positive', sortOrder: 4 },
    { key: 'respect-conduct', label: 'Respect & Conduct', kind: 'any', sortOrder: 5 },
    { key: 'academic-effort', label: 'Academic Effort', kind: 'any', sortOrder: 6 },
    { key: 'attendance-concern', label: 'Attendance Concern', kind: 'concern', sortOrder: 7 },
    { key: 'classroom-concern', label: 'Classroom Concern', kind: 'concern', sortOrder: 8 },
    { key: 'safety-concern', label: 'Safety Concern', kind: 'concern', sortOrder: 9 },
    { key: 'other', label: 'Other', kind: 'any', sortOrder: 10 },
  ]
  await db.behaviorCategory.createMany({
    data: categories.map((c) => ({ ...c, schoolId: school.id })),
  })

  // 5. School-approved Parent Connect quick-reply templates (spec §E).
  const templates: { label: string; body: string; category: string; sortOrder: number }[] = [
    {
      label: 'Attendance concern',
      body: 'Dear Parent,\n\nI noticed {student} was absent/late recently. Could you please confirm everything is alright? Happy to discuss if there is anything the school should know.\n\nRegards,\n{teacher}',
      category: 'attendance',
      sortOrder: 1,
    },
    {
      label: 'Academic update',
      body: 'Dear Parent,\n\nSharing a quick update on {student}\'s recent academic progress. {note}\n\nPlease feel free to reach out with any questions.\n\nRegards,\n{teacher}',
      category: 'academic',
      sortOrder: 2,
    },
    {
      label: 'Homework reminder',
      body: 'Dear Parent,\n\nA gentle reminder that {student} has pending homework this week. Your support in ensuring completion would be appreciated.\n\nRegards,\n{teacher}',
      category: 'academic',
      sortOrder: 3,
    },
    {
      label: 'PTM reminder',
      body: 'Dear Parent,\n\nThe Parent-Teacher Meeting is scheduled soon. Please book a convenient slot. I look forward to discussing {student}\'s progress.\n\nRegards,\n{teacher}',
      category: 'general',
      sortOrder: 4,
    },
    {
      label: 'Positive feedback',
      body: 'Dear Parent,\n\nI wanted to share something wonderful — {note}\n\n{student} should be really proud. Thank you for your support at home!\n\nRegards,\n{teacher}',
      category: 'behavior',
      sortOrder: 5,
    },
    {
      label: 'General message',
      body: 'Dear Parent,\n\n{note}\n\nRegards,\n{teacher}',
      category: 'general',
      sortOrder: 6,
    },
  ]
  await db.messageTemplate.createMany({
    data: templates.map((t) => ({ ...t, schoolId: school.id, kind: 'parent-connect' })),
  })

  // 6. Parent conversations + threads (bodies parametrised with the REAL
  //    roster names — resolved at runtime, never hardcoded).
  interface SeedMessage {
    fromParent: boolean
    body: string
    at: Date
    read?: boolean // read by the recipient
  }
  const conversationsToSeed: {
    roll: string
    category: string
    pinned?: boolean
    messages: SeedMessage[]
  }[] = [
    {
      roll: '01',
      category: 'academic',
      pinned: true,
      messages: [
        {
          fromParent: true,
          body: 'Namaste Kavita miss. {S} ke padhai mein sudhaar ho raha hai — ghar par hum roz 20 minute practice karate hain. Kuchh aur salah dijiye.',
          at: daysAgo(3, 9, 14),
          read: true,
        },
        {
          fromParent: false,
          body: 'Namaste. {S} is doing very well — recognises all the letters and is counting confidently to 50 now. Continue the daily practice; reading picture books together at home will help most.',
          at: daysAgo(3, 11, 42),
          read: true,
        },
        {
          fromParent: true,
          body: 'Bahut achha sun kar khushi hui. Dhanyavaad miss.',
          at: daysAgo(2, 8, 30),
          read: true,
        },
      ],
    },
    {
      roll: '02',
      category: 'attendance',
      messages: [
        {
          fromParent: true,
          body: 'Namaste miss, {S} is hafte mein do baar late pahunch raha hai — cycle puncture ho jata hai raaste mein. Kya kuchh salah de sakte hain?',
          at: daysAgo(6, 18, 45),
          read: true,
        },
        {
          fromParent: false,
          body: 'Thank you for flagging this. {S} reaches by the second bell, so no class time is missed — but let us keep an eye on it together. Leaving ten minutes earlier usually solves the puncture problem, or the school cycle stand can hold a spare tube.',
          at: daysAgo(6, 19, 30),
          read: true,
        },
        {
          fromParent: true,
          body: 'Theek hai miss, hum thoda pehle bhejenge. Dhanyavaad.',
          at: daysAgo(2, 9, 5),
        },
      ],
    },
    {
      roll: '03',
      category: 'behavior',
      messages: [
        {
          fromParent: true,
          body: 'Miss, {S} ne bataya ki kal class mein koi baat hui thi. Kya hua tha?',
          at: daysAgo(10, 20, 10),
          read: true,
        },
        {
          fromParent: false,
          body: 'Some playing during the revision period, nothing serious. I spoke with {S} after class and everything is fine. Participation has actually been very good since. No cause for concern.',
          at: daysAgo(9, 8, 25),
          read: true,
        },
        {
          fromParent: true,
          body: 'Aapne aise sambhala isliye dhanyavaad miss.',
          at: daysAgo(9, 12, 0),
          read: true,
        },
      ],
    },
    {
      roll: '04',
      category: 'academic',
      messages: [
        {
          fromParent: false,
          body: 'Namaste,\n\nAaj aapko batana chahti thi — {S} ne aaj ki writing test mein sabse sundar copy banayi aur do doston ki madad ki. Bahut achha kaam kiya hai!\n\n regards,\nKavita Singh (Class Teacher, 1-A)',
          at: daysAgo(5, 16, 0),
          read: true,
        },
      ],
    },
    {
      roll: '05',
      category: 'wellbeing',
      messages: [
        {
          fromParent: true,
          body: 'Namaste miss, {S} kuchh din se school jaane mein hijhak kar raha hai. Kya class mein sab theek hai? Aapse baat karke mann halka ho jayega.',
          at: daysAgo(1, 20, 40),
        },
      ],
    },
  ]
  // Interpolate the REAL student first names into the message bodies.
  for (const c of conversationsToSeed) {
    const fn = firstNameOf(c.roll)
    for (const m of c.messages) {
      m.body = m.body.replace(/\{S\}/g, fn)
    }
  }

  const conversationIds = new Map<string, string>() // roll -> conversation id
  for (const c of conversationsToSeed) {
    const student = byRoll.get(c.roll)
    if (!student?.guardianId) continue
    const lastAt = c.messages[c.messages.length - 1]?.at ?? daysAgo(1)
    const conversation = await db.parentConversation.create({
      data: {
        schoolId: school.id,
        teacherId: teacherUser.id,
        parentId: student.guardianId,
        studentId: student.id,
        category: c.category,
        pinned: c.pinned ?? false,
        lastMessageAt: lastAt,
        createdAt: c.messages[0]?.at ?? daysAgo(30),
      },
    })
    conversationIds.set(c.roll, conversation.id)
    for (const m of c.messages) {
      await db.parentMessage.create({
        data: {
          schoolId: school.id,
          conversationId: conversation.id,
          senderId: m.fromParent ? student.guardianId : teacherUser.id,
          body: m.body,
          readAt: m.read ? new Date(m.at.getTime() + 45 * 60 * 1000) : null,
          createdAt: m.at,
        },
      })
    }
  }

  // 7. Behavior records — positive-heavy (spec §F), some by the co-teacher.
  interface SeedRecord {
    roll: string
    daysAgo: number
    category: string
    type: 'positive' | 'observation' | 'concern'
    description: string
    actionTaken?: string
    followUpRequired?: boolean
    followUpInDays?: number
    privateNote?: string
    status?: 'open' | 'monitoring' | 'resolved'
    parentNotified?: boolean
    byCoTeacher?: boolean
  }
  const records: SeedRecord[] = [
    {
      roll: '01',
      daysAgo: 5,
      category: 'leadership',
      type: 'positive',
      description: 'Led the four-member group during the class project — shared the colours, helped friends spell their names and presented the chart confidently.',
      parentNotified: true,
    },
    {
      roll: '01',
      daysAgo: 20,
      category: 'academic-effort',
      type: 'positive',
      description: 'Consistent effort in Mathematics — completed both extension counting worksheets without prompting.',
    },
    {
      roll: '02',
      daysAgo: 7,
      category: 'collaboration',
      type: 'positive',
      description: 'Helped two classmates tidy the activity corner after the drawing period without being asked.',
    },
    {
      roll: '03',
      daysAgo: 9,
      category: 'classroom-concern',
      type: 'concern',
      description: 'Playing and distracting peers during the revision period before the unit test.',
      actionTaken: 'Spoke with the student after class; agreed to sit near the front during revision.',
      followUpRequired: true,
      followUpInDays: 3,
      status: 'monitoring',
      parentNotified: true,
      privateNote: 'Watch during high-pressure weeks; the guardian is supportive — coordinate if repeated.',
    },
    {
      roll: '03',
      daysAgo: 15,
      category: 'class-participation',
      type: 'observation',
      description: 'Participation has been improving — volunteered twice to recite in the morning assembly.',
    },
    {
      roll: '04',
      daysAgo: 3,
      category: 'respect-conduct',
      type: 'positive',
      description: 'Volunteered to help the class monitor distribute the mid-day meal plates during the lunch period.',
    },
    {
      roll: '05',
      daysAgo: 12,
      category: 'attendance-concern',
      type: 'concern',
      description: 'Three late arrivals this week (Mon, Wed, Thu) — missing the first ten minutes of the English period.',
      followUpRequired: true,
      followUpInDays: -1, // overdue
      status: 'open',
      privateNote: 'Cycle punctures suspected — the guardian raised the same issue separately. Ask about leaving earlier.',
    },
    {
      roll: '05',
      daysAgo: 25,
      category: 'academic-effort',
      type: 'observation',
      description: 'Homework quality improving steadily since the fixed evening study hour was set at home.',
    },
    {
      roll: '02',
      daysAgo: 4,
      category: 'class-participation',
      type: 'positive',
      description: 'Excellent contributions during the Hindi story-telling activity — retold the whole Panchatantra tale in order.',
    },
    {
      roll: '04',
      daysAgo: 18,
      category: 'leadership',
      type: 'positive',
      description: 'Captained the house team in the inter-class races on Sports Day and helped the younger runners at the finish line.',
      parentNotified: true,
    },
    {
      roll: '05',
      daysAgo: 9,
      category: 'collaboration',
      type: 'observation',
      description: 'Prefers playing alone during the games period — gently encouraged to join the group this week.',
      byCoTeacher: true,
    },
    {
      roll: '01',
      daysAgo: 30,
      category: 'academic-effort',
      type: 'positive',
      description: 'Scored the highest in the class on the English dictation test and helped two classmates practise the tricky words.',
      byCoTeacher: true,
      parentNotified: true,
    },
    {
      roll: '02',
      daysAgo: 11,
      category: 'safety-concern',
      type: 'concern',
      description: 'Climbed the gate railings while waiting for the bus at dismissal.',
      actionTaken: 'Safety briefing given immediately; re-explained the waiting protocol with the class.',
      status: 'resolved',
      parentNotified: true,
    },
    {
      roll: '03',
      daysAgo: 6,
      category: 'respect-conduct',
      type: 'positive',
      description: 'Consistently courteous — remembered to thank the didi after the mid-day meal without prompting.',
    },
  ]

  const recordIds: { roll: string; recordId: string; followUpInDays?: number }[] = []
  for (const r of records) {
    const student = byRoll.get(r.roll)
    if (!student) continue
    const recordedById = r.byCoTeacher && coTeacherUser ? coTeacherUser.id : teacherUser.id
    const row = await db.behaviorRecord.create({
      data: {
        schoolId: school.id,
        studentId: student.id,
        recordedById,
        date: daysAgo(r.daysAgo, 13, 30),
        category: r.category,
        type: r.type,
        description: r.description,
        actionTaken: r.actionTaken ?? null,
        followUpRequired: r.followUpRequired ?? false,
        followUpDate: r.followUpRequired && r.followUpInDays != null ? daysAhead(r.followUpInDays, 15, 0) : null,
        privateNote: r.privateNote ?? null,
        status: r.status ?? (r.type === 'concern' ? 'open' : 'resolved'),
        parentNotified: r.parentNotified ?? false,
      },
    })
    recordIds.push({ roll: r.roll, recordId: row.id, followUpInDays: r.followUpInDays })
    void studentName
  }

  // 9. Follow-ups (unified queue) — linked to their sources.
  const studentIdOf = (roll: string) => byRoll.get(roll)?.id ?? null
  const nameOf = (roll: string) => firstNameOf(roll)

  const pcFollowUps: { roll: string; reason: string; dueInDays: number; priority: string; note?: string }[] = [
    {
      roll: '02',
      reason: "Confirm the revised leaving time with {N}'s guardian",
      dueInDays: 2,
      priority: 'high',
      note: 'The cycle-puncture suggestion — confirm it worked this week.',
    },
    {
      roll: '05',
      reason: "Share the wellbeing observation with {N}'s guardian (PTM)",
      dueInDays: 1,
      priority: 'high',
    },
    {
      roll: '01',
      reason: 'Send the alphabet practice chart to the guardian',
      dueInDays: -1, // overdue
      priority: 'normal',
    },
  ]
  for (const f of pcFollowUps) {
    await db.teacherFollowUp.create({
      data: {
        schoolId: school.id,
        teacherId: teacherUser.id,
        kind: 'parent-connect',
        studentId: studentIdOf(f.roll),
        conversationId: conversationIds.get(f.roll) ?? null,
        reason: f.reason.replace('{N}', nameOf(f.roll)),
        note: f.note ?? null,
        dueDate: daysAhead(f.dueInDays, 15, 0),
        priority: f.priority,
      },
    })
  }

  for (const r of recordIds) {
    if (r.followUpInDays == null) continue
    const student = byRoll.get(r.roll)
    await db.teacherFollowUp.create({
      data: {
        schoolId: school.id,
        teacherId: teacherUser.id,
        kind: 'behavior',
        studentId: student?.id ?? null,
        recordId: r.recordId,
        reason: `Behavior follow-up — ${student?.rollNo ? `Roll ${student.rollNo}` : 'student'}`,
        dueDate: daysAhead(r.followUpInDays, 15, 0),
        priority: 'high',
      },
    })
  }

  // Summary
  const counts = {
    conversations: await db.parentConversation.count({ where: { schoolId: school.id } }),
    messages: await db.parentMessage.count({ where: { schoolId: school.id } }),
    behaviorRecords: await db.behaviorRecord.count({ where: { schoolId: school.id } }),
    followUps: await db.teacherFollowUp.count({ where: { schoolId: school.id } }),
    categories: await db.behaviorCategory.count({ where: { schoolId: school.id } }),
    templates: await db.messageTemplate.count({ where: { schoolId: school.id } }),
  }
  console.log('TEACHER-HUB SEED COMPLETE:', JSON.stringify(counts, null, 2))
  console.log(`Hub corpus anchored on 1-A (class teacher ${teacherUser.name})`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
