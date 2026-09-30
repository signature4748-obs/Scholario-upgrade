'use client'

/**
 * StudentSidebar — the Student Role's own navigation shell.
 *
 * Design language (Student visual identity — GREEN IS BACK, locked):
 *   · premium GREEN primary accent — the student's personal accent,
 *     used with discipline: identity marks, the active row, the search
 *     trigger. Never giant green surfaces or ERP-green capsules.
 *   · clean light surface with the app's glass border language
 *   · compact brand header + personal identity block ("my workspace")
 *   · uppercase section labels · refined soft-tint active state with a
 *     subtle hairline rail indicator (token-driven → green in light AND
 *     dark mode with zero duplicated colour logic)
 *   · badges ONLY for real derived counts — never decorative numbers
 *   · collapsed state keeps icons, tooltips, active state and hierarchy
 *
 * The shell reads like "my personal school workspace", not a school
 * administration panel: quiet surfaces, generous section rhythm, and
 * one clear accent colour.
 */

import { ChevronLeft, ChevronRight, X, Search } from 'lucide-react'
import { motion } from 'framer-motion'
import { useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'
import { useMyStudentRecord } from '@/lib/store/students-store'
import { useCurrentUser } from '@/lib/store/current-user-store'
import { APP_VERSION } from '@/lib/app-version'
import type { NavGroup } from '@/components/shell/app-shell/types'

interface StudentSidebarProps {
  collapsed: boolean
  setCollapsed: (cb: (c: boolean) => boolean) => void
  mobileOpen: boolean
  setMobileOpen: (open: boolean) => void
  cmdOpen: boolean
  setCmdOpen: (open: boolean) => void
  groups: NavGroup[]
  activeKey: string
  onNavigate: (key: string) => void
}

export function StudentSidebar({
  collapsed,
  setCollapsed,
  mobileOpen,
  setMobileOpen,
  cmdOpen,
  setCmdOpen,
  groups,
  activeKey,
  onNavigate,
}: StudentSidebarProps) {
  void cmdOpen

  // A11y — focus lands on the drawer's close button when it opens so
  // keyboard users start inside the drawer (see app-shell.tsx for the
  // inert-main focus trap that keeps Tab there).
  const closeBtnRef = useRef<HTMLButtonElement | null>(null)
  useEffect(() => {
    if (mobileOpen) closeBtnRef.current?.focus()
  }, [mobileOpen])

  // Personal workspace identity — the SERVER enrollment context
  // (user → student → class, resolved by /api/auth/me) is the truth;
  // the canonical roster record (session-resolved) is only a hydrating
  // fallback. SS-1: shows the student's real profile photo (server
  // identity) when one is set, initials otherwise.
  const student = useMyStudentRecord()
  const me = useCurrentUser((s) => s.me)
  const initials = student?.avatar ?? '·'
  const avatarUrl = useCurrentUser((s) => s.me?.avatarUrl)
  const displayName = me?.name || student?.name || 'My Profile'
  const identityTitle = me?.student?.classLabel
    ? `${displayName} · ${me.student.classLabel}`
    : student
      ? `${student.name} · ${student.className}-${student.section}`
      : 'My Profile'

  return (
    <motion.aside
      id="app-sidebar"
      initial={false}
      animate={{ width: collapsed ? 76 : 280 }}
      transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
      className={cn(
        'relative z-50 shrink-0 h-full bg-background/85 dark:bg-card/60 backdrop-blur-2xl border-r border-border/40 flex flex-col shadow-2xs select-none',
        'max-lg:fixed max-lg:inset-y-0 max-lg:left-0 max-lg:shadow-2xl max-lg:w-[290px]',
        mobileOpen ? 'max-lg:translate-x-0' : 'max-lg:-translate-x-full',
        'transition-transform duration-300 ease-out lg:transition-none'
      )}
    >
      {/* ── Brand header — compact student workspace mark ─────────────── */}
      <div
        className={cn(
          'relative h-16 shrink-0 border-b border-border/40 bg-muted/[0.06]',
          collapsed ? 'flex flex-col items-center justify-center gap-2 px-2' : 'flex items-center justify-between px-4'
        )}
      >
        <div className={cn('flex items-center gap-2.5 overflow-hidden', collapsed && 'flex-col gap-0')}>
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 font-display text-sm font-bold text-white shadow-xs ring-1 ring-emerald-500/25">
            S
          </div>
          {!collapsed && (
            <div className="flex flex-col">
              <span className="font-display text-base font-bold leading-none tracking-tight text-foreground">
                SCHOLARIO
              </span>
              <span className="mt-1 text-[10px] font-medium uppercase tracking-[0.16em] text-emerald-700 dark:text-emerald-400">
                Student Workspace
              </span>
            </div>
          )}
        </div>
        <button
          onClick={() => setCollapsed((c) => !c)}
          className={cn(
            'hidden lg:flex p-1.5 rounded-lg text-muted-foreground transition-all shrink-0 cursor-pointer',
            'hover:text-foreground hover:bg-muted/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring'
          )}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </button>
        <button
          ref={closeBtnRef}
          onClick={() => setMobileOpen(false)}
          className="lg:hidden absolute right-3 top-3.5 flex h-9 w-9 items-center justify-center p-1.5 rounded-lg border border-border/50 text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer focus-ring"
          aria-label="Close navigation menu"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      {/* ── Personal identity block — "my space", opens my profile ────── */}
      <div className={cn('shrink-0 border-b border-border/40', collapsed ? 'px-2 py-3' : 'px-3.5 py-4')}>
        <button
          onClick={() => {
            onNavigate('profile')
            setMobileOpen(false)
          }}
          title={collapsed ? identityTitle : 'Open my profile'}
          aria-label={identityTitle}
          className={cn(
            'group flex w-full items-center rounded-xl text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            collapsed ? 'justify-center p-1.5' : 'gap-3 p-1.5 hover:bg-muted/50'
          )}
        >
          <span className="relative shrink-0">
            <span
              className={cn(
                'flex items-center justify-center overflow-hidden rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 font-display font-bold text-white',
                collapsed ? 'h-9 w-9 text-xs' : 'h-10 w-10 text-sm'
              )}
            >
              {avatarUrl ? (
                <img src={avatarUrl} alt={student?.name ?? 'My profile photo'} className="h-full w-full object-cover" />
              ) : (
                initials
              )}
            </span>
            <span
              className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-background bg-emerald-500"
              title="Active student"
              aria-label="Active student"
            />
          </span>
          {!collapsed && (
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-semibold leading-tight text-foreground">
                {displayName}
              </span>
              <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                {me?.student?.classLabel
                  ? `${me.student.classLabel}${me.student.rollNo ? ` · Roll ${me.student.rollNo}` : ''}`
                  : student
                    ? `${student.className}-${student.section}${student.rollNo ? ` · Roll ${student.rollNo}` : ''}`
                    : ''}
              </span>
            </span>
          )}
        </button>
      </div>

      {/* ── Global search trigger ─────────────────────────────────────── */}
      {!collapsed ? (
        <div className="px-3.5 pt-3.5 shrink-0">
          <button
            onClick={() => { setCmdOpen(true); setMobileOpen(false) }}
            className="w-full flex items-center justify-between gap-2 rounded-xl border border-border/50 bg-muted/25 hover:bg-muted/60 hover:border-border px-3 py-2.5 text-xs text-muted-foreground hover:text-foreground transition-all cursor-pointer shadow-2xs group focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            title="Global search (⌘K)"
          >
            <span className="flex items-center gap-2 truncate">
              <Search className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400 transition-transform group-hover:scale-110" />
              <span className="truncate font-medium">Search…</span>
            </span>
            <kbd className="shrink-0 rounded-md border border-border/60 bg-background px-1.5 py-0.5 text-[9px] font-mono font-semibold text-muted-foreground shadow-2xs">
              ⌘K
            </kbd>
          </button>
        </div>
      ) : (
        <div className="flex justify-center px-2 pt-3.5 shrink-0">
          <button
            onClick={() => { setCmdOpen(true); setMobileOpen(false) }}
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-border/50 bg-muted/25 text-emerald-600 dark:text-emerald-400 transition-all hover:bg-muted/60 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            title="Global search (⌘K)"
            aria-label="Global search (⌘K)"
          >
            <Search className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* ── Navigation — sections with refined active states ─────────── */}
      <nav
        className={cn('flex-1 overflow-y-auto no-scrollbar', collapsed ? 'px-2 py-3' : 'px-3.5 py-4 space-y-5')}
        aria-label="Student navigation"
      >
        {groups.map((group) => (
          <div key={group.label}>
            {!collapsed && (
              <h3 className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
                {group.label}
              </h3>
            )}
            {collapsed && <div className="mx-auto mb-2 mt-3 h-px w-8 bg-border/60" aria-hidden />}
            <div className="space-y-1">
              {group.items.map((item) => {
                const isActive = activeKey === item.key
                // A11y — when expanded the accessible name comes from the
                // button's CONTENT (label + live badge count, so "Messages 2"
                // is announced). When collapsed only the icon renders, so an
                // explicit label carries the name + badge.
                const itemLabel = collapsed
                  ? item.label + (item.badge != null && item.badge > 0 ? `, ${item.badge > 99 ? '99+' : item.badge} new` : '')
                  : undefined
                return (
                  <button
                    key={item.key}
                    onClick={() => {
                      onNavigate(item.key)
                      setMobileOpen(false)
                    }}
                    title={collapsed ? item.label : undefined}
                    aria-current={isActive ? 'page' : undefined}
                    aria-label={itemLabel}
                    className={cn(
                      'relative flex w-full items-center rounded-[10px] text-left transition-all duration-150 cursor-pointer group/icon',
                      'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      collapsed ? 'justify-center h-9 w-9 mx-auto' : 'gap-3 px-3 py-2.5 text-xs',
                      isActive
                        ? 'bg-primary/[0.09] font-semibold text-foreground'
                        : 'font-medium text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                    )}
                  >
                    {/* Subtle accent indicator — a hairline rail on the active row */}
                    {isActive && (
                      <span
                        className={cn(
                          'absolute top-1/2 -translate-y-1/2 rounded-full bg-primary',
                          collapsed ? 'left-[-6px] h-4 w-[3px]' : 'left-0 h-5 w-[3px]'
                        )}
                        aria-hidden
                      />
                    )}
                    <span
                      className={cn(
                        'flex shrink-0 items-center justify-center transition-colors',
                        isActive ? 'text-primary' : 'text-muted-foreground group-hover/icon:text-foreground/70'
                      )}
                    >
                      {item.icon}
                    </span>
                    {!collapsed && <span className="min-w-0 flex-1 truncate">{item.label}</span>}
                    {!collapsed && item.badge != null && item.badge > 0 && (
                      <span className="ml-auto shrink-0 rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-emerald-700 dark:text-emerald-300">
                        {item.badge > 99 ? '99+' : item.badge}
                      </span>
                    )}
                    {collapsed && item.badge != null && item.badge > 0 && (
                      <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[8px] font-bold text-primary-foreground">
                        {item.badge > 9 ? '9+' : item.badge}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* ── Footer — quiet status line ───────────────────────────────── */}
      <div
        className={cn(
          'shrink-0 border-t border-border/40 bg-muted/[0.06] text-muted-foreground',
          collapsed ? 'flex justify-center py-3' : 'flex items-center justify-between px-5 py-3'
        )}
      >
        {!collapsed ? (
          <>
            <span className="text-[10px] font-medium text-muted-foreground">SCHOLARIO v{APP_VERSION}</span>
            <span className="flex items-center gap-1.5" title="System online">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden />
              <span className="text-[10px] font-sans font-semibold text-emerald-700 dark:text-emerald-400">Live</span>
            </span>
          </>
        ) : (
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" title="System online" aria-hidden />
        )}
      </div>
    </motion.aside>
  )
}
