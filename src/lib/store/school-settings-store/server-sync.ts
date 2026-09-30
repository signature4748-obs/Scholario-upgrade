'use client'

/**
 * school-settings-store/server-sync — hydrates the settings store from the
 * canonical server configuration (PHASE 7.5: "Settings are real").
 *
 * Mirrors the teachers-store server-sync contract:
 *
 *   · ONE canonical configuration — GET /api/school-settings returns the
 *     School row (identity + branding) + the settings JSON + effective
 *     module flags. After a successful sync the store's `server` slice
 *     holds that snapshot verbatim (persisted as a cache), and the legacy
 *     local slices are REALIGNED to it so every existing consumer
 *     (documents, ID cards, attendance thresholds, library rules) renders
 *     the school's actual configuration — never the Greenwood seed.
 *   · Honest mapping — fields the server does not carry keep their local
 *     value; nothing is invented.
 *   · Failure keeps data — a failed fetch flags `server.syncStatus =
 *     'error'` so the settings tabs can offer an honest retry; existing
 *     data is never replaced by an error state.
 *   · Once per session — module-level promise guard (reset only via
 *     `resetSchoolSettingsSyncGuard`).
 *
 * `applySchoolConfig` is also used by the settings tabs after a successful
 * PATCH (the API returns the updated config) so a save immediately
 * re-syncs the local store from the server's authoritative value.
 */

import type {
  ServerSchoolIdentity,
  ServerSchoolBranding,
  SchoolSettingsState,
} from './types'
import { useSchoolSettingsStore } from './store'

export interface SchoolSettingsConfig {
  identity: ServerSchoolIdentity
  branding: ServerSchoolBranding
  settings: Record<string, unknown>
  moduleFlags: Record<string, boolean>
}

// ── unknown-JSON readers (never throw, never fabricate) ─────────────

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

function asString(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length ? v.trim() : null
}

function asNumber(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
  return Number.isFinite(n) ? n : null
}

function asBool(v: unknown): boolean | null {
  return typeof v === 'boolean' ? v : null
}

/** "Greenwood Public School" → "GP"; "" → "?". Presentation-derived. */
function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return `${words[0][0]}${words[words.length - 1][0]}`.toUpperCase()
}

/**
 * Realign the legacy local slices with the server configuration.
 * Server values overwrite seed/local values ONLY where the server actually
 * carries a value — everything else keeps its current content.
 */
