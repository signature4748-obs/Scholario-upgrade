import { db } from '@/lib/db'
import type { School } from '@prisma/client'
import { effectiveModuleFlags } from '@/lib/platform/module-flags'

/**
 * school-config — SERVER-side canonical school configuration.
 *
 * The School row is the single source of truth for school identity,
 * branding, and the `settings` JSON (config slices beyond the columns).
 * This module is the ONE server reader/writer with validation:
 *
 *   · getSchoolConfig(schoolId) → typed identity + branding + settings
 *   · identityPatchFrom(body)   → validated School-column patch
 *   · brandingPatchFrom(body)   → validated branding patch (hex, contrast)
 *   · settingsPatchFrom(body)   → validated settings-JSON fragment
 *
 * Never trusts client school ids — every caller resolves the tenant from
 * the session (schoolScoped) and passes the id here.
 */

export interface SchoolIdentityDTO {
  name: string
  shortName: string | null
  tagline: string | null
  affiliation: string | null
  address: string | null
  city: string | null
  phone: string | null
  email: string | null
  website: string | null
  principalName: string | null
  established: string | null
  code: string
  board: string
  academicYear: string | null
}

export interface SchoolBrandingDTO {
  primaryColor: string
  accentColor: string
  logoUrl: string | null
  faviconUrl: string | null
}

export interface SchoolConfigDTO {
  identity: SchoolIdentityDTO
  branding: SchoolBrandingDTO
  settings: Record<string, unknown>
  /** Effective module availability (server flags ?? platform defaults). */
  moduleFlags: Record<string, boolean>
}

function identityOf(s: School): SchoolIdentityDTO {
  return {
    name: s.name,
    shortName: s.shortName,
    tagline: s.tagline,
    affiliation: s.affiliation,
    address: s.address,
    city: s.city,
    phone: s.phone,
    email: s.email,
    website: s.website,
    principalName: s.principalName,
    established: s.established,
    code: s.code,
    board: s.board,
    academicYear: s.academicYear,
  }
}

function brandingOf(s: School): SchoolBrandingDTO {
  return {
    primaryColor: s.themeColor,
    accentColor: s.accentColor,
    logoUrl: s.logoUrl,
    faviconUrl: s.faviconUrl,
  }
}

function parseSettings(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw || '{}')
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    // fall through — malformed settings degrade to empty
  }
  return {}
}

export async function getSchoolConfig(schoolId: string): Promise<SchoolConfigDTO | null> {
  const s = await db.school.findUnique({ where: { id: schoolId } })
  if (!s) return null
  const moduleFlags = await effectiveModuleFlags(schoolId)
  return {
    identity: identityOf(s),
    branding: brandingOf(s),
    settings: parseSettings(s.settings),
    moduleFlags,
  }
}

/* ────────────────────────── validation ────────────────────────── */

const MAX_TEXT = 160
const MAX_LONG_TEXT = 400

function cleanText(v: unknown, max = MAX_TEXT): string | null {
  if (v === null || v === undefined) return null
  if (typeof v !== 'string') return null
  const t = v.trim().slice(0, max)
  return t.length ? t : null
}

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

export function isValidHexColor(v: unknown): v is string {
  return typeof v === 'string' && HEX_COLOR.test(v.trim())
}

