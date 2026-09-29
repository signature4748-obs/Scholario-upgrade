import { NextRequest } from 'next/server'
import ZAI from 'z-ai-web-dev-sdk'
import { z } from 'zod'
import { db } from '@/lib/db'
import { withAuthz } from '@/lib/security/authz'
import { parseJsonBody, idSchema, safeText } from '@/lib/security/validation'
import { RATE_LIMITS, enforceRateLimit } from '@/lib/security/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

type GeneratedQuestion = {
  question: string
  optionA: string
  optionB: string
  optionC: string
  optionD: string
  answer: 'A' | 'B' | 'C' | 'D'
  difficulty: string
  marks: number
}

let aiClient: Awaited<ReturnType<typeof ZAI.create>> | null = null
async function getAIClient() {
  if (!aiClient) {
    aiClient = await ZAI.create()
  }
  return aiClient
}

const aiBodySchema = z
  .object({
    subject: safeText(100, 0).optional(),
    topic: safeText(200, 0).optional(),
    gradeLevel: safeText(10, 0).optional(),
    difficulty: safeText(10, 0).optional(),
    count: z.number().int().min(1).max(15).optional(),
    type: safeText(20, 0).optional(),
    autoSave: z.boolean().optional(),
    subjectId: idSchema.optional(),
    classId: idSchema.optional(),
  })
  .strict()

