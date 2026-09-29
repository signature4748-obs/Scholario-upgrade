/**
 * seed-teacher-hub — demo data for the Teacher Hub modules
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

import { db } from '../src/lib/db'

const daysAgo = (n: number, h = 10, m = 0): Date => {
  const d = new Date()
  d.setDate(d.getDate() - n)
  d.setHours(h, m, 0, 0)
  return d
}
const daysAhead = (n: number, h = 10, m = 0): Date => daysAgo(-n, h, m)

async function main() {
  const school = await db.school.findFirst({ where: { slug: 'demo-school' } })
  if (!school) throw new Error('demo-school not found')

  const teacherUser = await db.user.findFirst({ where: { email: 'rohan.mehta@greenwood.edu.in' } })
  if (!teacherUser) throw new Error('Demo teacher user (rohan.mehta@greenwood.edu.in) not found')
  const teacher = await db.teacher.findUnique({ where: { userId: teacherUser.id } })
  if (!teacher) throw new Error('Teacher profile row not found for demo teacher')

  const kavitaUser = await db.user.findFirst({ where: { email: 'teacher1@demoschool.edu' } })

  // 1. The demo teacher becomes the class teacher of Grade 9-A (idempotent).
  const grade9 = await db.class.findFirst({
    where: { schoolId: school.id, name: { contains: '9' } },
    include: { students: { where: { guardianId: { not: null } }, orderBy: { rollNo: 'asc' } } },
  })
  if (!grade9) throw new Error('Grade 9 class not found')
  await db.class.update({ where: { id: grade9.id }, data: { classTeacherId: teacherUser.id } })

  const students = grade9.students
  const byRoll = new Map(students.map((s) => [s.rollNo ?? '', s]))
  const studentName = (roll: string) => byRoll.get(roll)?.id

  // 2. Give Grade 9-A's guardian users proper display names (display-only).
  const parentNames: Record<string, string> = {
    'parent2@demoschool.edu': 'Mrs. Sneha Patel',
    'parent3@demoschool.edu': 'Mr. Karthik Reddy',
    'parent4@demoschool.edu': 'Mrs. Meera Gupta',
    'parent5@demoschool.edu': 'Mr. Ravindra Singh',
    'parent6@demoschool.edu': 'Mrs. Lakshmi Nair',
    'parent7@demoschool.edu': 'Mr. Rajesh Iyer',
    'parent8@demoschool.edu': 'Mrs. Anita Verma',
    'parent9@demoschool.edu': 'Mr. Sandeep Joshi',
    'parent10@demoschool.edu': 'Mrs. Priya Mehta',
  }
  for (const [email, name] of Object.entries(parentNames)) {
    await db.user.updateMany({ where: { email, schoolId: school.id, role: 'PARENT' }, data: { name } })
  }
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

  // 6. Parent conversations + threads.
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
          body: 'Good morning Mr. Mehta. Aarav mentioned the maths olympiad selection is coming up — could you share how he is tracking against the class?',
          at: daysAgo(3, 9, 14),
          read: true,
        },
        {
          fromParent: false,
          body: 'Good morning! Aarav is doing very well — he is consistently in the top three for problem-solving this term. I have shared two extra practice sets with him. Selection is in two weeks; he is on track.',
          at: daysAgo(3, 11, 42),
          read: true,
        },
        {
          fromParent: true,
          body: 'That is wonderful to hear. Thank you for the extra practice sets — he has been enjoying them!',
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
          body: 'Hello Sir, Diya has been reaching school late this week even though she leaves home at the usual time. Is the school bus running behind schedule?',
          at: daysAgo(6, 18, 45),
          read: true,
        },
        {
          fromParent: false,
          body: 'Thank you for flagging this, Mrs. Patel. I checked the arrival register — the bus on Route A has been arriving 10–12 minutes late since Monday. I am taking this up with the transport office tomorrow and will confirm by Friday.',
          at: daysAgo(6, 19, 30),
          read: true,
        },
        {
          fromParent: true,
          body: 'Thank you for the quick response. One more thing — could we also get the revised pickup time once it is fixed?',
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
          body: 'Mr. Mehta, Vivaan mentioned there was an incident in class yesterday. Could you let us know what happened?',
          at: daysAgo(10, 20, 10),
          read: true,
        },
        {
          fromParent: false,
          body: 'Hello Mr. Reddy — some talking during the revision period, nothing serious. I spoke with Vivaan after class and he understood. He has been participating well since. No cause for concern.',
          at: daysAgo(9, 8, 25),
          read: true,
        },
        {
          fromParent: true,
          body: 'Thank you for handling it so well, Sir.',
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
          body: 'Dear Mrs. Gupta,\n\nI wanted to share something wonderful — Ananya scored the highest in the class on the Physics unit test and helped two classmates prepare before the exam. She should be really proud!\n\nRegards,\nRohan Mehta',
          at: daysAgo(5, 16, 0),
          read: true,
        },
      ],
    },
    {
      roll: '09',
      category: 'general',
      messages: [
        {
          fromParent: false,
          body: 'Dear Mr. Joshi,\n\nA gentle reminder that Reyansh has two pending homework submissions this week. Your support in ensuring completion would be appreciated.\n\nRegards,\nRohan Mehta',
          at: daysAgo(8, 15, 30),
          read: true,
        },
        {
          fromParent: true,
          body: 'Thank you Sir. We have set a fixed homework hour at home from today.',
          at: daysAgo(7, 9, 15),
          read: true,
        },
      ],
    },
    {
      roll: '10',
      category: 'wellbeing',
      messages: [
        {
          fromParent: true,
          body: 'Hello Sir, Myra has been quite anxious about the upcoming exams — difficulty sleeping and some mornings of tears. Could we talk about how she is coping in school?',
          at: daysAgo(1, 20, 40),
        },
      ],
    },
    {
      roll: '05',
      category: 'general',
      messages: [
        {
          fromParent: false,
          body: 'Dear Mr. Singh,\n\nThe Parent-Teacher Meeting is scheduled soon. Please book a convenient slot through the PTM scheduler. I look forward to discussing Aditya\'s progress.\n\nRegards,\nRohan Mehta',
          at: daysAgo(14, 12, 0),
          read: true,
        },
        {
          fromParent: true,
          body: 'Noted, thank you Sir. We will book for the Saturday morning slot.',
          at: daysAgo(13, 10, 30),
          read: true,
        },
      ],
    },
  ]

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
    byKavita?: boolean
  }
  const records: SeedRecord[] = [
    {
      roll: '01',
      daysAgo: 5,
      category: 'leadership',
      type: 'positive',
      description: 'Led the four-member science fair project team — allocated work, tracked progress and presented the results confidently.',
      parentNotified: true,
    },
    {
      roll: '01',
      daysAgo: 20,
      category: 'academic-effort',
      type: 'positive',
      description: 'Consistent effort in Mathematics — completed both extension problem sets without prompting.',
    },
    {
      roll: '02',
      daysAgo: 7,
      category: 'collaboration',
      type: 'positive',
      description: 'Helped two classmates with the titration setup during the Chemistry lab without being asked.',
    },
    {
      roll: '03',
      daysAgo: 9,
      category: 'classroom-concern',
      type: 'concern',
      description: 'Talking and distracting peers during the revision period before the unit test.',
      actionTaken: 'Spoke with Vivaan after class; he apologised and agreed to move seats during revision.',
      followUpRequired: true,
      followUpInDays: 3,
      status: 'monitoring',
      parentNotified: true,
      privateNote: 'Watch for attention-seeking during high-pressure weeks; coordinate with the counsellor if repeated.',
    },
    {
      roll: '03',
      daysAgo: 15,
      category: 'class-participation',
      type: 'observation',
      description: 'Participation has been improving — volunteered twice to solve problems on the board.',
    },
    {
      roll: '10',
      daysAgo: 3,
      category: 'respect-conduct',
      type: 'positive',
      description: 'Volunteered to help the class librarian reorganise the reading corner during the activity period.',
    },
    {
      roll: '09',
      daysAgo: 12,
      category: 'attendance-concern',
      type: 'concern',
      description: 'Three late arrivals this week (Mon, Wed, Thu) — missing the first ten minutes of Mathematics.',
      followUpRequired: true,
      followUpInDays: -1, // overdue
      status: 'open',
      privateNote: 'Bus Route A timing suspected as the cause — parent raised the same issue separately. Confirm with transport office.',
    },
    {
      roll: '09',
      daysAgo: 25,
      category: 'academic-effort',
      type: 'observation',
      description: 'Homework quality improving steadily since the fixed homework hour was set at home.',
    },
    {
      roll: '06',
      daysAgo: 4,
      category: 'class-participation',
      type: 'positive',
      description: 'Excellent contributions during the debate on renewable energy — well-researched arguments.',
    },
    {
      roll: '07',
      daysAgo: 18,
      category: 'leadership',
      type: 'positive',
      description: 'Captained the inter-house quiz team and organised practice sessions for the junior members.',
      parentNotified: true,
    },
    {
      roll: '08',
      daysAgo: 9,
      category: 'collaboration',
      type: 'observation',
      description: 'Prefers working alone during group activities — gently encouraged to pair up this week.',
      byKavita: true,
    },
    {
      roll: '04',
      daysAgo: 30,
      category: 'academic-effort',
      type: 'positive',
      description: 'Scored the highest in the class on the Physics unit test and helped two classmates prepare.',
      byKavita: true,
      parentNotified: true,
    },
    {
      roll: '06',
      daysAgo: 11,
      category: 'safety-concern',
      type: 'concern',
      description: 'Used the lab equipment without supervision while the class was being dismissed.',
      actionTaken: 'Safety briefing given immediately; re-demonstrated the correct waiting protocol.',
      status: 'resolved',
      parentNotified: true,
    },
    {
      roll: '05',
      daysAgo: 6,
      category: 'respect-conduct',
      type: 'positive',
      description: 'Consistently courteous — remembered to thank the support staff after the sports period.',
    },
  ]

  const recordIds: { roll: string; recordId: string; followUpInDays?: number }[] = []
  for (const r of records) {
    const student = byRoll.get(r.roll)
    if (!student) continue
    const recordedById = r.byKavita && kavitaUser ? kavitaUser.id : teacherUser.id
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

  const pcFollowUps: { roll: string; reason: string; dueInDays: number; priority: string; note?: string }[] = [
    {
      roll: '02',
      reason: "Confirm revised bus pickup time with Diya's parent",
      dueInDays: 2,
      priority: 'high',
      note: 'Transport office expects the Route A review by Friday.',
    },
    {
      roll: '10',
      reason: "Share wellbeing resources with Myra's parent",
      dueInDays: 1,
      priority: 'high',
    },
    {
      roll: '01',
      reason: 'Send assessment summary notes to Mr. Desai',
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
        reason: f.reason,
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
  console.log(`Class teacher of Grade 9-A → ${teacherUser.name}`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
