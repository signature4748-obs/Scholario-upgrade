import type { Prisma } from '@prisma/client'
import { AppError } from '@/lib/security/errors'

/**
 * sequence — per-school admission-number allocation (FEE-ADMISSIONS MVP,
 * H1-R2 §4). Phase D core.
 *
 *   · Default mint format "ADM-NNNNNN" (^ADM-[0-9]{6}$), strict maximum
 *     sequence value 999999 — enforced by the ALLOCATOR and by the DB
 *     CHECK (AdmissionSequence_range). Exhaustion → 409
 *     ADMISSION_SEQUENCE_EXHAUSTED. Never overflow, never truncate.
 *   · Allocation is atomic under concurrency: an in-transaction
 *     UPDATE … RETURNING takes the row lock, so concurrent enrolments
 *     serialize; every value is handed out at most once. The increment
 *     lives INSIDE the enrolment transaction — a rollback frees the
 *     number (uniqueness is guaranteed at every instant; gaplessness is
 *     NOT promised).
 *   · Initialization is inventory-driven and pattern-scoped: the seed
 *     is max+1 of the school's EXISTING Student.admissionNos that
 *     EXACTLY match ^ADM-[0-9]{6}$ (else 0). Arbitrary legacy formats
 *     are NEVER parsed — they are handled by the collision check.
 *   · Every allocated candidate is collision-checked against ALL
 *     existing admissionNos (any format) with a bounded K=8 skip loop;
 *     still colliding → 409 ADMISSION_NUMBER_COLLISION (the whole
 *     enrolment rolls back; one whole-request retry is the documented
 *     recovery). The (schoolId, admissionNo) unique index is the final
 *     DB backstop.
 */

export const ADMISSION_NO_PATTERN = /^ADM-[0-9]{6}$/
export const ADMISSION_MAX_SEQUENCE = 999999
/** Bounded collision-skip attempts before failing the request. */
const MAX_SKIP_ATTEMPTS = 8

type Tx = Prisma.TransactionClient

/** Format a sequence value in the default mint format. */
export function formatAdmissionNo(value: number): string {
  return `ADM-${String(value).padStart(6, '0')}`
}

/**
 * Allocate the next admission number for a school. MUST be called
 * inside the enrolment transaction (the increment commits or rolls back
 * with it).
 */
export async function allocateAdmissionNumber(tx: Tx, schoolId: string): Promise<string> {
  // ── 1. Inventory-driven initialization (first allocation only) ─────
  const seedResult = await tx.$queryRaw<{ max: number | null }[]>`
    SELECT max((substring("admissionNo" from 5))::int) AS max
    FROM "Student"
    WHERE "schoolId" = ${schoolId} AND "admissionNo" ~ '^ADM-[0-9]{6}$'
  `
  const seed = seedResult[0]?.max !== null && seedResult[0]?.max !== undefined ? seedResult[0].max + 1 : 0
  if (seed > ADMISSION_MAX_SEQUENCE) {
    // The school already used the entire ADM-NNNNNN range.
    throw new AppError('ADMISSION_SEQUENCE_EXHAUSTED', {
      internalDetail: `allocateAdmissionNumber: inventory seed ${seed} already above max`,
    })
  }
  await tx.$executeRaw`
    INSERT INTO "AdmissionSequence" ("schoolId", "currentValue", "format", "maxValue", "createdAt", "updatedAt")
    VALUES (${schoolId}, ${seed}, 'ADM-NNNNNN', ${ADMISSION_MAX_SEQUENCE}, now(), now())
    ON CONFLICT ("schoolId") DO NOTHING
  `

  // ── 2. Atomic allocation with a bounded collision-skip loop ────────
  let lastValue = 0
  for (let attempt = 0; attempt <= MAX_SKIP_ATTEMPTS; attempt++) {
    // The UPDATE row-lock serializes concurrent allocations; the WHERE
    // clause enforces the strict ceiling (no row → exhausted).
    const updated = await tx.$queryRaw<{ currentValue: number }[]>`
      UPDATE "AdmissionSequence"
      SET "currentValue" = "currentValue" + 1, "updatedAt" = now()
      WHERE "schoolId" = ${schoolId} AND "currentValue" < "maxValue"
      RETURNING "currentValue"
    `
    if (updated.length === 0) {
      throw new AppError('ADMISSION_SEQUENCE_EXHAUSTED', {
        internalDetail: `allocateAdmissionNumber: sequence at max for school ${schoolId.slice(0, 8)}…`,
      })
    }
    lastValue = updated[0].currentValue
    const candidate = formatAdmissionNo(lastValue)

    // Collision check against ALL existing admissionNos (any format —
    // legacy unparsed numbers included).
    const collision = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "Student"
      WHERE "schoolId" = ${schoolId} AND "admissionNo" = ${candidate}
      LIMIT 1
    `
    if (collision.length === 0) {
      return candidate
    }
    // Bounded skip: the next loop iteration allocates value+1.
  }
  throw new AppError('ADMISSION_NUMBER_COLLISION', {
    internalDetail: `allocateAdmissionNumber: ${MAX_SKIP_ATTEMPTS} consecutive collisions (last value ${lastValue})`,
  })
}
