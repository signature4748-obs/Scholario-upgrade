import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withPlatform } from '@/lib/platform/authz'
import { parseQuery } from '@/lib/security/validation'
import {
  deriveShortName,
  schoolPrefixAbbreviation,
  slugifyName,
  suggestSlugAlternatives,
} from '@/lib/school/identity-derive'
import { z } from 'zod'

export const runtime = 'nodejs'

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const CODE_RE = /^[A-Z0-9-]+$/

const precheckQuery = z.object({
  name: z.string().max(80).optional(),
  slug: z.string().max(60).optional(),
  code: z.string().max(16).optional(),
})

/**
 * GET /api/platform/schools/precheck — the Add-School wizard's live,
 * SERVER-SIDE identity validation surface (mission §2 STEP 1).
 *
 * Permission: schools.provision (the exact audience that may create).
 * The wizard calls this debounced as the operator edits the name, slug
 * or code. It NEVER mutates anything — it reports availability and
 * suggestions derived from REAL rows:
 *
 *   · slug  — pattern validity + availability + free alternatives
 *             (green-valley → green-valley-2, …) when taken.
 *   · code  — pattern validity + availability (the external school code
 *             is optional; when omitted at creation the server assigns
 *             the internal record prefix as the code).
 *   · generated — the default short name + slug derived from the name
 *             (previews only; the same pure functions the API uses) and
 *             the record-prefix ABBREVIATION with the NEXT free number
 *             in its per-abbrev sequence. The final prefix is allocated
 *             advisory-locked at creation — under concurrency the number
 *             can shift, which is why the wizard words it as
 *             "next available", never a reservation.
 *
 * Uniqueness is ALWAYS re-enforced at POST time by database constraints;
 * this route is the operator's early, honest feedback channel.
 */
export async function GET(req: NextRequest) {
  return withPlatform({ permission: 'schools.provision' }, async () => {
    const q = parseQuery(req, precheckQuery)
    const name = q.name?.trim() ?? ''

    // ── Slug availability + alternatives ──────────────────────────────
    let slug: {
      value: string
      patternValid: boolean
      available: boolean | null
      suggestions: string[]
    } | null = null
    if (q.slug) {
      const slugValue = q.slug.trim().toLowerCase()
      const patternValid = slugValue.length >= 3 && slugValue.length <= 60 && SLUG_RE.test(slugValue)
      if (!patternValid) {
        slug = { value: slugValue, patternValid: false, available: null, suggestions: [] }
      } else {
        const taken = await db.school.findUnique({ where: { slug: slugValue }, select: { id: true } })
        const base = slugifyName(name) || slugValue
        const candidates = taken ? suggestSlugAlternatives(base) : []
        const free: string[] = []
        if (taken) {
          for (const candidate of candidates) {
            if (free.length >= 3) break
            const clash = await db.school.findUnique({ where: { slug: candidate }, select: { id: true } })
            if (!clash) free.push(candidate)
          }
        }
        slug = { value: slugValue, patternValid: true, available: !taken, suggestions: free }
      }
    }

    // ── External code availability ─────────────────────────────────────
    let code: { value: string; patternValid: boolean; available: boolean | null } | null = null
    if (q.code) {
      const codeValue = q.code.trim().toUpperCase()
      const patternValid = codeValue.length >= 2 && codeValue.length <= 16 && CODE_RE.test(codeValue)
      if (!patternValid) {
        code = { value: codeValue, patternValid: false, available: null }
      } else {
        const taken = await db.school.findUnique({ where: { code: codeValue }, select: { id: true } })
        code = { value: codeValue, patternValid: true, available: !taken }
      }
    }

    // ── Generated previews from the name (pure functions, mirrored at
    //    creation server-side) + the next free prefix number (read-only
    //    MAX — the authoritative allocation happens under the advisory
    //    lock inside the provision transaction). ──────────────────────
    let generated: {
      shortName: string | null
      slug: string | null
      prefixAbbreviation: string | null
      prefixNextNumber: number | null
    } = { shortName: null, slug: null, prefixAbbreviation: null, prefixNextNumber: null }
    if (name) {
      const abbr = schoolPrefixAbbreviation(name)
      const rows = await db.$queryRaw<Array<{ max: number | null }>>`
        SELECT MAX(CAST(SUBSTRING("recordPrefix" FROM '[0-9]+$') AS INTEGER)) AS max
        FROM "School"
        WHERE "recordPrefix" LIKE ${`${abbr}-%`} AND "recordPrefix" ~ ${`^${abbr}-[0-9]+$`}`
      generated = {
        shortName: deriveShortName(name),
        slug: slugifyName(name),
        prefixAbbreviation: abbr,
        prefixNextNumber: (rows[0]?.max ?? 0) + 1,
      }
    }

    return { slug, code, generated }
  })
}