function alignLocalSlices(state: SchoolSettingsState, config: SchoolSettingsConfig): Partial<SchoolSettingsState> {
  const patch: Partial<SchoolSettingsState> = {}
  const { identity, branding, settings } = config

  // ── general (display identity) ──────────────────────────────────────
  const general = { ...state.general }
  if (identity) {
    general.schoolName = identity.name || general.schoolName
    if (identity.shortName !== null) general.shortName = identity.shortName
    if (identity.tagline !== null) general.tagline = identity.tagline
    if (identity.affiliation !== null) general.affiliation = identity.affiliation
    if (identity.address !== null) general.address = identity.address
    if (identity.city !== null) general.city = identity.city
    if (identity.phone !== null) general.phone = identity.phone
    if (identity.email !== null) general.email = identity.email
    if (identity.website !== null) general.website = identity.website
    if (identity.principalName !== null) general.principalName = identity.principalName
    const year = asNumber(identity.established)
    if (year && year > 0) general.established = Math.trunc(year)
    general.logoText = initialsOf(identity.shortName || identity.name || general.schoolName)
  }
  if (branding?.primaryColor) general.brandColor = branding.primaryColor
  patch.general = general

  // ── academics (session from the server identity; thresholds from the
  //    settings.attendance slice) ───────────────────────────────────────
  const academics = { ...state.academics }
  const serverYear = asString(identity?.academicYear)
  if (serverYear) {
    // Store convention renders the session with an en-dash ("2026–2027").
    const normalized = serverYear.replace('-', '–')
    academics.currentSession = normalized
    if (!academics.academicSessions.includes(normalized)) {
      academics.academicSessions = [...academics.academicSessions, normalized].sort()
    }
  }
  const attendance = asRecord(settings.attendance)
  if (attendance) {
    const excellent = asNumber(attendance.excellent)
    const needsAttention = asNumber(attendance.needsAttention)
    if (excellent !== null || needsAttention !== null) {
      academics.attendanceThresholds = {
        excellent: excellent ?? academics.attendanceThresholds.excellent,
        needsAttention: needsAttention ?? academics.attendanceThresholds.needsAttention,
      }
    }
  }
  patch.academics = academics

  // ── timetable (field-mapped onto the local slice shape) ─────────────
  const timetableCfg = asRecord(settings.timetable)
  if (timetableCfg) {
    const timetable = { ...state.timetable }
    const dayStart = asString(timetableCfg.dayStart)
    const dayEnd = asString(timetableCfg.dayEnd)
    const periodMinutes = asNumber(timetableCfg.periodMinutes)
    const lunchMinutes = asNumber(timetableCfg.lunchMinutes)
    if (dayStart) timetable.startTime = dayStart
    if (dayEnd) timetable.endTime = dayEnd
    if (periodMinutes) timetable.periodDurationMinutes = Math.trunc(periodMinutes)
    if (lunchMinutes) timetable.lunchBreakDurationMinutes = Math.trunc(lunchMinutes)
    if (Array.isArray(timetableCfg.workingDays)) {
      const days = timetableCfg.workingDays.filter((d): d is string => typeof d === 'string')
      if (days.length) timetable.workingDays = days
    }
    patch.timetable = timetable
  }

  // ── library rules (settings.libraryRules slice) ─────────────────────
  const libraryRules = asRecord(settings.libraryRules)
  if (libraryRules) {
    const library = { ...state.library }
    const maxBooks = asNumber(libraryRules.maxBooksPerStudent)
    const issueDays = asNumber(libraryRules.issueDays)
    const fine = asNumber(libraryRules.lateFinePerDay)
    if (maxBooks !== null) library.maxBooksPerStudent = Math.trunc(maxBooks)
    if (issueDays !== null) library.issueDays = Math.trunc(issueDays)
    if (fine !== null) library.lateFinePerDay = Math.trunc(fine)
    if (Array.isArray(libraryRules.categories)) {
      const cats = libraryRules.categories.filter((c): c is string => typeof c === 'string')
      if (cats.length) library.categories = cats
    }
    patch.library = library
  }

  // ── uniforms (settings.uniforms = the catalogue array) ──────────────
  if (Array.isArray(settings.uniforms)) {
    const items = (settings.uniforms as unknown[]).filter((u): u is SchoolSettingsState['uniforms'][number] =>
      !!u && typeof u === 'object' && typeof (u as { id?: unknown }).id === 'string'
    )
    if (items.length) patch.uniforms = items
  }

  // ── ID-card template (settings.idCard slice) ────────────────────────
  const idCardCfg = asRecord(settings.idCard)
  if (idCardCfg) {
    const idCard = { ...state.idCard }
    const theme = asString(idCardCfg.theme)
    if (theme && ['violet', 'sky', 'emerald', 'rose', 'amber'].includes(theme)) {
      idCard.theme = theme as SchoolSettingsState['idCard']['theme']
    }
    const note = asString(idCardCfg.verificationNote)
    if (note) idCard.verificationNote = note
    for (const key of ['showHouse', 'showAdmissionNo', 'showDob', 'showBloodGroup', 'showValidUntil'] as const) {
      const v = asBool(idCardCfg[key])
      if (v !== null) idCard[key] = v
    }
    patch.idCard = idCard
  }

  return patch
}

/**
 * Apply a server configuration snapshot to the store: replace the `server`
 * slice verbatim and realign the legacy local slices. Used by the sync
 * below AND by the settings tabs after a successful PATCH (the response
 * carries the updated config).
 */
export function applySchoolConfig(config: SchoolSettingsConfig): void {
  useSchoolSettingsStore.setState((state) => ({
    server: {
      identity: config.identity,
      branding: config.branding,
      moduleFlags: config.moduleFlags ?? {},
      settings: config.settings ?? {},
      syncStatus: 'synced',
      syncedAt: new Date().toISOString(),
    },
    ...alignLocalSlices(state, config),
  }))
}

// ── sync ─────────────────────────────────────────────────────────────

let syncPromise: Promise<boolean> | null = null

/**
 * Fetch the canonical school configuration and hydrate the store. Runs at
 * most once per browser session (module-level promise guard); failures
 * keep the existing store content and flag `syncStatus: 'error'` for the
 * honest retry affordance.
 */
export function syncSchoolSettingsFromServer(): Promise<boolean> {
  if (syncPromise) return syncPromise
  syncPromise = (async () => {
    useSchoolSettingsStore.setState((s) => ({ server: { ...s.server, syncStatus: 'syncing' } }))
    try {
      const res = await fetch('/api/school-settings', { cache: 'no-store' })
      if (!res.ok) throw new Error(`school-settings sync HTTP ${res.status}`)
      const envelope = (await res.json().catch(() => null)) as
        | { success?: boolean; data?: SchoolSettingsConfig }
        | null
      const config = envelope?.data
      if (!envelope?.success || !config?.identity) {
        throw new Error('school-settings sync: malformed payload')
      }
      applySchoolConfig(config)
      return true
    } catch (e) {
      // Keep whatever the store has — never blank anything on failure.
      useSchoolSettingsStore.setState((s) => ({ server: { ...s.server, syncStatus: 'error' } }))
      console.warn('[school-settings-store] config sync failed — keeping existing store data:', e)
      return false
    }
  })()
  return syncPromise
}

/** Reset the once-per-session guard (explicit retry / tests). */
export function resetSchoolSettingsSyncGuard(): void {
  syncPromise = null
}
