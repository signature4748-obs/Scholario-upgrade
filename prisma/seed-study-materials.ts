// ============================================================
// seed-study-materials — RB-1 demo seed for the Study Materials
// repository (Hawkings High School — the demo tenant). L2D-1 update:
// rows now carry
// the publication lifecycle (status=published + publishedAt) and target
// the REAL class label of the demo student (resolved at runtime from the
// DB — never a hardcoded class string, so targeting can never drift from
// the authorization predicate).
//
// Creates 10 REALISTIC materials (worksheets, notes, syllabus, sample
// papers, revision packs) for the demo school — mostly the demo student's
// class plus a couple of whole-school items — and stores REAL, tiny, valid
// files in Supabase Storage (PRIVATE 'school-media' bucket, deterministic
// study-materials/<schoolId>/<fileName> paths; hand-built minimal PDFs
// with correct xref tables + plain-text sheets; total well under 200 KB).
// Phase 8A (8A-C9b): bytes leave the local disk — the seed writes objects
// via the storage wrapper (x-upsert, idempotent).
// Idempotent: rows + objects for the demo school are replaced on every run.
//
// Run: bun run db:seed-study-materials   (or: bun prisma/seed-study-materials.ts)
// ============================================================

import { randomBytes } from 'crypto'
import { assertSeedable } from './seed-guard'
import { DEMO_SCHOOL_SLUG, DEMO_STUDENT_POSITION, PROBE_MATERIAL_TITLE } from './seed-identity'
import { buildStudentRoster } from './hawkings-corpus'
import { db } from '../src/lib/db'
import { storageDelete, storageUpload, storedObjectLocation } from '../src/lib/storage/supabase'

// ─── Minimal VALID PDF builder (correct xref byte offsets) ──────────

function esc(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
}

/** One-page A4 PDF with a 16pt title and 11pt body lines (Helvetica). */
function buildMinimalPdf(title: string, lines: string[]): Buffer {
  const stream = [
    'BT /F1 16 Tf 72 770 Td (' + esc(title) + ') Tj ET',
    ...lines.map((l, i) => `BT /F1 11 Tf 72 ${738 - i * 20} Td (${esc(l)}) Tj ET`),
  ].join('\n')

  const objects: string[] = [
    '', // index 0 unused (PDF numbering starts at 1)
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]

  let pdf = '%PDF-1.4\n'
  const offsets: number[] = [0]
  for (let i = 1; i <= 5; i++) {
    offsets[i] = pdf.length // ASCII-only → string length == byte length
    pdf += `${i} 0 obj\n${objects[i]}\nendobj\n`
  }
  const startxref = pdf.length
  pdf += 'xref\n0 6\n0000000000 65535 f \n'
  for (let i = 1; i <= 5; i++) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`
  }
  pdf += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${startxref}\n%%EOF\n`
  return Buffer.from(pdf, 'utf8')
}

// ─── Seed data ───────────────────────────────────────────────────────

