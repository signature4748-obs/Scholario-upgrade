/**
 * branding-contrast — CLIENT-side replica of the server's branding
 * validation rule (src/lib/school-config.ts, mirrored here because that
 * module is server-only — it imports Prisma).
 *
 * Rule: the school's primary color must stay readable on WHITE surfaces —
 * WCAG relative-luminance contrast ≥ 3.5:1. The Branding tab runs this
 * BEFORE submit so the principal sees the same message the server would
 * return, without a round-trip.
 */

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

export function isValidHexColor(v: string): boolean {
  return typeof v === 'string' && HEX_COLOR.test(v.trim())
}

/** Relative luminance (WCAG 2.x sRGB). */
export function luminance(hex: string): number {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  const r = parseInt(full.slice(0, 2), 16) / 255
  const g = parseInt(full.slice(2, 4), 16) / 255
  const b = parseInt(full.slice(4, 6), 16) / 255
  const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

/** WCAG contrast ratio between two hex colors (1..21). */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a)
  const lb = luminance(b)
  const [hi, lo] = la > lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

/** Contrast of a candidate color against white (light surfaces). */
export function contrastOnWhite(hex: string): number {
  return contrastRatio(hex, '#ffffff')
}

/** Minimum ratio the server enforces for primaryColor. */
export const PRIMARY_CONTRAST_MIN = 3.5

/**
 * Same message contract as the server's brandingContrastIssue — returns
 * null when the choice passes, else the exact inline warning text.
 */
export function primaryContrastIssue(primaryHex: string): string | null {
  if (!isValidHexColor(primaryHex)) return 'Primary color must be a hex value like #0f766e'
  const onWhite = contrastOnWhite(primaryHex)
  if (onWhite < PRIMARY_CONTRAST_MIN) {
    return (
      'Primary color is too light for text on white surfaces — choose a deeper shade (contrast ' +
      `${onWhite.toFixed(1)}:1 < ${PRIMARY_CONTRAST_MIN}:1).`
    )
  }
  return null
}
