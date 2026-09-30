'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Bell, ShieldAlert, IndianRupee, UserPlus, Clock, BookOpen, Coins,
  Calendar, GraduationCap, Mail, Megaphone, Inbox, CheckCheck, CalendarCheck,
} from 'lucide-react'
import { cn } from '@/lib/utils'

export interface NotificationItem {
  id: string
  type?: string
  title?: string
  description?: string
  time?: string
  timestamp?: string
  message?: string
  unread: boolean
}

interface NotificationsDropdownProps {
  open: boolean
  onClose: () => void
  notifList: NotificationItem[]
  onMarkAllRead: () => void
  onNotificationClick: (id: string) => void
  onNavigateDashboard: () => void
  role: ShellRole
  liveAlertCount: number
  totalBadgeCount: number
  unreadCount: number
  /** 'live' = real DB feed synced (even if empty), 'loading' = syncing, 'error' = fetch failed */
  source?: 'live' | 'loading' | 'error'
  /** Optional banner content rendered above the list (e.g. platform-scope note) */
  children?: React.ReactNode
}

type ShellRole = 'principal' | 'teacher' | 'student' | 'superadmin'

type FeedFilter = 'all' | 'unread' | 'messages' | 'announcements'

const MAX_ROWS = 8

export function NotificationsDropdown({
  open,
  onClose,
  notifList,
  onMarkAllRead,
  onNotificationClick,
  onNavigateDashboard,
  role,
  liveAlertCount,
  totalBadgeCount,
  unreadCount,
  source = 'loading',
  children,
}: NotificationsDropdownProps) {
  const [filter, setFilter] = useState<FeedFilter>('all')

  // Reset the filter whenever the panel re-opens so it always starts neutral
  useEffect(() => {
    if (open) setFilter('all')
  }, [open])

  // Close on outside click / Escape — the dropdown previously only closed via
  // the bell toggle, which trapped keyboard & pointer users.
  const rootRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      const t = e.target as Node | null
      if (t && rootRef.current && !rootRef.current.contains(t)) {
        // ignore clicks on the bell trigger itself (it toggles via onClick)
        const trigger = (t as HTMLElement)?.closest?.('button[aria-label^="Notifications"]')
        if (!trigger) onClose()
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('touchstart', onPointerDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('touchstart', onPointerDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])

  // Filter counts drive the tab badges; messages vs announcements are derived
  // from the feed item type (MESSAGE / everything else from the notice board).
  const isMessage = (n: NotificationItem) => (n.type || '').toUpperCase() === 'MESSAGE'
  const counts = useMemo(() => {
    const unread = notifList.filter((n) => n.unread).length
    const messages = notifList.filter(isMessage).length
    const announcements = notifList.length - messages
    return { all: notifList.length, unread, messages, announcements }
  }, [notifList])

  const filteredList = useMemo(() => {
    switch (filter) {
      case 'unread':
        return notifList.filter((n) => n.unread)
      case 'messages':
        return notifList.filter(isMessage)
      case 'announcements':
        return notifList.filter((n) => !isMessage(n))
      default:
        return notifList
    }
  }, [notifList, filter])

  const hiddenCount = Math.max(0, filteredList.length - MAX_ROWS)
  const visibleList = filteredList.slice(0, MAX_ROWS)

  const tabDefs: { key: FeedFilter; label: string; icon: React.ElementType; count: number }[] = [
    { key: 'all', label: 'All', icon: Inbox, count: counts.all },
    { key: 'unread', label: 'Unread', icon: Bell, count: counts.unread },
    { key: 'messages', label: 'Messages', icon: Mail, count: counts.messages },
    { key: 'announcements', label: 'Notices', icon: Megaphone, count: counts.announcements },
  ]

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          ref={rootRef}
          role="dialog"
          aria-label="Notifications panel"
          initial={{ opacity: 0, y: 8, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.95 }}
          className="absolute right-0 mt-2 w-[min(22rem,calc(100vw-2rem))] rounded-xl bg-card border border-border shadow-xl p-3 z-50 text-card-foreground"
        >
          <div className="flex items-center justify-between pb-2 border-b border-border">
            <div className="flex items-center gap-1.5">
              <Bell className="h-4 w-4 text-primary" />
              <span className="font-bold text-xs text-foreground">Notifications</span>
              {/* Feed source indicator — STABILIZATION: no 'Demo' state;
                  the feed is either synced (even when empty), syncing, or
                  offline. Fabricated notifications are never shown. */}
              <span
                className={cn(
                  'inline-flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wide',
                  source === 'live'
                    ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                    : source === 'error'
                      ? 'bg-rose-500/10 text-rose-700 dark:text-rose-400'
                      : 'bg-amber-500/10 text-amber-700 dark:text-amber-400'
                )}
                title={
                  source === 'live'
                    ? 'Synced from database'
                    : source === 'error'
                      ? 'Feed unavailable — will retry automatically'
                      : 'Syncing your feed…'
                }
              >
                <span className={cn(
                  'h-1.5 w-1.5 rounded-full',
                  source === 'live'
                    ? 'bg-emerald-500 animate-pulse'
                    : source === 'error'
                      ? 'bg-rose-500'
                      : 'bg-amber-500 animate-pulse',
                )} />
                {source === 'live' ? 'Live' : source === 'error' ? 'Offline' : 'Syncing'}
              </span>
              {totalBadgeCount > 0 && (
                <span className={cn(
                  'text-[10px] font-extrabold px-1.5 py-0.2 rounded-full',
                  role === 'principal' && liveAlertCount > 0 ? 'bg-rose-500/15 text-rose-700 dark:text-rose-400' : 'bg-primary/15 text-emerald-700 dark:text-emerald-400'
                )}>
                  {totalBadgeCount} new
                </span>
              )}
            </div>
            {unreadCount > 0 && (
              <button
                onClick={onMarkAllRead}
                className="flex items-center gap-1 text-[10px] text-emerald-700 dark:text-emerald-400 hover:underline font-semibold focus-ring rounded-sm"
                aria-label="Mark all notifications as read"
              >
                <CheckCheck className="h-3 w-3" aria-hidden="true" />
                Mark all as read
              </button>
            )}
          </div>

          {/* Filter tabs — segmented control with live counts */}
          <div className="flex items-center gap-1 mt-2 mb-1 p-0.5 rounded-lg bg-muted/60" role="tablist" aria-label="Filter notifications">
            {tabDefs.map((t) => {
              const isActive = filter === t.key
              const disabled = t.count === 0 && t.key !== 'all'
              return (
                <button
                  key={t.key}
                  role="tab"
                  aria-selected={isActive}
                  disabled={disabled}
                  onClick={() => setFilter(t.key)}
                  className={cn(
                    'flex-1 flex items-center justify-center gap-1 px-1.5 py-1 rounded-md text-[10px] font-semibold transition-all',
                    isActive
                      ? 'bg-card text-foreground shadow-xs border border-border/60'
                      : 'text-muted-foreground hover:text-foreground',
                    disabled && 'opacity-40 cursor-not-allowed'
                  )}
                  title={disabled ? `No ${t.label.toLowerCase()} to show` : `Show ${t.label.toLowerCase()}`}
                >
                  <t.icon className="h-3 w-3" aria-hidden="true" />
                  <span className="hidden sm:inline">{t.label}</span>
                  {t.count > 0 && (
                    <span className={cn(
                      'text-[9px] font-bold px-1 rounded-full tabular-nums',
                      isActive ? 'bg-primary/15 text-emerald-800 dark:text-emerald-300' : 'bg-muted text-muted-foreground'
                    )}>
                      {t.count}
                    </span>
                  )}
                </button>
              )
            })}
          </div>

          {/* Live alerts summary for principal */}
          {role === 'principal' && liveAlertCount > 0 && (
            <button
              onClick={onNavigateDashboard}
              className="w-full mt-2 mb-1 rounded-lg border border-rose-500/20 bg-rose-500/5 p-2 hover:bg-rose-500/10 transition-colors text-left"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <span className="flex h-6 w-6 items-center justify-center rounded-md bg-rose-500/15 text-rose-600 dark:text-rose-400">
                    <ShieldAlert className="h-3.5 w-3.5" />
                  </span>
                  <div>
                    <p className="text-xs font-bold text-rose-600 dark:text-rose-400">Live Operations Alerts</p>
                    <p className="text-[10px] text-muted-foreground">{liveAlertCount} active alert{liveAlertCount > 1 ? 's' : ''} need attention</p>
                  </div>
                </div>
                <span className="font-display text-base font-bold text-rose-600 dark:text-rose-400">{liveAlertCount}</span>
              </div>
            </button>
          )}
          {children}
          <div className="divide-y divide-border max-h-72 overflow-y-auto mt-1 space-y-1 custom-scrollbar">
            {visibleList.length === 0 ? (
              <div className="py-8 text-center">
                <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 mb-2">
                  <Bell className="h-4 w-4 text-primary" />
                </div>
                <p className="text-xs font-bold text-foreground">
                  {source === 'error'
                    ? 'Feed unavailable'
                    : filter === 'unread'
                      ? 'Nothing unread'
                      : filter === 'messages'
                        ? 'No messages'
                        : filter === 'announcements'
                          ? 'No notices'
                          : 'You&rsquo;re all caught up'}
                </p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  {source === 'error'
                    ? 'The notification feed could not load — it will retry automatically.'
                    : filter === 'all'
                      ? 'No new notifications right now.'
                      : 'Try a different filter above.'}
                </p>
              </div>
            ) : visibleList.map((n) => {
              const notifType = (n.type || '').toLowerCase()
              const titleStr = (n.title || '').toLowerCase()
              const typeUpper = (n.type || '').toUpperCase()

              let iconNode = <Bell className="h-3.5 w-3.5" />
              let iconBg = 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'

              if (typeUpper === 'MESSAGE') {
                iconNode = <Mail className="h-3.5 w-3.5" />
                iconBg = 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300'
              } else if (typeUpper === 'TIMETABLE') {
                iconNode = <CalendarCheck className="h-3.5 w-3.5" />
                iconBg = 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
              } else if (typeUpper === 'ANNOUNCEMENT' && !titleStr.includes('payment')) {
                iconNode = <Megaphone className="h-3.5 w-3.5" />
                iconBg = 'bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300'
              } else if (notifType === 'fee' || notifType === 'payment' || titleStr.includes('fee') || titleStr.includes('payment') || titleStr.includes('received')) {
                iconNode = <IndianRupee className="h-3.5 w-3.5" />
                iconBg = 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
              } else if (notifType === 'admission' || titleStr.includes('admission') || titleStr.includes('student') || titleStr.includes('joined')) {
                iconNode = <UserPlus className="h-3.5 w-3.5" />
                iconBg = 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300'
              } else if (notifType === 'attendance' || titleStr.includes('attendance') || titleStr.includes('present') || titleStr.includes('alert')) {
                iconNode = <Clock className="h-3.5 w-3.5" />
                iconBg = 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
              } else if (notifType === 'library' || titleStr.includes('library') || titleStr.includes('book')) {
                iconNode = <BookOpen className="h-3.5 w-3.5" />
                iconBg = 'bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300'
              } else if (notifType === 'salary' || notifType === 'payroll' || titleStr.includes('salary') || titleStr.includes('payroll')) {
                iconNode = <Coins className="h-3.5 w-3.5" />
                iconBg = 'bg-teal-100 text-teal-800 dark:bg-teal-950 dark:text-teal-300'
              } else if (notifType === 'event' || notifType === 'holiday' || titleStr.includes('ptm') || titleStr.includes('event') || titleStr.includes('meeting')) {
                iconNode = <Calendar className="h-3.5 w-3.5" />
                iconBg = 'bg-teal-100 text-teal-800 dark:bg-teal-950 dark:text-teal-300'
              } else if (notifType === 'exam' || notifType === 'academic' || titleStr.includes('exam') || titleStr.includes('result')) {
                iconNode = <GraduationCap className="h-3.5 w-3.5" />
                iconBg = 'bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300'
              } else if (notifType === 'security' || notifType === 'lock' || titleStr.includes('warning') || titleStr.includes('lock')) {
                iconNode = <ShieldAlert className="h-3.5 w-3.5" />
                iconBg = 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300'
              }

              return (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => onNotificationClick(n.id)}
                  className={cn(
                    'w-full text-left p-2.5 rounded-lg hover:bg-muted cursor-pointer transition-all duration-150 flex items-start gap-2.5 group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
                    n.unread ? 'bg-primary/5 border-l-2 border-primary' : 'border-l-2 border-transparent'
                  )}
                >
                  <div className={cn('p-1.5 rounded-lg shrink-0 mt-0.5 shadow-xs transition-transform duration-150 group-hover:scale-110', iconBg)} aria-hidden="true">
                    {iconNode}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-1">
                      <p className="font-bold text-xs text-foreground truncate flex items-center gap-1.5">
                        {n.title}
                        {n.unread && (
                          <>
                            <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse shrink-0" aria-hidden="true" />
                            <span className="sr-only">(unread)</span>
                          </>
                        )}
                      </p>
                      <span className="text-[9px] text-muted-foreground font-mono shrink-0">{n.time || n.timestamp}</span>
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug line-clamp-2">{n.description || n.message}</p>
                  </div>
                </button>
              )
            })}
            {hiddenCount > 0 && (
              <p className="py-2 text-center text-[10px] text-muted-foreground font-medium">
                + {hiddenCount} more notification{hiddenCount > 1 ? 's' : ''} in this filter
              </p>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
