'use client'

import { useEffect, useRef } from 'react'
import { ChevronLeft, ChevronRight, X, Search, ChevronDown } from 'lucide-react'
import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'
import { APP_VERSION } from '@/lib/app-version'
import { useAuth } from '@/lib/store/auth-store'
import { roleStyles, type NavGroup } from './types'

interface SidebarAsideProps {
  collapsed: boolean
  setCollapsed: (cb: (c: boolean) => boolean) => void
  mobileOpen: boolean
  setMobileOpen: (open: boolean) => void
  cmdOpen: boolean
  setCmdOpen: (open: boolean) => void
  groups: NavGroup[]
  activeKey: string
  onNavigate: (key: string) => void
  role: ShellRole
  /** ARCH-RESET-2c — quiet school identity under the wordmark (server
   *  session school name; neutral fallback handled by the shell). */
  schoolName?: string
  /** Compact role chip in the header (e.g. 'Principal' / 'Teacher'). */
  roleLabel?: string
}

type ShellRole = 'principal' | 'teacher' | 'student'

// Role identity for the bottom user block when no explicit label is passed.
const ROLE_FALLBACK_LABEL: Record<ShellRole, string> = {
  principal: 'Principal',
  teacher: 'Teacher',
  student: 'Student',
}

/** Compact initials for the user-block avatar (server-authenticated name). */
function initialsOf(name?: string | null): string {
  // Skip honorifics / parenthetical prefixes ("Dr.", "(Smt.)", "Mr.") —
  // initials must read as a person, never as punctuation.
  const parts = (name ?? '')
    .trim()
    .split(/\s+/)
    .filter((p) => /^[A-Za-z]/.test(p) && !p.endsWith('.') && !p.startsWith('('))
  if (parts.length === 0) return '·'
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return `${parts[0]![0]!}${parts[parts.length - 1]![0]!}`.toUpperCase()
}

