// ============================================================
// seed-learning — L2D-1 demo seed for Learning Experience 2.0
// (Hawkings High School — the demo tenant).
//
// Seeds REAL rows for the demo student (the one behind the demo login
// login identity — resolved at runtime from the roster, never hardcoded
// cuid):
//   · 4 flashcard decks with real cards (SM-2 states start empty —
//     every review a student does is genuinely computed from zero)
//   · 3 study groups with real memberships (plausible member counts
//     come from REAL StudyGroupMember rows, never display constants)
//   · 4 study planner tasks (one due today, one upcoming, one
//     tomorrow, one already completed)
//   · 3 published group questions + 1 honest PENDING question from
//     the demo student (moderation state is visible, never faked)
//   · real learning activity (one in-progress material → Continue
//     Learning works immediately; one completed) + one bookmark
//
// Idempotent: this school's decks/groups are replaced (cascades cards,
// review states, members, questions) and the demo student's tasks,
// activities and bookmarks are replaced on every run.
//
// Run: bun run db:seed-learning   (or: bun prisma/seed-learning.ts)
// ============================================================

import { assertSeedable } from './seed-guard'
import { DEMO_SCHOOL_SLUG, DEMO_STUDENT_POSITION } from './seed-identity'
import { buildStudentRoster } from './hawkings-corpus'
import { db } from '../src/lib/db'

// ─── Flashcard decks ────────────────────────────────────────────────

interface SeedDeck {
  name: string
  subject: 'Mathematics' | 'English' | null
  description: string
  cards: [string, string][]
}

const DECKS: SeedDeck[] = [
  {
    name: 'Addition & Subtraction',
    subject: 'Mathematics',
    description: 'Two-digit sums and differences with carrying and borrowing.',
    cards: [
      ['46 + 27 = ?', '73'],
      ['91 − 18 = ?', '73'],
      ['34 + __ = 70. What is the missing number?', '36'],
      ['38 + 25 = ?', '63'],
      ['70 − 25 = ?', '45'],
      ['56 + 29 = ?', '85'],
      ['100 − 44 = ?', '56'],
      ['27 + 15 = ?', '42'],
      ['63 − 39 = ?', '24'],
      ['48 + 12 + 10 = ?', '70'],
    ],
  },
  {
    name: 'Grammar Basics',
    subject: 'English',
    description: 'Nouns, verbs and articles from the grammar unit.',
    cards: [
      ['What do we call a NAMING word?', 'A noun'],
      ['What do we call an ACTION word?', 'A verb'],
      ['Find the nouns: "The cat jumped over the wall."', 'cat, wall'],
      ['Find the verb: "Diya sings a song."', 'sings'],
      ['Which article comes before a vowel sound: a or an?', 'an'],
      ['What is the opposite of "big"?', 'small'],
      ['What is the plural of "box"?', 'boxes'],
      ['Is "quickly" a noun or a verb?', 'Neither — it is an adverb (it describes the action)'],
    ],
  },
  {
    name: 'Living & Non-Living',
    subject: null,
    description: 'Science revision: what makes something a living thing.',
    cards: [
      ['Name two things ALL living things do.', 'Grow, and need food & water (also: breathe, reproduce)'],
      ['Is a plant living or non-living?', 'Living'],
      ['Is a chair living or non-living?', 'Non-living'],
      ['What do animals need to stay alive?', 'Food, water and air'],
      ['Do non-living things grow?', 'No — growing is a sign of life'],
      ['Sort these: stone, fish, pencil.', 'fish = living; stone, pencil = non-living'],
      ['Name one living thing you can see at home.', 'Any plant or pet (e.g. a houseplant)'],
      ['Why do we water plants?', 'They are living — water helps them grow'],
    ],
  },
  {
    name: 'General Knowledge',
    subject: null,
    description: 'Assembly-quiz favourites: symbols, planets and famous scientists.',
    cards: [
      ['What is the national bird of India?', 'The peacock'],
      ['Which planet is closest to the Sun?', 'Mercury'],
      ['How many colours are in a rainbow?', 'Seven'],
      ['The Sun is a … what?', 'A star'],
      ['Who was called the Missile Man of India?', 'Dr. A.P.J. Abdul Kalam'],
      ['What is the largest animal on Earth?', 'The blue whale'],
    ],
  },
]

// ─── Study groups ────────────────────────────────────────────────────