interface SeedMaterial {
  title: string
  description: string
  subject: 'Mathematics' | 'English' | null
  className: string | null
  category: 'worksheet' | 'notes' | 'syllabus' | 'sample-paper' | 'revision' | 'general'
  kind: 'pdf' | 'txt'
  body: string[]
  createdAt: string // ISO — staggered so "newest first" is meaningful
}
const SEED: SeedMaterial[] = [
  {
    title: 'Maths Worksheet 7 — Addition & Subtraction to 100',
    description: 'Twenty word problems revising two-digit carrying and borrowing. Bring the finished sheet to Friday\u2019s Maths period.',
    subject: 'Mathematics',
    className: 'MY-CLASS',
    category: 'worksheet',
    kind: 'pdf',
    body: [
      'Name: ________________       Roll No: ______       Date: ____________',
      '',
      '1.  Suma has 46 marbles. She wins 27 more. How many now?',
      '2.  Aarav reads 38 pages on Monday and 25 on Tuesday. Total pages?',
      '3.  There are 91 crayons in the box. 18 break. How many are left?',
      '4.  Fill in the blanks: 34 + __ = 70,    __ - 25 = 40',
      '5.  Circle the sums greater than 60: 28+31, 44+15, 19+38, 52+9',
      '',
      '(Attempt all twenty problems in your maths notebook.)',
    ],
    createdAt: '2026-09-10T09:15:00.000Z',
  },
  {
    title: 'English Grammar Notes — Nouns & Verbs',
    description: 'Class notes from the English grammar unit: what nouns and verbs are, spotting them in sentences, and ten practice sentences.',
    subject: 'English',
    className: 'MY-CLASS',
    category: 'notes',
    kind: 'pdf',
    body: [
      'A NAMING word is a NOUN — names of people, places, animals, things.',
      'An ACTION word is a VERB — what someone or something does.',
      '',
      'Spot them together:',
      '  The cat (noun) jumped (verb) over the wall (noun).',
      '  Diya (noun) sings (verb) a song (noun).',
      '',
      'Practice: underline the nouns and circle the verbs in these ten',
      'sentences from your reader.',
    ],
    createdAt: '2026-09-08T11:00:00.000Z',
  },
  {
    title: 'Class Syllabus Overview — AY 2026-27',
    description: 'Term-wise syllabus outline for every subject (April 2026 - March 2027), including assessment weeks and holidays.',
    subject: null,
    className: 'MY-CLASS',
    category: 'syllabus',
    kind: 'pdf',
    body: [
      'TERM 1 (Apr - Sep): Hindi - varnamala to matras; English - phonics,',
      'nouns, verbs; Maths - numbers to 100, shapes; Science - plants &',
      'animals around us; Social - my family, my school.',
      '',
      'TERM 2 (Oct - Mar): Hindi - simple sentences; English - tenses,',
      'picture composition; Maths - measurement, time, money; Science -',
      'living & non-living; Social - food, festivals, transport.',
      '',
      'Assessments: Unit tests (Jul, Nov), Term exams (Sep, Mar).',
    ],
    createdAt: '2026-08-28T08:30:00.000Z',
  },
  {
    title: 'English Sample Paper — Term 2 Examination',
    description: 'Full-length sample paper matching the Term 2 exam pattern: comprehension passage, grammar fill-ups, spelling dictation and guided writing.',
    subject: 'English',
    className: 'MY-CLASS',
    category: 'sample-paper',
    kind: 'pdf',
    body: [
      'Time: 1 hour 30 minutes                                    Marks: 50',
      '',
      'Section A - Comprehension (10): read the passage, answer five questions.',
      'Section B - Grammar (15): nouns, verbs, articles, opposites.',
      'Section C - Spelling (10): ten dictation words from Term 2.',
      'Section D - Guided writing (15): five sentences on "My Favourite Day".',
      '',
      'Best of luck! Read every question twice before answering.',
    ],
    createdAt: '2026-09-05T14:20:00.000Z',
  },
  {
    title: 'Maths Revision Sheet — Shapes & Patterns',
    description: 'One-page revision of 2-D shapes, edges & corners, and growing number patterns before the Term 2 unit test.',
    subject: 'Mathematics',
    className: 'MY-CLASS',
    category: 'revision',
    kind: 'pdf',
    body: [
      'SHAPES: triangle (3 sides), square (4 equal sides), rectangle',
      '(4 sides, 2 pairs equal), circle (no corners).',
      '',
      'Count and write: edges ______  corners ______',
      '',
      'PATTERNS: 2, 4, 6, 8, __ , __     1, 3, 5, 7, __ , __',
      'Draw the next shape: circle, square, circle, square, ______',
    ],
    createdAt: '2026-09-12T10:00:00.000Z',
  },
  {
    title: 'Mental Sums Practice — Daily Five Minutes',
    description: 'A plain-text drill sheet of thirty mental sums (doubles, number bonds to 20, skip counting). Aim for five minutes a day.',
    subject: 'Mathematics',
    className: 'MY-CLASS',
    category: 'worksheet',
    kind: 'txt',
    body: [
      'MENTAL SUMS PRACTICE - CLASS 2-A',
      '================================',
      '',
      'Doubles:        7+7=   8+8=   9+9=   6+6=   5+5=',
      'Number bonds:   __+9=20   8+__=20   __+13=20',
      'Skip counting:  3, 6, 9, __, __, __, __, __',
      'One more/less:  49+1=   60-1=   99+1=   70-1=',
      '',
      'Time yourself each day. Beat yesterday!',
    ],
    createdAt: '2026-09-01T07:45:00.000Z',
  },
  {
    title: 'Handwriting Practice — Capital Letters',
    description: 'Trace-and-copy practice lines for capital A to Z in four-line format. One page per week is enough.',
    subject: null,
    className: 'MY-CLASS',
    category: 'worksheet',
    kind: 'txt',
    body: [
      'HANDWRITING PRACTICE - CAPITAL LETTERS',
      'Four-line format:  _  _  _  _',
      '',
      'A A A A   B B B B   C C C C   D D D D',
      'E E E E   F F F F   G G G G   H H H H',
      'I I I I   J J J J   K K K K   L L L L',
      '',
      'Copy one line each day in your handwriting notebook.',
      'Sit straight, hold the pencil softly, start every stroke from the top.',
    ],
    createdAt: '2026-08-20T09:00:00.000Z',
  },
  {
    title: 'General Knowledge — Facts of the Week',
    description: 'This week\u2019s GK tidbits for the morning-assembly quiz: national symbols, planets, and one famous Indian scientist.',
    subject: null,
    className: null,
    category: 'notes',
    kind: 'txt',
    body: [
      'FACTS OF THE WEEK (whole school)',
      '=================================',
      '1. The national bird of India is the peacock.',
      '2. Earth is called the Blue Planet because of its oceans.',
      '3. Dr. A.P.J. Abdul Kalam was called the Missile Man of India.',
      '4. The Sun is a star - the closest one to Earth.',
      '5. A rainbow has seven colours.',
      '',
      'Quiz yourself in the morning assembly on Friday!',
    ],
    createdAt: '2026-09-11T06:30:00.000Z',
  },
  {
    title: 'School Reading List — Term 2',
    description: 'Recommended storybooks and readers for Classes 1-3 this term, with library shelf numbers. Borrow one at a time.',
    subject: null,
    className: null,
    category: 'general',
    kind: 'pdf',
    body: [
      'TERM 2 READING LIST (Classes 1-3)',
      '',
      'Class 1: "The Very Hungry Caterpillar" - Shelf A1',
      'Class 2: "The Magic Key" reader - Shelf A2',
      'Class 2: "Tales of Tenali Raman" - Shelf B1',
      'Class 3: "The Blue Umbrella" (young reader) - Shelf B2',
      '',
      'One book at a time. Return within 14 days.',
    ],
    createdAt: '2026-08-25T12:10:00.000Z',
  },
  {
    title: 'Science Revision — Living & Non-Living Things',
    description: 'Revision card for the EVS/Science unit: what makes something living, and sorting exercises with pictures from the class board.',
    subject: null,
    className: 'MY-CLASS',
    category: 'revision',
    kind: 'pdf',
    body: [
      'LIVING things: grow, need food & water, breathe, reproduce.',
      'NON-LIVING things: do not grow, do not need food.',
      '',
      'Sort these: plant, chair, dog, pencil, fish, stone.',
      'Living: plant, dog, fish.',
      'Non-living: chair, pencil, stone.',
      '',
      'Draw one living and one non-living thing you see at home.',
    ],
    createdAt: '2026-09-07T13:30:00.000Z',
  },
]

