'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// ============================================================
// THEME STORE v2 (SS-1)
// ------------------------------------------------------------
// Light / Dark / SYSTEM (follows the OS), accent color, and the
// accessibility preferences from Settings → Accessibility
// (reduce-motion + larger text). All are DEVICE-LOCAL by design —
// they describe how this device renders Scholario, so they persist
// to localStorage (existing pattern), not to the server.
// ============================================================

export type ThemeMode = 'light' | 'dark' | 'system'
export type TextSize = 'default' | 'large'

export interface AccentColorConfig {
  name: string
  value: string
  primaryClass: string
  bgLightClass: string
  borderClass: string
  textClass: string
}

interface ThemeState {
  theme: ThemeMode
  accentColor: string
  /** Settings → Accessibility: disable animations/transitions app-wide. */
  reduceMotion: boolean
  /** Settings → Accessibility: modestly larger rem scale (16 → 17px). */
  textSize: TextSize
  hydrated: boolean
  setHydrated: () => void
  toggle: () => void
  set: (t: ThemeMode) => void
  setAccentColor: (accent: string) => void
  setReduceMotion: (v: boolean) => void
  setTextSize: (v: TextSize) => void
}

export const useTheme = create<ThemeState>()(
  persist(
    (set) => ({
      theme: 'light',
      accentColor: 'teal',
      reduceMotion: false,
      textSize: 'default',
      hydrated: false,
      setHydrated: () => set({ hydrated: true }),
      toggle: () => set((s) => ({ theme: s.theme === 'light' ? 'dark' : 'light' })),
      set: (t) => {
        applyTheme(t)
        set({ theme: t })
      },
      setAccentColor: (accent) => {
        applyAccentColor(accent)
        set({ accentColor: accent })
      },
      setReduceMotion: (v) => {
        applyReduceMotion(v)
        set({ reduceMotion: v })
      },
      setTextSize: (v) => {
        applyTextSize(v)
        set({ textSize: v })
      },
    }),
    {
      name: 'scholario-theme',
      version: 2,
      migrate: (state) => state, // v1 shapes stay valid; new keys default
      onRehydrateStorage: () => (state) => {
        useTheme.setState({ hydrated: true })
        if (state) state.setHydrated()
        if (state?.theme) applyTheme(state.theme)
        if (state?.accentColor) applyAccentColor(state.accentColor)
        applyReduceMotion(state?.reduceMotion ?? false)
        applyTextSize(state?.textSize ?? 'default')
      },
    },
  )
)

// ─── Application to <html> ──────────────────────────────────────────

/** Does the OS currently prefer dark? (SSR-safe.) */
export function systemPrefersDark(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

let systemWatcherAttached = false
function attachSystemWatcher() {
  if (systemWatcherAttached || typeof window === 'undefined' || !window.matchMedia) return
  systemWatcherAttached = true
  const mq = window.matchMedia('(prefers-color-scheme: dark)')
  const onChange = () => {
    if (useTheme.getState().theme === 'system') applyTheme('system')
  }
  mq.addEventListener?.('change', onChange)
}

export function applyTheme(theme: ThemeMode) {
  if (typeof document === 'undefined') return
  attachSystemWatcher()
  const root = document.documentElement
  const dark = theme === 'dark' || (theme === 'system' && systemPrefersDark())
  root.classList.toggle('dark', dark)
  root.dataset.themeMode = theme
}

export function applyReduceMotion(v: boolean) {
  if (typeof document === 'undefined') return
  document.documentElement.dataset.reduceMotion = v ? 'true' : 'false'
}

export function applyTextSize(size: TextSize) {
  if (typeof document === 'undefined') return
  document.documentElement.dataset.textSize = size
}

// ─── Accent colors ──────────────────────────────────────────────────

// Map accent names to CSS color values
const ACCENT_MAP: Record<string, string> = {
  emerald: 'oklch(0.55 0.14 162)',
  teal: 'oklch(0.6 0.13 180)',
  amber: 'oklch(0.7 0.16 75)',
  rose: 'oklch(0.65 0.2 25)',
  violet: 'oklch(0.6 0.18 300)',
  cyan: 'oklch(0.7 0.15 200)',
  indigo: 'oklch(0.5 0.2 270)',
  blue: 'oklch(0.55 0.2 250)',
}

export const ACCENT_NAMES = Object.keys(ACCENT_MAP)

/** Swatch classes for the Appearance accent picker (light + dark safe). */
export const ACCENT_SWATCHES: Record<string, string> = {
  emerald: 'bg-emerald-500',
  teal: 'bg-teal-500',
  amber: 'bg-amber-500',
  rose: 'bg-rose-500',
  violet: 'bg-violet-500',
  cyan: 'bg-cyan-500',
  indigo: 'bg-indigo-500',
  blue: 'bg-blue-500',
}

export function applyAccentColor(accentName: string) {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  const colorVal = ACCENT_MAP[accentName.toLowerCase()] || ACCENT_MAP.emerald
  root.style.setProperty('--primary', colorVal)
  root.style.setProperty('--ring', colorVal)
  root.style.setProperty('--sidebar-primary', colorVal)
  root.setAttribute('data-accent', accentName.toLowerCase())
}