export function SidebarAside({
  collapsed,
  setCollapsed,
  mobileOpen,
  setMobileOpen,
  cmdOpen,
  setCmdOpen,
  groups,
  activeKey,
  onNavigate,
  role,
  schoolName,
  roleLabel,
}: SidebarAsideProps) {
  void cmdOpen

  // A11y — when the mobile drawer opens, focus lands on its close button
  // so keyboard users start INSIDE the drawer (main content is inert while
  // the drawer overlays it — see app-shell.tsx).
  const closeBtnRef = useRef<HTMLButtonElement | null>(null)
  useEffect(() => {
    if (mobileOpen) closeBtnRef.current?.focus()
  }, [mobileOpen])

  // ARCH-RESET-2c — bottom user-block identity (server session user from
  // the auth store). The header profile dropdown stays the full account
  // menu; this block is the always-visible identity anchor.
  const user = useAuth((s) => s.user)
  const userName = user?.name?.trim() || 'Account'
  const userInitials = initialsOf(user?.name)
  const userRoleLabel = roleLabel ?? ROLE_FALLBACK_LABEL[role]

  return (
    <motion.aside
      id="app-sidebar"
      initial={false}
      animate={{ width: collapsed ? 72 : 260 }}
      transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
      className={cn(
        'relative z-50 shrink-0 h-full bg-white border-r border-slate-200 flex flex-col select-none',
        'max-lg:fixed max-lg:inset-y-0 max-lg:left-0 max-lg:shadow-xl max-lg:w-[280px]',
        mobileOpen ? 'max-lg:translate-x-0' : 'max-lg:-translate-x-full',
        'transition-transform duration-300 ease-out lg:transition-none'
      )}
    >
      {/* Sidebar Header — wordmark, quiet school identity, role chip */}
      <div className="h-16 shrink-0 border-b border-slate-200 flex items-center gap-2 px-3">
        <div className="flex min-w-0 flex-1 items-center gap-2.5 overflow-hidden">
          <div
            className="w-8 h-8 rounded-lg bg-slate-900 flex items-center justify-center font-bold text-white shrink-0 text-sm"
            title={schoolName || 'SCHOLARIO'}
          >
            S
          </div>
          {!collapsed && (
            <div className="flex min-w-0 flex-col overflow-hidden">
              <span className="text-sm font-bold tracking-tight text-slate-900 leading-none">
                SCHOLARIO
              </span>
              <span className="mt-1 text-[11px] text-slate-500 truncate leading-none" title={schoolName}>
                {schoolName || 'School'}
              </span>
            </div>
          )}
        </div>
        {!collapsed && roleLabel && (
          <span
            className={cn(
              'shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded border leading-none',
              roleStyles[role].chip
            )}
          >
            {roleLabel}
          </span>
        )}
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => setCollapsed((c) => !c)}
            className="hidden lg:flex p-1.5 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors shrink-0 cursor-pointer focus-ring"
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <ChevronRight className="h-4 w-4" aria-hidden="true" /> : <ChevronLeft className="h-4 w-4" aria-hidden="true" />}
          </button>
          <button
            ref={closeBtnRef}
            onClick={() => setMobileOpen(false)}
            aria-label="Close navigation menu"
            className="lg:hidden flex h-9 w-9 items-center justify-center p-1.5 border border-slate-200 rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-900 cursor-pointer focus-ring"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Global Search Trigger — neutral quiet affordance */}
      {!collapsed && (
        <div className="px-3 pt-3 shrink-0">
          <button
            onClick={() => { setCmdOpen(true); setMobileOpen(false) }}
            className="w-full flex items-center justify-between gap-2 rounded-md border border-slate-200 bg-slate-50 hover:bg-slate-100 px-2.5 py-2 text-xs text-slate-500 hover:text-slate-700 transition-colors cursor-pointer focus-ring"
            title="Global search (⌘K)"
          >
            <div className="flex items-center gap-2 truncate">
              <Search className="h-3.5 w-3.5 text-slate-400 shrink-0" />
              <span className="truncate">Search…</span>
            </div>
            <kbd className="shrink-0 rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[9px] font-mono font-semibold text-slate-400">⌘K</kbd>
          </button>
        </div>
      )}

      {/* Navigation Sections — grouped, compact, restrained */}
      <nav className="flex-1 px-2.5 py-2.5 overflow-y-auto no-scrollbar space-y-4" aria-label="Main navigation">
        {groups.map((group) => (
          <div key={group.label} className="mb-1">
            {!collapsed && (
              <h3 className="px-2.5 mb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                {group.label}
              </h3>
            )}
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const hasChildren = Boolean(item.children && item.children.length > 0)
                const isParentActive =
                  activeKey === item.key ||
                  (hasChildren && item.children?.some((c) => c.key === activeKey)) ||
                  (item.key === 'students' && (activeKey.startsWith('students') || activeKey.startsWith('classes')))

                return (
                  <div key={item.key} className="space-y-0.5">
                    <button
                      onClick={() => {
                        onNavigate(hasChildren ? (item.children?.[0]?.key ?? item.key) : item.key)
                        setMobileOpen(false)
                      }}
                      title={collapsed ? item.label : undefined}
                      aria-current={isParentActive ? 'page' : undefined}
                      className={cn(
                        'flex items-center gap-2.5 w-full h-8 rounded-md px-2.5 text-[13px] transition-colors cursor-pointer text-left focus-ring',
                        isParentActive
                          ? 'bg-primary/10 text-primary font-medium'
                          : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
                        collapsed && 'justify-center px-0'
                      )}
                    >
                      <span className={cn('shrink-0 transition-colors [&>svg]:h-4 [&>svg]:w-4', isParentActive ? 'text-primary' : 'text-slate-400')}>
                        {item.icon}
                      </span>
                      {!collapsed && <span className="truncate flex-1">{item.label}</span>}
                      {!collapsed && item.tag && (
                        <span
                          title="Demo module — changes are not saved to the database"
                          className="shrink-0 rounded-full bg-amber-500/15 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-300"
                        >
                          {item.tag}
                        </span>
                      )}
                      {!collapsed && hasChildren && (
                        <ChevronDown className={cn('h-3.5 w-3.5 shrink-0 transition-transform duration-200', isParentActive ? 'rotate-0 text-slate-500' : '-rotate-90 text-slate-400')} />
                      )}
                      {!collapsed && !hasChildren && item.badge != null && item.badge > 0 && (
                        <span
                          className={cn(
                            'rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums',
                            role === 'principal' && activeKey !== item.key && item.key === 'dashboard'
                              ? 'bg-rose-500/15 text-rose-700 animate-pulse'
                              : 'bg-slate-100 text-slate-600'
                          )}
                        >
                          {item.badge}
                        </span>
                      )}
                    </button>

                    {/* Submenu Children rendering */}
                    {!collapsed && hasChildren && isParentActive && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.18, ease: 'easeOut' }}
                        className="ml-4 pl-3 space-y-0.5 my-1 border-l border-slate-200"
                      >
                        {item.children?.map((child) => {
                          const isChildActive =
                            activeKey === child.key ||
                            (activeKey === item.key && child.key === `${item.key}:overview`) ||
                            (activeKey === 'classes' && child.key === 'students:classes')

                          return (
                            <button
                              key={child.key}
                              onClick={() => {
                                onNavigate(child.key)
                                setMobileOpen(false)
                              }}
                              aria-current={isChildActive ? 'page' : undefined}
                              className={cn(
                                'flex items-center gap-2.5 w-full h-7 rounded-md px-2.5 text-xs transition-colors cursor-pointer text-left focus-ring',
                                isChildActive
                                  ? 'bg-primary/10 text-primary font-medium'
                                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                              )}
                            >
                              <span className={cn('shrink-0 transition-colors', isChildActive ? 'text-primary' : 'text-slate-400')}>
                                {child.icon}
                              </span>
                              <span className="truncate">{child.label}</span>
                            </button>
                          )
                        })}
                      </motion.div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* User Profile Block — quiet identity anchor above the footer line
          (desktop expanded: avatar initials + name + role; collapsed: avatar
          with tooltip). The header profile dropdown remains the full account
          menu — this block is an addition, not a move. */}
      <div className={cn('shrink-0 border-t border-slate-200', collapsed ? 'flex justify-center py-2.5' : 'px-3 py-2.5')}>
        <div
          className={cn('flex items-center overflow-hidden', collapsed ? 'justify-center' : 'gap-2.5')}
          title={collapsed ? `${userName} · ${userRoleLabel}` : undefined}
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary" aria-hidden="true">
            {userInitials}
          </span>
          {!collapsed && (
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-semibold text-slate-900">{userName}</span>
              <span className="block truncate text-[10px] text-slate-500">{userRoleLabel}</span>
            </span>
          )}
        </div>
      </div>

      {/* Sidebar Footer — version + live status, quiet */}
      <div className="px-3 py-2.5 border-t border-slate-200 shrink-0 flex items-center justify-between">
        {!collapsed ? (
          <>
            <span className="text-[11px] font-medium text-slate-500">SCHOLARIO v{APP_VERSION}</span>
            <span className="flex items-center gap-1.5" title="System online">
              <span className="w-1.5 h-1.5 rounded-full bg-teal-600 animate-pulse" aria-hidden="true" />
              <span className="text-[10px] font-medium text-slate-500">Live</span>
            </span>
          </>
        ) : (
          <span className="w-1.5 h-1.5 rounded-full bg-teal-600 mx-auto animate-pulse" title="System online" aria-hidden="true" />
        )}
      </div>
    </motion.aside>
  )
}