/** Relative luminance (WCAG 2.x sRGB). */
function luminance(hex: string): number {
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

const WHITE = '#ffffff'

/**
 * Contrast-safe branding check: the school's chosen primary color must
 * stay readable on white (light surfaces) — ≥ 3.5:1 (WCAG AA for large
 * text/UI, applied with margin). When it fails, callers must reject the
 * choice with an actionable message (never silently render illegible
 * branding).
 */
export function brandingContrastIssue(primaryHex: string): string | null {
  if (!isValidHexColor(primaryHex)) return 'Primary color must be a hex value like #0f766e'
  const onWhite = contrastRatio(primaryHex, WHITE)
  if (onWhite < 3.5) {
    return 'Primary color is too light for text on white surfaces — choose a deeper shade (contrast ' +
      `${onWhite.toFixed(1)}:1 < 3.5:1).`
  }
  return null
}

/**
 * Validated identity patch (School columns). Only known keys pass.
 *
 * SaaS-HARDENING (§8 — protect school identity): the LEGAL school
 * identity (name, code, affiliation) is PLATFORM-CONTROLLED — a
 * principal cannot mutate it directly. Attempts to patch these keys
 * fail loudly with the change-request workflow pointer (no silent
 * drop). shortName/tagline/address/city/phone/email/website/
 * principalName/established remain school-controlled presentation.
 */
export function identityPatchFrom(body: Record<string, unknown>): Partial<School> {
  // Platform-controlled identity keys — request workflow only.
  const PROTECTED_KEYS = ['name', 'code', 'affiliation'] as const
  for (const key of PROTECTED_KEYS) {
    if (key in body) {
      throw new Error(
        `The school ${key === 'affiliation' ? 'affiliation' : key} is platform-controlled. ` +
          'Request a change through School Settings → School → "Request identity change" ' +
          '(a platform admin reviews and applies it).',
      )
    }
  }
  const patch: Record<string, string | null> = {}
  const textKeys: Array<[string, number]> = [
    ['shortName', 40],
    ['tagline', MAX_LONG_TEXT],
    ['address', MAX_LONG_TEXT],
    ['city', 80],
    ['phone', 40],
    ['email', 120],
    ['website', 200],
    ['principalName', 120],
    ['established', 20],
  ]
  for (const [key, max] of textKeys) {
    if (key in body) {
      const v = cleanText(body[key], max)
      patch[key] = v
    }
  }
  return patch as Partial<School>
}

/** Validated branding patch (School columns). */
export function brandingPatchFrom(body: Record<string, unknown>): Partial<School> {
  const patch: Record<string, string | null> = {}
  if ('primaryColor' in body) {
    const hex = typeof body.primaryColor === 'string' ? body.primaryColor.trim() : ''
    if (body.primaryColor !== null && !isValidHexColor(hex)) {
      throw new Error('Primary color must be a hex value like #0f766e')
    }
    if (body.primaryColor !== null) {
      const issue = brandingContrastIssue(hex)
      if (issue) throw new Error(issue)
    }
    patch.themeColor = body.primaryColor === null ? '#0f766e' : hex
  }
  if ('accentColor' in body) {
    const hex = typeof body.accentColor === 'string' ? body.accentColor.trim() : ''
    if (body.accentColor !== null && !isValidHexColor(hex)) {
      throw new Error('Accent color must be a hex value like #f59e0b')
    }
    patch.accentColor = body.accentColor === null ? '#f59e0b' : hex
  }
  if ('logoUrl' in body) {
    // logoUrl is a website-scope uploaded fileId (served through the
    // public media route) or null — never an arbitrary client URL.
    const v = cleanText(body.logoUrl, 120)
    patch.logoUrl = v
  }
  if ('faviconUrl' in body) {
    const v = cleanText(body.faviconUrl, 120)
    patch.faviconUrl = v
  }
  return patch as Partial<School>
}

/**
 * Validated settings-JSON fragment (deep-merged server-side into the
 * stored document). Bounded: max 30 keys, 16 KB serialized, values must
 * be JSON primitives/arrays/objects (no undefined tricks) — the merge is
 * shallow at the top level, deep one level (slice → object merge).
 *
 * Phase 8A — money-bearing JSON paths (feeHeads[].defaultAmount,
 * examFeeConfig.{unitTestFee,termExamFee,customGroupsFee},
 * booksMaster[].price, discountRules[].value) get bounded numeric
 * validation (0..500000). Additive: only these known money fields are
 * checked; every finite number in range keeps passing untouched.
 */
const SETTINGS_MONEY_MIN = 0
const SETTINGS_MONEY_MAX = 500000

function assertSettingsMoney(scope: string, v: unknown): void {
  if (v === undefined || v === null) return // field absent in this fragment
  if (typeof v !== 'number' || !Number.isFinite(v) || v < SETTINGS_MONEY_MIN || v > SETTINGS_MONEY_MAX) {
    throw new Error(`${scope} must be a number between ${SETTINGS_MONEY_MIN} and ${SETTINGS_MONEY_MAX}`)
  }
}

function validateSettingsMoney(key: string, value: unknown): void {
  if (key === 'feeHeads' && Array.isArray(value)) {
    value.forEach((h, i) => {
      if (h && typeof h === 'object' && !Array.isArray(h)) {
        assertSettingsMoney(`settings.feeHeads[${i}].defaultAmount`, (h as Record<string, unknown>).defaultAmount)
      }
    })
  } else if (key === 'booksMaster' && Array.isArray(value)) {
    value.forEach((b, i) => {
      if (b && typeof b === 'object' && !Array.isArray(b)) {
        assertSettingsMoney(`settings.booksMaster[${i}].price`, (b as Record<string, unknown>).price)
      }
    })
  } else if (key === 'discountRules' && Array.isArray(value)) {
    value.forEach((r, i) => {
      if (r && typeof r === 'object' && !Array.isArray(r)) {
        assertSettingsMoney(`settings.discountRules[${i}].value`, (r as Record<string, unknown>).value)
      }
    })
  } else if (key === 'examFeeConfig' && value && typeof value === 'object' && !Array.isArray(value)) {
    const cfg = value as Record<string, unknown>
    assertSettingsMoney('settings.examFeeConfig.unitTestFee', cfg.unitTestFee)
    assertSettingsMoney('settings.examFeeConfig.termExamFee', cfg.termExamFee)
    assertSettingsMoney('settings.examFeeConfig.customGroupsFee', cfg.customGroupsFee)
  }
}

export function settingsPatchFrom(body: Record<string, unknown>): Record<string, unknown> | null {
  const frag = body.settings
  if (frag === undefined || frag === null) return null
  if (typeof frag !== 'object' || Array.isArray(frag)) {
    throw new Error('settings must be an object of configuration slices')
  }
  const entries = Object.entries(frag as Record<string, unknown>).slice(0, 30)
  const cleaned: Record<string, unknown> = {}
  for (const [key, value] of entries) {
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/.test(key)) continue // skip junk keys
    const serialized = JSON.stringify(value)
    if (serialized.length > 16_000) {
      throw new Error(`settings.${key} is too large (max 16 KB per slice)`)
    }
    validateSettingsMoney(key, value)
    cleaned[key] = value
  }
  if (!Object.keys(cleaned).length) return null
  return cleaned
}

/** Deep-merge a validated fragment into the stored settings JSON. */
export function mergeSettings(current: string, fragment: Record<string, unknown>): string {
  const base = parseSettings(current)
  for (const [key, value] of Object.entries(fragment)) {
    if (
      value && typeof value === 'object' && !Array.isArray(value) &&
      base[key] && typeof base[key] === 'object' && !Array.isArray(base[key])
    ) {
      base[key] = { ...(base[key] as Record<string, unknown>), ...(value as Record<string, unknown>) }
    } else {
      base[key] = value
    }
  }
  return JSON.stringify(base)
}
