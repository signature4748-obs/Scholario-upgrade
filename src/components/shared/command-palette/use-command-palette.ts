'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import { useTheme } from '@/lib/store/theme-store'
import { useFocusStore } from '@/lib/store/focus-store'
import { signOut } from '@/lib/signout'
import type { NavGroup } from '@/components/shell/app-shell'
import {
  searchEntities,
  getRecentSearches,
  saveRecentSearch,
  removeRecentSearch,
  clearRecentSearches,
  type SearchResultItem,
} from '@/lib/search-service'

// Entity types that exist in the real database — selecting one emits a
// deep-link focus request in addition to navigating to the module.
const DB_ENTITY_TYPES = new Set(['student', 'teacher', 'fee', 'notice', 'parent', 'growth'])

export interface UseCommandPaletteArgs {
  open: boolean
  onOpenChange: (o: boolean) => void
  groups: NavGroup[]
  role: 'principal' | 'teacher' | 'student'
  onNavigate: (key: string) => void
}

export interface UseCommandPaletteReturn {
  query: string
  setQuery: (q: string) => void
  active: number
  setActive: (n: number | ((a: number) => number)) => void
  recentList: SearchResultItem[]
  setRecentList: (items: SearchResultItem[]) => void
  inputRef: React.RefObject<HTMLInputElement | null>
  listRef: React.RefObject<HTMLDivElement | null>
  searchResults: SearchResultItem[]
  groupedResults: [string, SearchResultItem[]][]
  flatResults: SearchResultItem[]
  systemActions: SearchResultItem[]
  handleSelect: (item: SearchResultItem) => void
  refreshRecent: () => void
  removeRecent: (id: string) => void
  clearRecent: () => void
}

