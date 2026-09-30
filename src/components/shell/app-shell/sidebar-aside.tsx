'use client'

import { useEffect, useRef } from 'react'
import { ChevronLeft, ChevronRight, X, Search, ChevronDown } from 'lucide-react'
import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'
import type { NavGroup } from './types'

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
}

type ShellRole = 'principal' | 'teacher' | 'student' | 'superadmin'

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
}: SidebarAsideProps) {
  void cmdOpen

  // A11y — when the mobile drawer opens, focus lands on its close button
  // so keyboard users start INSIDE the drawer (main content is inert while
  // the drawer overlays it — see app-shell.tsx).
  const closeBtnRef = useRef<HTMLButtonElement | null>(null)
  useEffect(() => {
    if (mobileOpen) closeBtnRef.current?.focus()
  }, [mobileOpen])

  return (
    <motion.aside
      id="app-sidebar"
      initial={false}
      animate={{ width: collapsed ? 80 : 280 }}
      transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
      className={cn(
        'relative z-50 shrink-0 h-full bg-background/80 dark:bg-card/60 backdrop-blur-2xl border-r border-border/40 flex flex-col shadow-2xs select-none',
        'max-lg:fixed max-lg:inset-y-0 max-lg:left-0 max-lg:shadow-2xl max-lg:w-[280px]',
        mobileOpen ? 'max-lg:translate-x-0' : 'max-lg:-translate-x-full',
        'transition-transform duration-300 ease-out lg:transition-none'
      )}
    >
      {/* Sidebar Header */}
      <div className="p-4 flex items-center justify-between border-b border-border/40 h-16 shrink-0 bg-muted/10">
        <div className="flex items-center gap-3 overflow-hidden">
          <div className="w-8 h-8 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-xl flex items-center justify-center font-bold text-white shrink-0 text-sm shadow-xs ring-1 ring-emerald-500/20">
            S
          </div>
          {!collapsed && (
            <div className="flex flex-col">
              <span className="font-bold text-base tracking-tight text-foreground leading-none font-display">
                SCHOLARIO
              </span>
              <span className="text-[10px] text-muted-foreground font-medium mt-0.5 tracking-wider uppercase font-mono">
                Enterprise ERP
              </span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setCollapsed((c) => !c)}
            className="hidden lg:flex p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-all shrink-0 cursor-pointer focus-ring"
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <ChevronRight className="h-4 w-4" aria-hidden="true" /> : <ChevronLeft className="h-4 w-4" aria-hidden="true" />}
          </button>
          <button
            ref={closeBtnRef}
            onClick={() => setMobileOpen(false)}
            aria-label="Close navigation menu"
            className="lg:hidden flex h-9 w-9 items-center justify-center p-1.5 border border-border/50 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer focus-ring"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Global Search Trigger */}
      {!collapsed && (
        <div className="p-3 shrink-0">
          <button
            onClick={() => { setCmdOpen(true); setMobileOpen(false) }}
            className="w-full flex items-center justify-between gap-2 rounded-xl border border-border/40 bg-muted/30 hover:bg-muted/60 px-3 py-2 text-xs text-muted-foreground hover:text-foreground transition-all cursor-pointer shadow-2xs group"
            title="Global search (⌘K)"
          >
            <div className="flex items-center gap-2 truncate">
              <Search className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400 shrink-0 transition-transform group-hover:scale-110" />
              <span className="truncate font-medium">Search…</span>
            </div>
            <kbd className="shrink-0 rounded-md border border-border/60 bg-background/80 px-1.5 py-0.5 text-[9px] font-mono font-semibold text-muted-foreground shadow-2xs">⌘K</kbd>
          </button>
        </div>
      )}

      {/* Navigation Sections */}
      <nav className="flex-1 px-3 py-2 overflow-y-auto no-scrollbar space-y-4">
        {groups.map((group) => (
          <div key={group.label} className="mb-3">
            {!collapsed && (
              <h3 className="px-3 mb-1.5 text-[10px] font-bold text-muted-foreground uppercase tracking-widest font-mono">
                {group.label}
              </h3>
            )}
            <div className="space-y-1">
              {group.items.map((item) => {
                const hasChildren = Boolean(item.children && item.children.length > 0)
                const isParentActive =
                  activeKey === item.key ||
                  (hasChildren && item.children?.some((c) => c.key === activeKey)) ||
                  (item.key === 'students' && (activeKey.startsWith('students') || activeKey.startsWith('classes')))

                return (
                  <div key={item.key} className="space-y-1">
                    <button
                      onClick={() => {
                        onNavigate(hasChildren ? (item.children?.[0]?.key ?? item.key) : item.key)
                        setMobileOpen(false)
                      }}
                      title={collapsed ? item.label : undefined}
                      aria-current={isParentActive ? 'page' : undefined}
                      className={cn(
                        'flex items-center gap-3 w-full transition-all duration-200 cursor-pointer text-left focus-ring',
                        isParentActive
                          ? 'bg-emerald-500/10 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 font-semibold border-l-2 border-emerald-500 rounded-r-xl rounded-l-xs shadow-2xs px-3 py-2 text-xs'
                          : 'px-3 py-2 text-muted-foreground hover:bg-muted/50 hover:text-foreground text-xs font-medium rounded-xl',
                        collapsed && 'justify-center px-2'
                      )}
                    >
                      <span className={cn('shrink-0 transition-colors', isParentActive ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground/80')}>
                        {item.icon}
                      </span>
                      {!collapsed && <span className="truncate flex-1">{item.label}</span>}
                      {!collapsed && hasChildren && (
                        <ChevronDown className={cn('h-3.5 w-3.5 transition-transform duration-200', isParentActive ? 'rotate-0 text-emerald-600 dark:text-emerald-400' : '-rotate-90 text-muted-foreground/60')} />
                      )}
                      {!collapsed && !hasChildren && item.badge != null && item.badge > 0 && (
                        <span
                          className={cn(
                            'rounded-full px-2 py-0.5 text-[10px] font-bold',
                            role === 'principal' && activeKey !== item.key && item.key === 'dashboard'
                              ? 'bg-rose-500/15 text-rose-700 dark:text-rose-400 animate-pulse'
                              : 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-300'
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
                        className="ml-4.5 pl-3.5 space-y-1 my-1.5 border-l border-emerald-500/20 dark:border-emerald-500/30"
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
                                'flex items-center gap-2.5 w-full transition-all duration-150 cursor-pointer text-left py-1.5 px-2.5 rounded-lg text-xs font-medium relative focus-ring',
                                isChildActive
                                  ? 'bg-emerald-500/12 dark:bg-emerald-500/18 text-emerald-700 dark:text-emerald-300 font-semibold shadow-2xs before:absolute before:-left-[18px] before:top-1/2 before:-translate-y-1/2 before:w-1.5 before:h-1.5 before:rounded-full before:bg-emerald-500'
                                  : 'text-muted-foreground/80 hover:bg-muted/40 hover:text-foreground'
                              )}
                            >
                              <span className={cn('shrink-0', isChildActive ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground/70')}>
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

      {/* Sidebar Footer */}
      <div className="p-3 border-t border-border/40 bg-muted/10 shrink-0 flex items-center justify-between text-xs text-muted-foreground font-mono">
        {!collapsed ? (
          <>
            <span className="text-[11px] font-medium text-muted-foreground">SCHOLARIO v2.4</span>
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" title="System Online" aria-hidden="true" />
              <span className="text-[10px] text-emerald-700 dark:text-emerald-400 font-sans font-semibold">Live</span>
            </div>
          </>
        ) : (
          <span className="w-2 h-2 rounded-full bg-emerald-500 mx-auto animate-pulse" title="System Online" aria-hidden="true" />
        )}
      </div>
    </motion.aside>
  )
}