export async function POST(req: NextRequest) {
  return withAuthz({ permission: 'school.questionbank.write' }, async (ctx) => {
    // Phase 1 — AI generation is expensive: strict per-user rate limit
    // (12/hour) blunts abuse and runaway cost.
    enforceRateLimit(`rl:ai:${ctx.user.id}`, RATE_LIMITS.ai)

    const body = await parseJsonBody(req, aiBodySchema)

    // FK-in-tenant (audit 3-b LOW): when auto-saving, subjectId/classId
    // must belong to the caller's school before rows are linked.
    if (body.autoSave && body.subjectId) {
      const subject = await db.subject.findFirst({
        where: { id: body.subjectId, schoolId: ctx.schoolId },
        select: { id: true },
      })
      if (!subject) throw new Error('NOT_FOUND')
    }
    if (body.autoSave && body.classId) {
      const cls = await db.class.findFirst({
        where: { id: body.classId, schoolId: ctx.schoolId },
        select: { id: true },
      })
      if (!cls) throw new Error('NOT_FOUND')
    }

    const subject = body.subject || 'General Knowledge'
    const topic = body.topic || ''
    const gradeLevel = body.gradeLevel || '9'
    const difficulty = (body.difficulty || 'MEDIUM').toUpperCase()
    const count = body.count ?? 5
    const questionType = (body.type || 'MCQ').toUpperCase()

    const systemPrompt = `You are an expert examination question setter for schools. You create high-quality, pedagogically sound ${questionType} questions for grade ${gradeLevel} students. Your questions must be accurate, age-appropriate, and follow standard curriculum guidelines. Always respond with ONLY valid JSON — no markdown, no explanation, no code fences.`

    const userPrompt = `Generate ${count} ${difficulty.toLowerCase()} difficulty ${questionType} questions${topic ? ` on the topic "${topic}"` : ''} for the subject "${subject}" at grade ${gradeLevel} level.

Return a JSON array where each object has EXACTLY these fields:
{
  "question": "the question text (clear and complete, ending with ?)",
  "optionA": "first option text",
  "optionB": "second option text",
  "optionC": "third option text",
  "optionD": "fourth option text",
  "answer": "the letter of the correct option (A, B, C, or D)",
  "difficulty": "${difficulty}",
  "marks": ${difficulty === 'HARD' ? 5 : difficulty === 'MEDIUM' ? 3 : 2}
}

Requirements:
- Each question must have exactly 4 distinct options
- Only one option is correct
- Make distractors plausible but clearly wrong
- Questions should test understanding, not just memorization
- Vary question styles (conceptual, numerical, application-based)
- Return ONLY the JSON array, nothing else`

    let parsed: GeneratedQuestion[] = []
    let usedFallback = false
    let raw = ''

    try {
      const ai = await getAIClient()
      if (ai) {
        const completion = await ai.chat.completions.create({
          messages: [
            { role: 'assistant', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          thinking: { type: 'disabled' },
        })

        raw = completion.choices[0]?.message?.content || '[]'

        // Parse the JSON response — handle markdown code fences if present
        let cleaned = raw.trim()
        if (cleaned.startsWith('```')) {
          cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
        }
        // Extract the first JSON array found
        const arrMatch = cleaned.match(/\[[\s\S]*\]/)
        if (arrMatch) cleaned = arrMatch[0]

        try {
          parsed = JSON.parse(cleaned)
        } catch {
          usedFallback = true
          parsed = generateTemplateQuestions(subject, topic, gradeLevel, difficulty, count)
        }
      } else {
        usedFallback = true
        parsed = generateTemplateQuestions(subject, topic, gradeLevel, difficulty, count)
      }
    } catch {
      // SDK request failed — use template fallback
      usedFallback = true
      parsed = generateTemplateQuestions(subject, topic, gradeLevel, difficulty, count)
    }

    if (!Array.isArray(parsed) || parsed.length === 0) {
      return {
        ok: false,
        generated: [],
        raw,
        error: 'AI returned no valid questions. Please try again with different parameters.',
      }
    }

    // Validate and clean each question
    const valid = parsed.filter(
      (q) =>
        q.question &&
        q.optionA &&
        q.optionB &&
        q.optionC &&
        q.optionD &&
        ['A', 'B', 'C', 'D'].includes(q.answer)
    )

    if (valid.length === 0) {
      return {
        ok: false,
        generated: [],
        raw,
        error: 'AI returned questions but none were valid. Please try again.',
      }
    }

    // Optionally save to question bank if autoSave is true
    const saved: string[] = []
    if (body.autoSave && body.subjectId) {
      for (const q of valid) {
        const created = await (db as any).questionBank.create({
          data: {
            schoolId: ctx.schoolId,
            subjectId: body.subjectId,
            classId: body.classId || null,
            question: q.question,
            optionA: q.optionA,
            optionB: q.optionB,
            optionC: q.optionC,
            optionD: q.optionD,
            answer: q.answer,
            type: questionType,
            difficulty: q.difficulty || difficulty,
            marks: q.marks || (difficulty === 'HARD' ? 5 : difficulty === 'MEDIUM' ? 3 : 2),
          },
        })
        saved.push(created.id)
      }
    }

    return {
      ok: true,
      generated: valid,
      savedIds: saved,
      savedCount: saved.length,
      usedFallback,
    }
  })
}

/* ------------------------------------------------------------------ */
/* Template-based fallback question generator                          */
/* Used when the AI SDK is unavailable or returns unparseable output.  */
/* Generates subject-specific MCQ questions from curated templates.    */
/* ------------------------------------------------------------------ */

function generateTemplateQuestions(
  subject: string,
  topic: string,
  gradeLevel: string,
  difficulty: string,
  count: number
): GeneratedQuestion[] {
  const marks = difficulty === 'HARD' ? 5 : difficulty === 'MEDIUM' ? 3 : 2
  const subjectLower = subject.toLowerCase()

  // Question pools by subject family
  const pools: Record<string, GeneratedQuestion[]> = {
    math: [
      { question: 'What is the value of x in the equation 3x + 7 = 22?', optionA: 'x = 3', optionB: 'x = 5', optionC: 'x = 7', optionD: 'x = 15', answer: 'B', difficulty, marks },
      { question: 'The area of a rectangle with length 12 cm and width 8 cm is?', optionA: '96 cm²', optionB: '40 cm²', optionC: '20 cm²', optionD: '84 cm²', answer: 'A', difficulty, marks },
      { question: 'What is 15% of 240?', optionA: '24', optionB: '30', optionC: '36', optionD: '40', answer: 'C', difficulty, marks },
      { question: 'The square root of 196 is?', optionA: '12', optionB: '13', optionC: '14', optionD: '15', answer: 'C', difficulty, marks },
      { question: 'If a triangle has angles 60°, 60°, and 60°, it is called?', optionA: 'Right triangle', optionB: 'Isosceles triangle', optionC: 'Equilateral triangle', optionD: 'Scalene triangle', answer: 'C', difficulty, marks },
      { question: 'What is the LCM of 8 and 12?', optionA: '16', optionB: '24', optionC: '32', optionD: '48', answer: 'B', difficulty, marks },
      { question: 'The value of 2⁵ is?', optionA: '10', optionB: '25', optionC: '32', optionD: '64', answer: 'C', difficulty, marks },
      { question: 'If the radius of a circle is 7 cm, its circumference is (π = 22/7)?', optionA: '22 cm', optionB: '44 cm', optionC: '154 cm', optionD: '88 cm', answer: 'B', difficulty, marks },
      { question: 'What is the HCF of 24 and 36?', optionA: '6', optionB: '8', optionC: '12', optionD: '18', answer: 'C', difficulty, marks },
      { question: 'The sum of all angles in a quadrilateral is?', optionA: '180°', optionB: '270°', optionC: '360°', optionD: '540°', answer: 'C', difficulty, marks },
      { question: 'What is 7 × 8 + 4 ÷ 2?', optionA: '56', optionB: '58', optionC: '30', optionD: '60', answer: 'B', difficulty, marks },
      { question: 'A number divisible by both 2 and 3 is also divisible by?', optionA: '4', optionB: '5', optionC: '6', optionD: '8', answer: 'C', difficulty, marks },
    ],
    physics: [
      { question: 'The SI unit of force is?', optionA: 'Joule', optionB: 'Watt', optionC: 'Newton', optionD: 'Pascal', answer: 'C', difficulty, marks },
      { question: 'The speed of light in vacuum is approximately?', optionA: '3 × 10⁵ m/s', optionB: '3 × 10⁶ m/s', optionC: '3 × 10⁷ m/s', optionD: '3 × 10⁸ m/s', answer: 'D', difficulty, marks },
      { question: "Newton's first law of motion is also known as the law of?", optionA: 'Gravitation', optionB: 'Inertia', optionC: 'Acceleration', optionD: 'Action-Reaction', answer: 'B', difficulty, marks },
      { question: 'The unit of electric current is?', optionA: 'Volt', optionB: 'Ohm', optionC: 'Ampere', optionD: 'Watt', answer: 'C', difficulty, marks },
      { question: 'Which of the following is a vector quantity?', optionA: 'Speed', optionB: 'Mass', optionC: 'Temperature', optionD: 'Velocity', answer: 'D', difficulty, marks },
      { question: 'The energy possessed by a body due to its motion is called?', optionA: 'Potential energy', optionB: 'Kinetic energy', optionC: 'Chemical energy', optionD: 'Thermal energy', answer: 'B', difficulty, marks },
      { question: 'The frequency unit is?', optionA: 'Newton', optionB: 'Hertz', optionC: 'Joule', optionD: 'Pascal', answer: 'B', difficulty, marks },
      { question: 'A body in equilibrium has net force equal to?', optionA: 'Maximum', optionB: 'Zero', optionC: 'Infinite', optionD: 'Negative', answer: 'B', difficulty, marks },
      { question: 'Sound cannot travel through?', optionA: 'Solid', optionB: 'Liquid', optionC: 'Gas', optionD: 'Vacuum', answer: 'D', difficulty, marks },
      { question: 'The acceleration due to gravity on Earth is approximately?', optionA: '8.9 m/s²', optionB: '9.8 m/s²', optionC: '10.8 m/s²', optionD: '11.2 m/s²', answer: 'B', difficulty, marks },
    ],
    chemistry: [
      { question: 'The chemical symbol for Gold is?', optionA: 'Go', optionB: 'Gd', optionC: 'Au', optionD: 'Ag', answer: 'C', difficulty, marks },
      { question: 'What is the pH value of a neutral solution?', optionA: '0', optionB: '7', optionC: '14', optionD: '1', answer: 'B', difficulty, marks },
      { question: 'The most abundant gas in the Earth\'s atmosphere is?', optionA: 'Oxygen', optionB: 'Carbon dioxide', optionC: 'Nitrogen', optionD: 'Hydrogen', answer: 'C', difficulty, marks },
      { question: 'How many electrons does a neutral oxygen atom have?', optionA: '6', optionB: '7', optionC: '8', optionD: '16', answer: 'C', difficulty, marks },
      { question: 'The chemical formula for water is?', optionA: 'CO₂', optionB: 'H₂O', optionC: 'O₂', optionD: 'H₂SO₄', answer: 'B', difficulty, marks },
      { question: 'Which is the lightest element?', optionA: 'Helium', optionB: 'Hydrogen', optionC: 'Lithium', optionD: 'Carbon', answer: 'B', difficulty, marks },
      { question: 'NaCl is commonly known as?', optionA: 'Baking soda', optionB: 'Table salt', optionC: 'Sugar', optionD: 'Chalk', answer: 'B', difficulty, marks },
      { question: 'The process of a solid turning directly into gas is called?', optionA: 'Evaporation', optionB: 'Condensation', optionC: 'Sublimation', optionD: 'Melting', answer: 'C', difficulty, marks },
    ],
    biology: [
      { question: 'The powerhouse of the cell is?', optionA: 'Nucleus', optionB: 'Ribosome', optionC: 'Mitochondria', optionD: 'Chloroplast', answer: 'C', difficulty, marks },
      { question: 'Which organ pumps blood in the human body?', optionA: 'Liver', optionB: 'Lungs', optionC: 'Heart', optionD: 'Kidney', answer: 'C', difficulty, marks },
      { question: 'Photosynthesis occurs in which part of the plant?', optionA: 'Roots', optionB: 'Stem', optionC: 'Leaves', optionD: 'Flowers', answer: 'C', difficulty, marks },
      { question: 'The basic unit of life is?', optionA: 'Tissue', optionB: 'Organ', optionC: 'Cell', optionD: 'Organism', answer: 'C', difficulty, marks },
      { question: 'Which vitamin is produced when skin is exposed to sunlight?', optionA: 'Vitamin A', optionB: 'Vitamin B', optionC: 'Vitamin C', optionD: 'Vitamin D', answer: 'D', difficulty, marks },
      { question: 'The number of chambers in a human heart is?', optionA: '2', optionB: '3', optionC: '4', optionD: '5', answer: 'C', difficulty, marks },
      { question: 'Plants release which gas during photosynthesis?', optionA: 'Carbon dioxide', optionB: 'Oxygen', optionC: 'Nitrogen', optionD: 'Hydrogen', answer: 'B', difficulty, marks },
      { question: 'DNA stands for?', optionA: 'Deoxyribonucleic Acid', optionB: 'Diribonucleic Acid', optionC: 'Deoxyribose Nuclear Acid', optionD: 'Dinucleic Acid', answer: 'A', difficulty, marks },
    ],
    english: [
      { question: 'Choose the correct synonym of "Diligent":', optionA: 'Lazy', optionB: 'Hardworking', optionC: 'Careless', optionD: 'Slow', answer: 'B', difficulty, marks },
      { question: 'What is the past tense of "Begin"?', optionA: 'Begun', optionB: 'Began', optionC: 'Begined', optionD: 'Beginning', answer: 'B', difficulty, marks },
      { question: 'Identify the noun: "The cat sat on the mat."', optionA: 'sat', optionB: 'on', optionC: 'cat', optionD: 'the', answer: 'C', difficulty, marks },
      { question: 'The plural of "Mouse" is?', optionA: 'Mouses', optionB: 'Mice', optionC: 'Mouse', optionD: 'Mices', answer: 'B', difficulty, marks },
      { question: 'Which is a preposition?', optionA: 'quickly', optionB: 'under', optionC: 'beautiful', optionD: 'run', answer: 'B', difficulty, marks },
      { question: 'The antonym of "Generous" is?', optionA: 'Kind', optionB: 'Stingy', optionC: 'Friendly', optionD: 'Gentle', answer: 'B', difficulty, marks },
      { question: '"Break a leg" is an example of?', optionA: 'Simile', optionB: 'Metaphor', optionC: 'Idiom', optionD: 'Alliteration', answer: 'C', difficulty, marks },
      { question: 'Which sentence is in passive voice?', optionA: 'She wrote a letter.', optionB: 'A letter was written by her.', optionC: 'She is writing a letter.', optionD: 'She will write a letter.', answer: 'B', difficulty, marks },
    ],
    science: [
      { question: 'Which planet is known as the Red Planet?', optionA: 'Venus', optionB: 'Mars', optionC: 'Jupiter', optionD: 'Saturn', answer: 'B', difficulty, marks },
      { question: 'The nearest star to Earth is?', optionA: 'Moon', optionB: 'Polaris', optionC: 'Sun', optionD: 'Sirius', answer: 'C', difficulty, marks },
      { question: 'How many bones are in the adult human body?', optionA: '196', optionB: '206', optionC: '216', optionD: '226', answer: 'B', difficulty, marks },
      { question: 'The largest planet in our solar system is?', optionA: 'Earth', optionB: 'Mars', optionC: 'Jupiter', optionD: 'Saturn', answer: 'C', difficulty, marks },
      { question: 'Water boils at what temperature at sea level?', optionA: '50°C', optionB: '75°C', optionC: '100°C', optionD: '120°C', answer: 'C', difficulty, marks },
      { question: 'Which gas do plants absorb from the atmosphere?', optionA: 'Oxygen', optionB: 'Nitrogen', optionC: 'Carbon dioxide', optionD: 'Hydrogen', answer: 'C', difficulty, marks },
      { question: 'The center of an atom is called?', optionA: 'Electron', optionB: 'Nucleus', optionC: 'Shell', optionD: 'Orbit', answer: 'B', difficulty, marks },
      { question: 'Which is a renewable source of energy?', optionA: 'Coal', optionB: 'Petroleum', optionC: 'Solar', optionD: 'Natural gas', answer: 'C', difficulty, marks },
    ],
    general: [
      { question: 'What is the capital of India?', optionA: 'Mumbai', optionB: 'Kolkata', optionC: 'New Delhi', optionD: 'Chennai', answer: 'C', difficulty, marks },
      { question: 'How many continents are there on Earth?', optionA: '5', optionB: '6', optionC: '7', optionD: '8', answer: 'C', difficulty, marks },
      { question: 'Which is the largest ocean on Earth?', optionA: 'Atlantic', optionB: 'Indian', optionC: 'Arctic', optionD: 'Pacific', answer: 'D', difficulty, marks },
      { question: 'The Great Wall is located in which country?', optionA: 'Japan', optionB: 'India', optionC: 'China', optionD: 'Korea', answer: 'C', difficulty, marks },
      { question: 'How many colors are in a rainbow?', optionA: '5', optionB: '6', optionC: '7', optionD: '8', answer: 'C', difficulty, marks },
      { question: 'Which is the tallest mountain in the world?', optionA: 'K2', optionB: 'Kangchenjunga', optionC: 'Mount Everest', optionD: 'Makalu', answer: 'C', difficulty, marks },
      { question: 'The currency of Japan is?', optionA: 'Won', optionB: 'Yuan', optionC: 'Yen', optionD: 'Ringgit', answer: 'C', difficulty, marks },
      { question: 'How many sides does a hexagon have?', optionA: '4', optionB: '5', optionC: '6', optionD: '7', answer: 'C', difficulty, marks },
    ],
  }

  // Pick the right pool
  let pool: GeneratedQuestion[]
  if (subjectLower.includes('math')) pool = pools.math
  else if (subjectLower.includes('physic')) pool = pools.physics
  else if (subjectLower.includes('chem')) pool = pools.chemistry
  else if (subjectLower.includes('bio')) pool = pools.biology
  else if (subjectLower.includes('english') || subjectLower.includes('lang')) pool = pools.english
  else if (subjectLower.includes('science') || subjectLower.includes('sci')) pool = pools.science
  else pool = pools.general

  // Shuffle and take `count` items
  const shuffled = [...pool].sort(() => Math.random() - 0.5)
  const selected = shuffled.slice(0, Math.min(count, shuffled.length))

  // If we need more than the pool has, cycle with slight variations
  while (selected.length < count) {
    const base = shuffled[selected.length % shuffled.length]
    selected.push({ ...base, question: base.question })
  }

  return selected
}
