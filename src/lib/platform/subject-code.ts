/**
 * PHASE 2 — shared subject-code derivation for school academic
 * bootstrap. Extracted from the provisioning route so the setup
 * wizard's academic-bootstrap route generates IDENTICAL codes (one
 * vocabulary, zero drift): uppercase alnum ≤ 12 chars, numeric suffix on
 * in-batch collisions. Never empty.
 */
export function subjectCodeOf(name: string, used: Set<string>): string {
  const base =
    name
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '')
      .slice(0, 12) || 'SUB'
  let code = base
  let n = 2
  while (used.has(code)) {
    code = `${base.slice(0, 10)}${n}`
    n += 1
  }
  used.add(code)
  return code
}