export function useCommandPalette({
  open,
  onOpenChange,
  groups,
  role,
  onNavigate,
}: UseCommandPaletteArgs): UseCommandPaletteReturn {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [recentList, setRecentList] = useState<SearchResultItem[]>([])
  // DB-backed results from /api/search. null = not fetched/failed → mock fallback
  const [remoteResults, setRemoteResults] = useState<SearchResultItem[] | null>(null)
  const { toggle: toggleTheme } = useTheme()
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  // A11y — remembers the element that had focus before the palette opened
  // so closing it (Escape / selection) restores focus there instead of
  // dropping it to <body>.
  const prevFocusRef = useRef<HTMLElement | null>(null)

  // Load recent searches when dialog opens
  useEffect(() => {
    if (open) {
      prevFocusRef.current = (document.activeElement as HTMLElement | null) ?? null
      setQuery('')
      setActive(0)
      setRecentList(getRecentSearches())
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  // Restore focus when the palette closes. Deferred past the exit animation
  // (AnimatePresence keeps the panel mounted for ~120ms; focus falls to
  // <body> only after the unmount).
  useEffect(() => {
    if (!open && prevFocusRef.current) {
      const el = prevFocusRef.current
      prevFocusRef.current = null
      const t = setTimeout(() => {
        if (document.activeElement === document.body || !document.body.contains(document.activeElement)) {
          el.focus?.()
        }
      }, 250)
      return () => clearTimeout(t)
    }
  }, [open])

  // Reset active index when query changes
  useEffect(() => setActive(0), [query])

  // Debounced server-side search against the real database (students, teachers,
  // fees, notices, messages). Mock-derived local results remain as fallback.
  useEffect(() => {
    const q = query.trim()
    if (!open || q.length < 2) {
      setRemoteResults(null)
      return
    }
    let cancelled = false
    const timer = setTimeout(async () => {
      try {
        const r = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { cache: 'no-store' })
        if (!r.ok || !r.headers.get('content-type')?.includes('application/json')) {
          if (!cancelled) setRemoteResults(null)
          return
        }
        const j = await r.json().catch(() => null)
        if (cancelled) return
        const payload = j && typeof j === 'object' && 'data' in j ? (j as { data?: { results?: SearchResultItem[] } }).data : j as { results?: SearchResultItem[] } | null
        setRemoteResults(Array.isArray(payload?.results) ? payload!.results! : [])
      } catch {
        if (!cancelled) setRemoteResults(null)
      }
    }, 250)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [query, open])

  // Real-time search: merge instant local matches with DB-backed results.
  // FINAL-GATE honesty fix (DATA_SOURCE_MAP R5/R20): the server response is
  // AUTHORITATIVE for entity types — an empty server result for a type
  // means NO matches in the DB, not "keep the fabricated local corpus
  // visible". The old per-type merge let mock people/classes/rooms
  // surface in production search whenever the DB had no rows of that
  // type (or during the debounce window). Local results that are NOT
  // entities — module/feature navigation built from the role's real nav
  // registry — always remain: they are UI affordances, not data.
  const searchResults = useMemo(() => {
    const local = searchEntities(query, role, groups)
    const ENTITY_TYPES = new Set([
      'student', 'teacher', 'fee', 'notice', 'parent', 'class', 'subject',
      'exam', 'room', 'material', 'deck', 'group',
    ])
    const localNav = local.filter((i) => !ENTITY_TYPES.has(i.type))
    if (remoteResults === null) {
      // Idle, in-flight or failed: while a query is active the local
      // entity corpora never render (the debounced server fetch is the
      // entity source of truth); real navigation stays useful.
      return localNav
    }
    // Server responded: its rows are the entity truth (including "no
    // rows of that type" = no matches), local navigation complements.
    return [...remoteResults, ...localNav]
  }, [query, role, groups, remoteResults])

  // Group search results by category
  const groupedResults = useMemo(() => {
    const map = new Map<string, SearchResultItem[]>()
    searchResults.forEach((item) => {
      if (!map.has(item.category)) map.set(item.category, [])
      map.get(item.category)!.push(item)
    })
    return Array.from(map.entries())
  }, [searchResults])

  // Flattened results for keyboard navigation
  const flatResults = useMemo(() => {
    return searchResults
  }, [searchResults])

  // System actions (Dark mode, Logout) when query matches 'theme', 'logout'
  const systemActions = useMemo(() => {
    if (!query.trim()) return []
    const q = query.toLowerCase()
    const actions: SearchResultItem[] = []

    if ('theme dark light appearance mode'.includes(q)) {
      actions.push({
        id: 'act-theme',
        title: 'Toggle dark / light appearance',
        subtitle: 'Switch application color theme',
        category: 'Settings & System',
        type: 'setting',
        moduleKey: 'settings',
        iconName: 'Settings',
        badge: 'Appearance',
      })
    }

    if (role === 'student') {
      // SS-1 — settings deep-links (role-aware: students never see
      // administrative settings). Each navigates straight to the section.
      const SETTINGS_ACTIONS: { id: string; section: string; title: string; subtitle: string; hint: string }[] = [
        { id: 'act-set-notifications', section: 'notifications', title: 'Notification preferences', subtitle: 'Choose what you get notified about', hint: 'notifications alerts announcements messages reminders channels bell' },
        { id: 'act-set-appearance', section: 'appearance', title: 'Appearance & theme', subtitle: 'Light, dark or system + accent colour', hint: 'theme dark light system appearance accent colour' },
        { id: 'act-set-security', section: 'security', title: 'Login & security', subtitle: 'Password and sign-in', hint: 'password change login security email sign in' },
        { id: 'act-set-devices', section: 'devices', title: 'Devices & sessions', subtitle: 'Where your account is signed in', hint: 'devices sessions browsers sign out other' },
        { id: 'act-set-privacy', section: 'privacy', title: 'Privacy', subtitle: 'Who can see what', hint: 'privacy visibility classmates school managed' },
        { id: 'act-set-support', section: 'support', title: 'Help & support', subtitle: 'Contact your school office', hint: 'help support contact school office report problem' },
      ]
      for (const a of SETTINGS_ACTIONS) {
        if (a.hint.includes(q) || 'settings preferences'.includes(q)) {
          actions.push({
            id: a.id,
            title: a.title,
            subtitle: a.subtitle,
            category: 'Settings & System',
            type: 'setting',
            moduleKey: `settings-${a.section}`,
            iconName: 'Settings',
            badge: 'Settings',
          })
        }
      }
    }

    if ('logout signout exit session'.includes(q)) {
      actions.push({
        id: 'act-logout',
        title: 'Sign out of SCHOLARIO-OS',
        subtitle: 'Log out of administrative session',
        category: 'Settings & System',
        type: 'setting',
        moduleKey: 'logout',
        iconName: 'LogOut',
        badge: 'Session',
        badgeVariant: 'destructive',
      })
    }

    return actions
  }, [query, role])

  // Handle item selection
  const handleSelect = (item: SearchResultItem) => {
    if (item.id === 'act-theme') {
      toggleTheme()
    } else if (item.id === 'act-logout') {
      void signOut()
    } else {
      saveRecentSearch(item)
      // DB-backed entity results carry a deep-link focus request so the
      // target module can open the relevant profile/detail view directly.
      if (DB_ENTITY_TYPES.has(item.type)) {
        useFocusStore.getState().setFocus({
          type: item.type,
          id: item.id,
          title: item.title,
          subtitle: item.subtitle,
          moduleKey: item.moduleKey,
        })
      }
      onNavigate(item.moduleKey)
    }
    onOpenChange(false)
  }

  // Keyboard navigation handler
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        if (query.trim()) {
          setActive((a) => Math.min(a + 1, flatResults.length + systemActions.length - 1))
        } else if (recentList.length > 0) {
          setActive((a) => Math.min(a + 1, recentList.length - 1))
        }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActive((a) => Math.max(a - 1, 0))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        if (query.trim()) {
          const allItems = [...flatResults, ...systemActions]
          const target = allItems[active]
          if (target) handleSelect(target)
        } else if (recentList[active]) {
          handleSelect(recentList[active])
        }
      } else if (e.key === 'Escape') {
        onOpenChange(false)
      } else if (e.key === 'Tab') {
        // A11y — focus trap: Tab cycles inside the palette dialog instead
        // of escaping into the background page (the dialog is modal).
        const panel = inputRef.current?.closest('[role="dialog"]')
        if (!panel) return
        const focusables = Array.from(
          panel.querySelectorAll<HTMLElement>('button:not([disabled]), input, [tabindex]:not([tabindex="-1"])'),
        ).filter((el) => el.offsetParent !== null)
        if (focusables.length === 0) return
        const first = focusables[0]
        const last = focusables[focusables.length - 1]
        const activeEl = document.activeElement
        if (e.shiftKey) {
          if (activeEl === first || !panel.contains(activeEl)) {
            e.preventDefault()
            last.focus()
          }
        } else {
          if (activeEl === last || !panel.contains(activeEl)) {
            e.preventDefault()
            first.focus()
          }
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, query, flatResults, systemActions, recentList, active, onOpenChange])

  // Scroll active element into view
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-idx="${active}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const refreshRecent = () => setRecentList(getRecentSearches())
  const removeRecent = (id: string) => {
    const updated = removeRecentSearch(id)
    setRecentList(updated)
  }
  const clearRecent = () => {
    clearRecentSearches()
    setRecentList([])
  }

  return {
    query,
    setQuery,
    active,
    setActive,
    recentList,
    setRecentList,
    inputRef,
    listRef,
    searchResults,
    groupedResults,
    flatResults,
    systemActions,
    handleSelect,
    refreshRecent,
    removeRecent,
    clearRecent,
  }
}
