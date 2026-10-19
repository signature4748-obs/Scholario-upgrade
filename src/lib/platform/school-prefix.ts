/**
 * school-prefix — SERVER-SIDE allocation of the internal school record
 * prefix (e.g. "GVPS-0001"), mission §2 STEP 1-B.
 *
 * Concurrency-safety contract:
 *   · Allocation ALWAYS runs inside the provisioning transaction, holding
 *     a session-scoped advisory lock (pg_advisory_xact_lock) keyed to a
 *     single fixed constant — every provision serializes on it, so the
 *     read-then-write on the per-abbrev sequence can never interleave.
 *   · The UNIQUE index on School.recordPrefix is the database-enforced
 *     backstop: even a path that somehow bypassed the lock can never
 *     persist a duplicate (P2002 → the whole provision rolls back).
 *   · The abbreviation is derived from the requested name at creation
 *     time only; it is NEVER re-derived later — the prefix is immutable
 *     once written (no PATCH path ever touches recordPrefix).
 *   · Numbers are per-abbrev sequences (max existing + 1), zero-padded
 *     to 4 digits (longer numbers stay unpadded — still unique). A
 *     number reserved by a rolled-back transaction was never assigned:
 *     the next attempt legitimately reuses the slot because no school
 *     ever held it.
 *
 * The abbreviation rule mirrors the deterministic SQL backfill in
 * prisma/migrations/…__school_record_prefix_billing_terms exactly (see
 * schoolPrefixAbbreviation in src/lib/school/identity-derive.ts).
 */
import type { Prisma } from '@prisma/client'
import { schoolPrefixAbbreviation } from '@/lib/school/identity-derive'

/** Single fixed advisory key for the (short) prefix-allocation section
 * of every provision transaction. Arbitrary; must never change while
 * any provision transaction can be in flight. */
const RECORD_PREFIX_ADVISORY_KEY = 918273645

/**
 * Allocate the next free record prefix for a school of this name, inside
 * the caller's transaction. Returns e.g. "GVPS-0007".
 *
 * MUST be called before the School row is created in the same
 * transaction so the whole provision is atomic (an allocation that
 * rolls back never existed).
 */
export async function allocateRecordPrefix(
  tx: Prisma.TransactionClient,
  schoolName: string,
): Promise<string> {
  const abbr = schoolPrefixAbbreviation(schoolName)
  // Serialize every prefix allocation against concurrent provisions.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${RECORD_PREFIX_ADVISORY_KEY}::bigint)`
  // Next free number in THIS abbreviation's sequence (max + 1).
  const rows = await tx.$queryRaw<Array<{ max: number | null }>>`
    SELECT MAX(CAST(SUBSTRING("recordPrefix" FROM '[0-9]+$') AS INTEGER)) AS max
    FROM "School"
    WHERE "recordPrefix" LIKE ${`${abbr}-%`} AND "recordPrefix" ~ ${`^${abbr}-[0-9]+$`}`
  const next = (rows[0]?.max ?? 0) + 1
  return `${abbr}-${String(next).padStart(4, '0')}`
}