// ─── Seed runner ─────────────────────────────────────────────────────

async function main() {
  // Phase 8A — shared seed lock (fail-safe, first statement).
  assertSeedable('seed-study-materials')

  // Storage availability gate (same rule as the parked CI corpus): this
  // seed plants REAL objects in Supabase Storage — without storage
  // credentials (local PG / CI) it SKIPS gracefully (exit 0) instead of
  // crashing the demo pipeline. The DB rows are only meaningful with their
  // bytes; no local-disk fallback exists by design (mission §27-28).
  if (!(process.env.SUPABASE_URL ?? '').trim() || !(process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim()) {
    console.log('[seed-study-materials] storage credentials absent (local/CI) — skipping the materials corpus (Supabase Storage only, by design).')
    return
  }

  const school = await db.school.findFirst({ where: { slug: DEMO_SCHOOL_SLUG } })
    ?? await db.school.findFirst({ where: { isDemo: true } })
  if (!school) {
    throw new Error('Demo school not found — run prisma/seed.ts first.')
  }

  // Resolve the demo school's real subjects (plain string FKs).
  const subjects = await db.subject.findMany({ where: { schoolId: school.id } })
  const subjectIdByName = new Map(subjects.map((s) => [s.name, s.id]))
  const mathsId = subjectIdByName.get('Mathematics') ?? null
  const englishId = subjectIdByName.get('English') ?? null

  // The principal is the uploader of record.
  const principal = await db.user.findFirst({
    where: { schoolId: school.id, role: 'PRINCIPAL' },
    select: { id: true },
  })

  // L2D-1 — resolve the DEMO STUDENT's real class label (the student the
  // demo login chip authenticates). Class targeting must match the exact
  // label the authorization predicate compares against (Class.name).
  // Featured student (DEMO_STUDENT_POSITION — 7-A roll 01), resolved from
  // the deterministic roster.
  const featuredDef = buildStudentRoster().find(
    (s) => s.level === DEMO_STUDENT_POSITION.level && s.idx === DEMO_STUDENT_POSITION.idx,
  )
  const demoStudentUser = featuredDef
    ? await db.user.findUnique({
        where: { email: featuredDef.studentEmail },
        include: { student: { include: { class: { select: { name: true } } } } },
      })
    : null
  const demoClassLabel = demoStudentUser?.student?.class?.name ?? null
  const targetClass = (raw: string | null): string | null =>
    raw === 'MY-CLASS' ? demoClassLabel : raw

  // Idempotency — drop this school's existing rows AND their objects.
  // Phase 8A carve-out: the tenant-isolation probe material (title match,
  // planted by seed-tenant-isolation) is TEST INFRASTRUCTURE — it survives
  // this wipe so the canonical pipeline (tenant fixtures → … → this seed)
  // stays deterministic across re-runs.
  const existing = await db.studyMaterial.findMany({
    where: { schoolId: school.id, title: { not: PROBE_MATERIAL_TITLE } },
  })
  for (const m of existing) {
    if (/^[a-z0-9]+\.[a-z0-9]{1,8}$/.test(m.fileName)) {
      const loc = storedObjectLocation('study-materials', m.schoolId, m.fileName)
      await storageDelete(loc.bucket, loc.path).catch(() => {}) // missing = ok
    }
  }
  await db.studyMaterial.deleteMany({
    where: { schoolId: school.id, title: { not: PROBE_MATERIAL_TITLE } },
  })

  let totalBytes = 0
  for (const item of SEED) {
    const base = `cm${randomBytes(9).toString('hex')}`
    const ext = item.kind === 'pdf' ? 'pdf' : 'txt'
    const fileName = `${base}.${ext}`
    const mimeType =
      item.kind === 'pdf' ? 'application/pdf' : 'text/plain'

    const bytes =
      item.kind === 'pdf'
        ? buildMinimalPdf(item.title, item.body)
        : Buffer.from(item.body.join('\n') + '\n', 'utf8')
    totalBytes += bytes.byteLength

    // Phase 8A: bytes go to Supabase Storage (PRIVATE 'school-media',
    // x-upsert, deterministic path from the row being created below).
    await storageUpload('study-materials', fileName, bytes, mimeType, school.id)

    // ASCII-safe, header-friendly download name (title minus exotic chars).
    const safeTitle = item.title.replace(/[^A-Za-z0-9 ,&()'.-]+/g, ' ').replace(/\s+/g, ' ').trim()
    const originalName = `${safeTitle || 'material'}.${ext}`

    await db.studyMaterial.create({
      data: {
        id: base,
        schoolId: school.id,
        title: item.title,
        description: item.description,
        subjectId:
          item.subject === 'Mathematics' ? mathsId
          : item.subject === 'English' ? englishId
          : null,
        className: targetClass(item.className),
        category: item.category,
        fileName,
        originalName,
        mimeType,
        sizeBytes: bytes.byteLength,
        uploadedById: principal?.id ?? null,
        status: 'published',
        publishedAt: new Date(item.createdAt),
        createdAt: new Date(item.createdAt),
      },
    })
  }

  const count = await db.studyMaterial.count({ where: { schoolId: school.id } })
  console.log(`✅ Seeded ${count} study materials for ${school.name} (id ${school.id}).`)
  console.log(`   Objects stored in Supabase Storage (school-media: study-materials/${school.id}/<fileName>) — total ${(totalBytes / 1024).toFixed(1)} KB.`)
  if (demoClassLabel) console.log(`   Class-targeted materials aim at the demo student's class: "${demoClassLabel}".`)
  else console.log('   ⚠️ Demo student not found / has no class — class targeting is NULL (whole school).')
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => db.$disconnect())