interface SeedGroup {
  name: string
  subject: 'Mathematics' | 'English' | null
  description: string
  /** How many OTHER students join (real membership rows). */
  otherMembers: number
}

const GROUPS: SeedGroup[] = [
  {
    name: 'Math Masters',
    subject: 'Mathematics',
    description: 'Weekly puzzle swaps and mental-maths practice.',
    otherMembers: 4,
  },
  {
    name: 'Science Explorers',
    subject: null,
    description: 'Experiments, nature walks and "why does it happen?" questions.',
    otherMembers: 3,
  },
  {
    name: 'Reading Circle',
    subject: 'English',
    description: 'Share what you are reading and help each other with new words.',
    otherMembers: 5,
  },
]

// ─── Group questions (published unless stated) ──────────────────────

const QUESTIONS: { group: string; from: 'demo' | 'other'; question: string; status: 'published' | 'pending' }[] = [
  { group: 'Math Masters', from: 'other', question: 'How do we carry over when adding 47 + 38?', status: 'published' },
  { group: 'Math Masters', from: 'demo', question: 'Is zero an even number?', status: 'published' },
  { group: 'Reading Circle', from: 'other', question: 'What does "vivid" mean in the story we read?', status: 'published' },
  { group: 'Science Explorers', from: 'demo', question: 'Why do leaves change colour in autumn?', status: 'pending' },
]

// ─── Study tasks ─────────────────────────────────────────────────────

function at(dayOffset: number, hour = 17): Date {
  const d = new Date()
  d.setDate(d.getDate() + dayOffset)
  d.setHours(hour, 0, 0, 0)
  return d
}

// ─── Seed runner ─────────────────────────────────────────────────────

