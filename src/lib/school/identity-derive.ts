/**
 * identity-derive — shared, PURE school-identity derivations for the
 * Add-School wizard (7-step onboarding).
 *
 * Used by BOTH the wizard (client-side live previews as the operator
 * types) and the provisioning API (server-side authority at creation),
 * plus focused unit tests. Every rule here has ONE implementation — the
 * server never trusts a client-derived value, it re-derives/re-validates;
 * the client uses the same functions so the preview and the persisted
 * result agree.
 *
 * Derivation rules (mission §2 STEP 1):
 *   · shortName  — first two significant words of the official name
 *                  ("Green Valley Public School" → "Green Valley").
 *                  Operator-editable; only the DEFAULT is derived.
 *   · recordPrefix abbrev — uppercase initials of the first five
 *                  alphanumeric words ("Green Valley Public School" →
 *                  "GVPS"); when that is shorter than 2 chars, the first
 *                  4 letters of the first word ("Hawkings" → "HAWK");
 *                  when the name has no alphanumeric word, "SCH"; padded
 *                  with 'X' only when still shorter than 2 chars. The
 *                  final "<ABBR>-<0001>" number is allocated SERVER-SIDE
 *                  (advisory-locked, unique-indexed — see
 *                  src/lib/platform/school-prefix.ts), never client-side.
 *   · slug       — full-name URL slugification ("Green Valley Public
 *                  School" → "green-valley-public-school"), operator-
 *                  editable, uniqueness checked server-side with
 *                  collision suggestions.
 */
// (Part of the 2026-10-20 add-school wizard work; pure module, no I/O.)

/** Words with at least one alphanumeric character, uppercase-cased. */
export function significantUpperWords(name: string): string[] {
  return name
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter(Boolean)
}

/**
 * Abbreviation for the internal record prefix ("Green Valley Public
 * School" → "GVPS"). Mirrored EXACTLY by the SQL backfill in
 * prisma/migrations/…__school_record_prefix_billing_terms (keep both in
 * sync — allocation and backfill share one per-abbrev sequence space).
 */
export function schoolPrefixAbbreviation(name: string): string {
  const words = significantUpperWords(name)
  const abbr = words
    .slice(0, 5)
    .map((w) => w[0])
    .join('')
  if (abbr.length >= 2) return abbr
  // Fallback: the first word's opening letters; a word-less name gets SCH.
  const fallback = (words[0] ?? 'SCH').slice(0, 4)
  return (fallback.length < 2 ? fallback.padEnd(2, 'X') : fallback)
}

/**
 * Default short display name — first two significant words, capped at
 * the School.shortName column bound (40). Single-word names stay whole.
 * ("Green Valley Public School" → "Green Valley")
 */
export function deriveShortName(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return ''
  const short = words.length === 1 ? words[0] : `${words[0]} ${words[1]}`
  return short.slice(0, 40)
}

/**
 * URL-safe slug from the full school name: lowercase, alphanumerics
 * collapsed onto single hyphens, hyphen-trimmed, capped at the API bound
 * (60). Falls back to '' when the name has nothing slugifiable.
 */
export function slugifyName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '')
  return slug
}

/**
 * Deterministic slug alternatives on collision (e.g. "green-valley" →
 * "green-valley-2", "green-valley-3", …). Bounded; availability is
 * decided by the SERVER precheck — this only proposes candidates.
 */
export function suggestSlugAlternatives(base: string, count = 3): string[] {
  const clean = base.replace(/-+$/g, '')
  const out: string[] = []
  for (let n = 2; out.length < count && n < 2 + 50; n += 1) {
    const candidate = `${clean}-${n}`
    if (candidate.length <= 60) out.push(candidate)
  }
  return out
}

/**
 * Default academic session label for an Indian school year (April→March):
 * in April or later, "<Y>-<Y+1>"; January–March, "<Y-1>-<Y>".
 * Timezone-aware via Intl (defaults to Asia/Kolkata).
 */
export function defaultAcademicSession(now: Date, timeZone = 'Asia/Kolkata'): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(now)
  const year = Number(parts.find((p) => p.type === 'year')?.value ?? new Date().getFullYear())
  const month = Number(parts.find((p) => p.type === 'month')?.value ?? 1)
  return month >= 4 ? `${year}-${year + 1}` : `${year - 1}-${year}`
}

/**
 * Billing-frequency options per billing model (mission §2 STEP 3):
 * School-based → monthly + yearly; Student-based → YEARLY ONLY.
 * Both the wizard's dynamic selector and the API's cross-field
 * validation follow this one rule — student-based monthly is never
 * offered and always rejected server-side.
 */
export const BILLING_MODEL_OPTIONS = [
  { value: 'SCHOOL_WIDE', label: 'School-based', description: 'One subscription covers the whole school' },
  { value: 'PER_STUDENT', label: 'Student-based', description: 'Licensed per student, billed yearly' },
] as const

export function frequencyOptionsFor(billingModel: string): Array<{ value: 'MONTHLY' | 'ANNUAL'; label: string }> {
  if (billingModel === 'PER_STUDENT') {
    return [{ value: 'ANNUAL', label: 'Yearly (annual per-student)' }]
  }
  return [
    { value: 'MONTHLY', label: 'Monthly' },
    { value: 'ANNUAL', label: 'Yearly' },
  ]
}

export const SUPPORTED_CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AED'] as const
