'use client'

import { useState, useMemo, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { io } from 'socket.io-client'
import { toast } from 'sonner'
import { Bell, Menu, Plus, Globe, Radio, Megaphone, Mail, CalendarCheck } from 'lucide-react'
import { useAuth } from '@/lib/store/auth-store'
import { useCurrentUser } from '@/lib/store/current-user-store'
import { useLiveAlerts } from '@/lib/store/live-alerts-store'
import { useLiveFeedStore } from '@/lib/store/live-feed-store'
import { readSessionToken } from '@/lib/auth-session-token'
import { signOut } from '@/lib/signout'
import { school } from '@/lib/mock/school'
// SaaS-STAGE-2A — the shell footer reflects the ACTIVE TENANT's school
// identity (falls back to the school profile for platform surfaces).
import { useActiveTenant } from '@/lib/tenant/store'
import { cn } from '@/lib/utils'
import { formatINR } from '@/lib/format'
import { ThemeToggle } from '@/components/shared/theme-toggle'
import { CommandPalette } from '@/components/shared/command-palette'
import type { ShellProps } from './app-shell/types'
import { SidebarAside } from './app-shell/sidebar-aside'
import { StudentSidebar } from '@/components/student/shell/student-sidebar'
import { NotificationsDropdown, type NotificationItem } from './app-shell/notifications-dropdown'
import { ProfileDropdownTrigger, ProfileDropdown } from './app-shell/profile-dropdown'

export type { NavGroup, NavItem } from './app-shell/types'

// Relative time formatter for notification timestamps
function formatRelativeTime(input?: string): string {
  if (!input) return ''
  const then = new Date(input).getTime()
  if (Number.isNaN(then)) return input
  const diffSec = Math.floor((Date.now() - then) / 1000)
  if (diffSec < 60) return 'just now'
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  const diffDay = Math.floor(diffHr / 24)
  if (diffDay < 7) return `${diffDay}d ago`
  return new Date(then).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

// Human labels for payment channel codes (stream toasts)
const STREAM_METHOD_LABELS: Record<string, string> = {
  UPI: 'UPI', CARD: 'Card', NETBANKING: 'Net Banking', CASH: 'Cash', CHEQUE: 'Cheque', WALLET: 'Wallet',
}

// Shape of a `school-event` frame emitted by mini-services/event-stream
interface StreamEvent {
  kind: 'payment' | 'announcement' | 'message' | 'timetable'
  schoolId: string
  title: string
  detail: string
  amount?: number
  method?: string
  /** message events: User.id of the addressee — used to mark the
   *  recipient's own inbox; others in the school see it as a broadcast. */
  recipientId?: string | null
  at: string
}

export function AppShell({ groups, activeKey, onNavigate, role, roleLabel, children, quickAction }: ShellProps) {
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [notifOpen, setNotifOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  // A11y — refs used to restore focus after Escape closes the mobile
  // drawer / profile dropdown (focus returns to the trigger that opened
  // them instead of falling to <body>).
  const menuBtnRef = useRef<HTMLButtonElement | null>(null)
  const profileBtnRef = useRef<HTMLButtonElement | null>(null)
  const [cmdOpen, setCmdOpen] = useState(false)
  const [notifList, setNotifList] = useState<NotificationItem[]>([])
  // STABILIZATION — the bell NEVER renders fabricated notifications. The
  // former static mock list ("₹9,500 from Aadhya Menon", "96 employees" …
  // from @/lib/mock/operations) is retired: 'loading' → 'live' (even an
  // honestly-empty feed, e.g. super admin) or 'error'.
  const [notifSource, setNotifSource] = useState<'live' | 'loading' | 'error'>('loading')
  // Real-time event stream status (socket.io mini-service :3003 via gateway)
  const [streamLive, setStreamLive] = useState(false)
  const { user } = useAuth()
  void roleLabel
  // SS-1 — server identity (avatar / session context) for the shell + all
  // account surfaces. One fetch per mount; settings refreshes it after
  // avatar/password changes.
  const meRefresh = useCurrentUser((s) => s.refresh)
  const me = useCurrentUser((s) => s.me)
  useEffect(() => { void meRefresh() }, [meRefresh])

  // Wire notification bell to the real DB-backed feed (unread messages + announcements).
  // Polls every 60s. A successful sync is 'live' even when the feed is EMPTY
  // (super admin intentionally has no personal inbox) — no mock fallback.
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const r = await fetch('/api/notifications-feed', { cache: 'no-store' })
        if (!r.ok || !r.headers.get('content-type')?.includes('application/json')) {
          if (!cancelled) setNotifSource('error')
          return
        }
        const j = await r.json().catch(() => null)
        // API wraps payloads as { ok, data } — unwrap defensively
        const payload = j && typeof j === 'object' && 'data' in j ? (j as { data?: { feed?: unknown[] } }).data : j
        const feedArr = payload && Array.isArray(payload.feed) ? payload.feed : []
        if (cancelled) return
        const mapped: NotificationItem[] = feedArr.map((f: { id: string; type?: string; title?: string; description?: string; timestamp?: string; read?: boolean }) => ({
          id: f.id,
          type: f.type,
          title: f.title,
          description: f.description,
          time: formatRelativeTime(f.timestamp),
          unread: f.read === false, // respect persisted read state from the API
        }))
        setNotifList(mapped)
        setNotifSource('live')
      } catch {
        if (!cancelled) setNotifSource('error')
      }
    }
    load()
    const timer = setInterval(load, 60_000)
    return () => { cancelled = true; clearInterval(timer) }
  }, [])

  // ─── Real-time event stream (socket.io mini-service :3003 via gateway) ───
  // Resolves the viewer's school scope + DB user id from the server session
  // (SS-1: the current-user store — shared with Settings/avatar surfaces),
  // then subscribes. Super admins (schoolId = null) receive the platform-
  // wide stream; school-scoped roles only see events for their own school.
  // Direct messages are only surfaced to their addressee (recipientId filter).
  const streamScopeRef = useRef<string | null | undefined>(undefined) // undefined = resolving
  const streamUserIdRef = useRef<string | null>(null)

  useEffect(() => {
    // Wait for the server identity BEFORE connecting: the school scope
    // filter depends on it (connecting early would briefly accept events
    // from every school). me === null while resolving → no socket yet.
    if (!user || !me) return
    let _cancelled = false
    let socket: ReturnType<typeof io> | null = null

    streamUserIdRef.current = me.id
    streamScopeRef.current = me.schoolId ?? null
    socket = io('/?XTransformPort=3003', {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 8,
      reconnectionDelay: 1500,
      timeout: 10000,
      // Phase 1 — the stream service AUTHENTICATES the handshake: present
      // the dev-preview bearer token (the first-party cookie flows
      // automatically on same-origin requests). No valid session → the
      // server refuses the connection.
      auth: { token: readSessionToken() ?? undefined },
    })
    socket.on('connect', () => { setStreamLive(true); useLiveFeedStore.getState().setConnected(true) })
    socket.on('disconnect', () => { setStreamLive(false); useLiveFeedStore.getState().setConnected(false) })
    socket.on('connect_error', () => { setStreamLive(false); useLiveFeedStore.getState().setConnected(false) })
    socket.on('school-event', (evt: StreamEvent) => {
          // Scope filter — super admins see the whole platform
          const scope = streamScopeRef.current
          if (scope && evt.schoolId && evt.schoolId !== scope) return

          const isPayment = evt.kind === 'payment'
          const isMessage = evt.kind === 'message'
          const isTimetable = evt.kind === 'timetable'
          // Direct messages are addressed to one user — only the addressee's
          // bell/toast shows them (others in the school skip the frame).
          if (isMessage && evt.recipientId && evt.recipientId !== streamUserIdRef.current) return

          const item: NotificationItem = {
            id: `stream-${evt.kind}-${evt.at}-${Math.random().toString(36).slice(2, 7)}`,
            type: isPayment ? 'PAYMENT' : isMessage ? 'MESSAGE' : isTimetable ? 'TIMETABLE' : 'ANNOUNCEMENT',
            title: isPayment ? 'Fee payment received' : isTimetable ? 'Timetable updated' : evt.title,
            description: isPayment && evt.amount
              ? `${evt.detail} · ${formatINR(evt.amount)} via ${STREAM_METHOD_LABELS[(evt.method || '').toUpperCase()] ?? evt.method ?? '—'}`
              : evt.detail,
            time: 'just now',
            timestamp: evt.at,
            unread: true,
          }
          setNotifList((prev) => [item, ...prev].slice(0, 30))

          // Mirror the same frame into the live-feed ring so dashboard
          // surfaces (principal Live Activity ticker) can render it without
          // opening a second socket connection.
          useLiveFeedStore.getState().push({
            kind: evt.kind,
            title: item.title ?? evt.title,
            detail: item.description ?? evt.detail,
            amount: evt.amount,
            method: evt.method,
            at: evt.at,
          })

          // Premium live toast — accent stripe + icon chip + LIVE pill
          toast.custom(
            (t) => (
              <div
                className={cn(
                  'relative overflow-hidden w-[min(21rem,calc(100vw-2rem))] flex items-start gap-3 rounded-xl border bg-card/95 backdrop-blur p-3 pl-4 shadow-premium-lg transition-opacity',
                  isPayment ? 'border-emerald-500/30' : isMessage ? 'border-sky-500/30' : isTimetable ? 'border-amber-500/40' : 'border-violet-500/30',
                  t ? 'opacity-100' : 'opacity-0'
                )}
              >
                <span className={cn('absolute left-0 top-0 bottom-0 w-1', isPayment ? 'bg-emerald-500' : isMessage ? 'bg-sky-500' : isTimetable ? 'bg-amber-500' : 'bg-violet-500')} />
                <span className={cn(
                  'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
                  isPayment
                    ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                    : isMessage
                      ? 'bg-sky-500/15 text-sky-600 dark:text-sky-400'
                      : isTimetable
                        ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                        : 'bg-violet-500/15 text-violet-600 dark:text-violet-400'
                )}>
                  {isPayment ? <span className="font-bold text-xs">₹</span> : isMessage ? <Mail className="h-4 w-4" /> : isTimetable ? <CalendarCheck className="h-4 w-4" /> : <Megaphone className="h-4 w-4" />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-xs font-bold text-foreground truncate">{item.title}</p>
                    <span className="flex items-center gap-1 rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-emerald-700 dark:text-emerald-400 shrink-0">
                      <Radio className="h-2 w-2 animate-pulse" aria-hidden="true" /> Live
                    </span>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">{item.description}</p>
                </div>
              </div>
            ),
            { duration: 5000 }
          )
        })

    return () => {
      _cancelled = true
      socket?.close()
      socket = null
    }
    // me identity fields (not the object) — avoids reconnect churn when the
    // store refreshes for avatar/session updates.
  }, [user?.id, me?.id, me?.schoolId])

  const flatItems = useMemo(() => groups.flatMap((g) => g.items), [groups])
  const activeItem = flatItems.find((i) => i.key === activeKey)
  const unreadCount = notifList.filter((n) => n.unread).length

  // For principal role, also count live alerts in the bell badge
  const liveAlertCount = useLiveAlerts((s) => s.alerts.length)
  const totalBadgeCount = role === 'principal' ? unreadCount + liveAlertCount : unreadCount

  // ⌘K / Ctrl+K to open command palette
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setCmdOpen((o) => !o)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // A11y — Escape closes the mobile navigation drawer and returns focus to
  // the hamburger trigger (the drawer's own contents stay keyboard-focusable
  // while open: <main> is inert while the drawer overlays it, below). The
  // focus restore is deferred one frame so it happens AFTER React removes
  // the inert attribute (focusing an element inside an inert subtree is a
  // silent no-op).
  useEffect(() => {
    if (!mobileOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMobileOpen(false)
        requestAnimationFrame(() => requestAnimationFrame(() => menuBtnRef.current?.focus()))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mobileOpen])

  // A11y — Escape closes the profile dropdown (it previously only closed
  // via its backdrop click, which keyboard users could not reach).
  useEffect(() => {
    if (!profileOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setProfileOpen(false)
        profileBtnRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [profileOpen])

  const persistRead = (id: string, type?: string) => {
    // Fire-and-forget persistence for live-feed items
    fetch('/api/notifications-feed', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, type }),
    }).catch(() => {})
  }

  const handleMarkAllRead = () => {
    if (notifSource === 'live') {
      notifList.filter((n) => n.unread).forEach((n) => persistRead(n.id, n.type))
    }
    setNotifList((prev) => prev.map((n) => ({ ...n, unread: false })))
  }

  const handleNotificationClick = (id: string) => {
    const target = notifList.find((n) => n.id === id)
    if (target && notifSource === 'live') persistRead(id, target.type)
    setNotifList((prev) =>
      prev.map((n) => (n.id === id ? { ...n, unread: false } : n))
    )
    setNotifOpen(false)
    // Tour-application announcements deep-link students straight to the form
    // (Applications & Forms) instead of the generic Communication module.
    const isTourAnnouncement =
      !!target?.title && /— applications open$/i.test(target.title.trim())
    if (role === 'student' && isTourAnnouncement) {
      onNavigate('applications')
      return
    }
    // Students have no 'communication' module — route their bell to the
    // dedicated student Notifications module (was a dead-end key).
    if (role === 'student') {
      onNavigate('notifications')
      return
    }
    onNavigate('communication')
  }

  const bellLabel = `Notifications${totalBadgeCount > 0 ? `, ${totalBadgeCount > 9 ? '9+' : totalBadgeCount} unread` : ''}${streamLive ? ' — live event stream connected' : ''}`

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background text-foreground">
      {/* A11y — skip link: first tabbable element in the shell; jumps over
          the ~24 sidebar controls straight to the module content. Hidden by
          an off-screen translate (not sr-only — not-sr-only's position:static
          fights focus:fixed) and slides into view when focused. Inert while
          the mobile drawer is open so the drawer's focus trap stays sealed
          (focusing inert <main> would be a silent no-op anyway). */}
      <a
        href="#main-content"
        inert={mobileOpen}
        className="fixed left-4 top-4 z-[200] -translate-y-24 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-lg outline-none transition-transform duration-150 focus:translate-y-0"
      >
        Skip to main content
      </a>

      {/* Sidebar Overlay */}
      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setMobileOpen(false)}
            className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm lg:hidden"
          />
        )}
      </AnimatePresence>

      {/* Student Role gets its OWN rebuilt sidebar (premium green
          identity, personal workspace structure); other roles keep the
          shared one. */}
      {role === 'student' ? (
        <StudentSidebar
          collapsed={collapsed}
          setCollapsed={setCollapsed}
          mobileOpen={mobileOpen}
          setMobileOpen={setMobileOpen}
          cmdOpen={cmdOpen}
          setCmdOpen={setCmdOpen}
          groups={groups}
          activeKey={activeKey}
          onNavigate={onNavigate}
        />
      ) : (
        <SidebarAside
          collapsed={collapsed}
          setCollapsed={setCollapsed}
          mobileOpen={mobileOpen}
          setMobileOpen={setMobileOpen}
          cmdOpen={cmdOpen}
          setCmdOpen={setCmdOpen}
          groups={groups}
          activeKey={activeKey}
          onNavigate={onNavigate}
          role={role}
        />
      )}

      {/* Main Content Area — inert while the mobile drawer overlays it so
          Tab/character focus stays inside the drawer (A11y focus trap). */}
      <main
        id="main-content"
        inert={mobileOpen}
        className="flex-1 flex flex-col min-w-0 bg-background overflow-hidden"
      >
        {/* Header */}
        <header className="h-16 bg-card border-b border-border flex items-center justify-between px-6 lg:px-8 shrink-0">
          <div className="flex items-center gap-3">
            <button
              ref={menuBtnRef}
              onClick={() => setMobileOpen(true)}
              aria-label="Open navigation menu"
              aria-expanded={mobileOpen}
              aria-controls="app-sidebar"
              className="lg:hidden flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground shrink-0 hover:bg-muted focus-ring transition-colors"
            >
              <Menu className="h-5 w-5" aria-hidden="true" />
            </button>
            <h1 className="text-base font-semibold text-foreground truncate">
              {activeItem?.label ?? 'Dashboard'}
            </h1>
          </div>

          <div className="flex items-center gap-4 sm:gap-6">
            {quickAction && (
              <button
                onClick={quickAction.onClick}
                className="hidden sm:flex items-center gap-2 bg-primary hover:bg-primary/90 text-primary-foreground px-4 py-2 rounded-lg text-xs font-semibold shadow-xs transition-colors"
              >
                {quickAction.icon ?? <Plus className="h-4 w-4" />}
                {quickAction.label}
              </button>
            )}

            {/* Theme Toggle */}
            <ThemeToggle />

            {/* Notifications */}
            <div className="relative">
              <button
                onClick={() => setNotifOpen((o) => !o)}
                aria-label={bellLabel}
                aria-expanded={notifOpen}
                className="relative flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground transition-colors cursor-pointer focus-ring"
              >
                <Bell className="h-5 w-5" aria-hidden="true" />
                {/* realtime stream indicator — emerald pulsing dot bottom-right */}
                {streamLive && (
                  <span
                    className="absolute bottom-0.5 right-0.5 flex h-2 w-2"
                    title="Live event stream connected"
                    aria-hidden="true"
                  >
                    <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60 animate-ping" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500 ring-1 ring-card" />
                  </span>
                )}
                {totalBadgeCount > 0 && (
                  <span
                    aria-hidden="true"
                    className={cn(
                      'absolute -top-1 -right-1 min-w-4 h-4 px-1 rounded-full border-2 border-card flex items-center justify-center text-[10px] font-bold text-white',
                      role === 'principal' && liveAlertCount > 0 ? 'bg-red-600 animate-pulse' : 'bg-red-600'
                    )}
                  >
                    {totalBadgeCount > 9 ? '9+' : totalBadgeCount}
                  </span>
                )}
              </button>

              <NotificationsDropdown
                open={notifOpen}
                onClose={() => setNotifOpen(false)}
                notifList={notifList}
                onMarkAllRead={handleMarkAllRead}
                onNotificationClick={handleNotificationClick}
                onNavigateDashboard={() => { setNotifOpen(false); onNavigate('dashboard') }}
                role={role}
                liveAlertCount={liveAlertCount}
                totalBadgeCount={totalBadgeCount}
                unreadCount={unreadCount}
                source={notifSource}
              >
                {/* realtime stream status — shown for every role when connected */}
                {streamLive && (
                  <div className="mx-1 mb-2 rounded-lg border border-emerald-500/25 bg-emerald-500/5 px-2.5 py-2">
                    <p className="text-[10px] font-bold text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5">
                      <span className="relative flex h-2 w-2">
                        <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60 animate-ping" />
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                      </span>
                      Live event stream connected
                    </p>
                    <p className="text-[10px] text-muted-foreground mt-0.5 leading-snug">
                      {role === 'superadmin'
                        ? 'Platform-wide — payments & announcements from every tenant arrive instantly.'
                        : 'Payments & announcements from your school arrive instantly — no refresh needed.'}
                    </p>
                  </div>
                )}
                {role === 'superadmin' && (
                  <div className="mx-1 mb-2 rounded-lg border border-violet-500/20 bg-violet-500/5 px-2.5 py-2">
                    <p className="text-[10px] font-bold text-violet-600 dark:text-violet-400 flex items-center gap-1">
                      <Globe className="h-3 w-3" /> Platform scope
                    </p>
                    <p className="text-[10px] text-muted-foreground mt-0.5 leading-snug">
                      Super admins manage tenants across schools — no personal school inbox. Tenant activity is monitored from the Schools module.
                    </p>
                  </div>
                )}
              </NotificationsDropdown>
            </div>

            {/* User Profile Dropdown */}
            <div className="relative">
              <ProfileDropdownTrigger
                user={user}
                open={profileOpen}
                onToggle={() => { setProfileOpen((o) => !o); setNotifOpen(false) }}
                buttonRef={profileBtnRef}
              />
              <ProfileDropdown
                open={profileOpen}
                onClose={() => setProfileOpen(false)}
                user={user}
                role={role}
                onNavigateSettings={() => { onNavigate('settings'); setProfileOpen(false) }}
                // SaaS-STAGE-2A — super admins jump straight back to the control plane.
                onOpenPlatform={role === 'superadmin' ? () => onNavigate('overview') : undefined}
                onLogout={() => { setProfileOpen(false); void signOut() }}
              />
            </div>
          </div>
        </header>

        {/* Page Content — flex column so the footer pins to the bottom of
            the viewport on short pages (mt-auto) and is pushed down
            naturally when content is taller than one screen. */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8 custom-scrollbar flex flex-col [&>*]:min-w-0">
          {children}
          {/* Sticky footer */}
          <footer className="mt-auto pt-6 border-t border-border text-center text-[11px] text-muted-foreground font-medium tracking-wide">
            <p>
              &copy; {new Date().getFullYear()} SCHOLARIO-OS &middot; Enterprise School ERP &middot;
              <span className="text-emerald-700 dark:text-emerald-400 ml-1"><FooterSchoolName fallback={school.name} /></span>
              &middot; All systems operational
            </p>
          </footer>
        </div>
      </main>

      <CommandPalette open={cmdOpen} onOpenChange={setCmdOpen} groups={groups} role={role} onNavigate={onNavigate} />
    </div>
  )
}

/**
 * SaaS-STAGE-2A — footer school identity: school panels show the ACTIVE
 * tenant's school name; the platform control plane shows its own label.
 */
function FooterSchoolName({ fallback }: { fallback: string }) {
  const role = useAuth((s) => s.user?.role)
  const tenant = useActiveTenant()
  if (role === 'superadmin') return 'Platform Control Plane'
  return tenant?.name ?? fallback
}