async function main() {
  // Phase 8A — shared seed lock (fail-safe, first statement).
  assertSeedable('seed-learning')

  const school = await db.school.findFirst({ where: { slug: DEMO_SCHOOL_SLUG } })
    ?? await db.school.findFirst({ where: { isDemo: true } })
  if (!school) {
    throw new Error('Demo school not found — run prisma/seed.ts first.')
  }

  // The demo student (featured, DEMO_STUDENT_POSITION) — resolved exactly
  // the way the APIs do (user → student), from the deterministic roster.
  const _featuredDef = buildStudentRoster().find(
    (s) => s.level === DEMO_STUDENT_POSITION.level && s.idx === DEMO_STUDENT_POSITION.idx,
  )
  const demoUser = _featuredDef
    ? await db.user.findUnique({ where: { email: _featuredDef.studentEmail }, include: { student: true } })
    : null
  const demoStudent = demoUser?.student
  if (!demoStudent) {
    throw new Error('Demo student (featured, 7-A roll 01) not found — run prisma/seed.ts first.')
  }

  const subjects = await db.subject.findMany({ where: { schoolId: school.id } })
  const subjectId = (name: string | null): string | null =>
    name ? subjects.find((s) => s.name === name)?.id ?? null : null

  // Other students of the same school for REAL group memberships.
  const others = (await db.student.findMany({
    where: { schoolId: school.id, id: { not: demoStudent.id } },
    orderBy: { rollNo: 'asc' },
  })).slice(0, 12)

  // ── Idempotency ───────────────────────────────────────────────────
  await db.flashcardDeck.deleteMany({ where: { schoolId: school.id } }) // cascades cards + states
  await db.studyGroup.deleteMany({ where: { schoolId: school.id } }) // cascades members + questions
  await db.studyTask.deleteMany({ where: { studentId: demoStudent.id } })
  await db.learningActivity.deleteMany({ where: { studentId: demoStudent.id } })
  await db.learningBookmark.deleteMany({ where: { studentId: demoStudent.id } })

  // ── Decks + cards ─────────────────────────────────────────────────
  for (const deck of DECKS) {
    await db.flashcardDeck.create({
      data: {
        schoolId: school.id,
        subjectId: subjectId(deck.subject),
        name: deck.name,
        description: deck.description,
        cards: {
          create: deck.cards.map(([front, back], i) => ({ front, back, position: i + 1 })),
        },
      },
    })
  }

  // ── Groups + members ──────────────────────────────────────────────
  let memberCursor = 0
  const groupIdByName = new Map<string, string>()
  for (const group of GROUPS) {
    const members = others.slice(memberCursor, memberCursor + group.otherMembers)
    memberCursor += group.otherMembers
    const created = await db.studyGroup.create({
      data: {
        schoolId: school.id,
        subjectId: subjectId(group.subject),
        name: group.name,
        description: group.description,
        members: {
          create: [
            { studentId: demoStudent.id },
            ...members.map((m) => ({ studentId: m.id })),
          ],
        },
      },
    })
    groupIdByName.set(group.name, created.id)
  }

  // ── Questions ─────────────────────────────────────────────────────
  for (const q of QUESTIONS) {
    const groupId = groupIdByName.get(q.group)
    if (!groupId) continue
    await db.studyGroupQuestion.create({
      data: {
        groupId,
        schoolId: school.id,
        studentId: q.from === 'demo' ? demoStudent.id : others[0]?.id ?? demoStudent.id,
        question: q.question,
        status: q.status,
        createdAt: at(-2, 10),
      },
    })
  }

  // ── Study tasks ───────────────────────────────────────────────────
  await db.studyTask.createMany({
    data: [
      {
        schoolId: school.id,
        studentId: demoStudent.id,
        title: 'Finish Maths Worksheet 7',
        subjectId: subjectId('Mathematics'),
        dueDate: at(0, 18),
      },
      {
        schoolId: school.id,
        studentId: demoStudent.id,
        title: 'Revise Living & Non-Living flashcards',
        dueDate: at(1, 19),
      },
      {
        schoolId: school.id,
        studentId: demoStudent.id,
        title: 'Read the next chapter of the class reader',
        subjectId: subjectId('English'),
        dueDate: at(3, 17),
      },
      {
        schoolId: school.id,
        studentId: demoStudent.id,
        title: 'Practice mental sums for the Friday drill',
        subjectId: subjectId('Mathematics'),
        dueDate: at(-1, 17),
        completedAt: at(-1, 16),
      },
    ],
  })

  // ── Learning activity + bookmark (Continue Learning / Saved work) ──
  // Phase 8A PG-compat: mode 'insensitive' keeps SQLite-era matching
  // semantics after the provider flip (PG LIKE is case-sensitive).
  const mathsWorksheet = await db.studyMaterial.findFirst({
    where: { schoolId: school.id, title: { contains: 'Maths Worksheet 7', mode: 'insensitive' } },
  })
  const mentalSums = await db.studyMaterial.findFirst({
    where: { schoolId: school.id, title: { contains: 'Mental Sums', mode: 'insensitive' } },
  })
  const grammarNotes = await db.studyMaterial.findFirst({
    where: { schoolId: school.id, title: { contains: 'Grammar Notes', mode: 'insensitive' } },
  })

  if (mathsWorksheet) {
    await db.learningActivity.create({
      data: {
        schoolId: school.id,
        studentId: demoStudent.id,
        studyMaterialId: mathsWorksheet.id,
        openedAt: at(-2, 9),
        lastOpenedAt: at(-2, 9),
      },
    })
  }
  if (mentalSums) {
    await db.learningActivity.create({
      data: {
        schoolId: school.id,
        studentId: demoStudent.id,
        studyMaterialId: mentalSums.id,
        openedAt: at(-4, 8),
        lastOpenedAt: at(-3, 8),
        completedAt: at(-3, 8),
      },
    })
  }
  if (grammarNotes) {
    await db.learningBookmark.create({
      data: {
        schoolId: school.id,
        studentId: demoStudent.id,
        studyMaterialId: grammarNotes.id,
      },
    })
  }

  // ── Report ────────────────────────────────────────────────────────
  const deckCount = await db.flashcardDeck.count({ where: { schoolId: school.id } })
  const cardCount = await db.flashcardCard.count({
    where: { deck: { schoolId: school.id } },
  })
  const groupCount = await db.studyGroup.count({ where: { schoolId: school.id } })
  const memberCount = await db.studyGroupMember.count({
    where: { group: { schoolId: school.id } },
  })
  const questionCount = await db.studyGroupQuestion.count({
    where: { schoolId: school.id },
  })
  const taskCount = await db.studyTask.count({ where: { studentId: demoStudent.id } })

  console.log(`✅ Seeded Learning for ${school.name} (demo student ${demoUser?.email}).`)
  console.log(`   ${deckCount} decks / ${cardCount} cards · ${groupCount} groups / ${memberCount} memberships / ${questionCount} questions · ${taskCount} study tasks.`)
  console.log('   Activity: 1 in-progress material, 1 completed. Bookmarks: 1.')
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => db.$disconnect())
