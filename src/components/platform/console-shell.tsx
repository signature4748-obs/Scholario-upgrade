'use client'

// ============================================================
// ConsoleShell — the /platform control-plane chrome
// ------------------------------------------------------------
// SUPER-ADMIN SCROLL + DESIGN FIX (2026-10) — the shell now runs the
// school AppShell's PROVEN scroll model instead of the document
// scroll model that produced the scroll trap (audit §Issue 1):
//   · fixed-viewport shell: `.app-shell-vh` (100dvh + 100vh fallback)
//     with `overflow-hidden` — the DOCUMENT never scrolls on a console
//     page, so it can never strand the top;
//   · the sidebar is IN-FLOW (no `fixed inset-y-0`): it participates
//     in the shell's own height instead of floating over a scrolling
//     document;
//   · a PINNED h-16 header on EVERY width (the old mobile-only sticky
//     header is gone — desktop had no header at all);
//   · exactly ONE inner content scroller (`data-console-scroll`) —
//     every "back to top" scrolls THAT element instantly
//     (lib/platform/console-scroll.ts), and the footer lives INSIDE
//     it (mt-auto) so it never floats.
//
// And it speaks the PRINCIPAL panel's design language (audit
// §Issue 3) while keeping the console's own information architecture:
//   · h-16 sidebar header: slate-900 "S" tile + SCHOLARIO wordmark +
//     a quiet "Control Plane" line (was: h-20 teal Cloud tile);
//   · 260px/72px sidebar with h-8 nav rows — borderless
//     `bg-primary/10 text-primary` active state (was: bordered teal
//     pills, py-2 px-3 text-sm rows);
//   · the account controls live in a profile dropdown in the pinned
//     header (principal pattern: identity + role chip + sign-out);
//     the sidebar foot is a QUIET identity block;
//   · a quiet in-scroller footer.
// Preserved from the control-plane IA: grouped navigation (Revenue /
// Oversight labels since the 2026-10-30 redesign), permission-filtered
// entries (hiding is
// UX; the server authorizes every route), the localStorage-persisted
// desktop collapse, the step-up pill (dormant while platform MFA is
// stood down), and the mobile drawer (full labels, Escape + focus
// management, close-on-navigation).
// ============================================================

import React, { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import {
  LayoutDashboard,
  Building2,
  LifeBuoy,
  ScrollText,
  Megaphone,
  Settings2,
  Users,
  MonitorSmartphone,
  LogOut,
  ShieldCheck,
  Menu,
  X,
  Wallet,
  Package,
  CreditCard,
  KeyRound,
  BookOpenText,
  ServerCrash,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Activity,
} from 'lucide-react'
import { usePlatformSession, platformApi, type PlatformApiError } from './platform-client'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

interface NavItem {
  href: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  permission?: string
}

/** GROUPED IA (PAYMENTS & GATEWAYS REDESIGN) — the subscription cluster is
 *  first-class: Subscriptions (control centre) · Plans & Pricing ·
 *  Payments & Gateways · Access Codes, and Reports & Audit joins the
 *  oversight group. Groups are LABELLED sections in the sidebar
 *  (labels hidden while collapsed — the icons stay the full links). */
const NAV_GROUPS: Array<{ label: string | null; items: NavItem[] }> = [
  {
    label: null,
    items: [
      { href: '/platform', label: 'Overview', icon: LayoutDashboard },
      { href: '/platform/schools', label: 'Schools', icon: Building2, permission: 'schools.read' },
    ],
  },
  {
    label: 'Revenue',
    items: [
      { href: '/platform/subscriptions', label: 'Subscriptions', icon: Wallet, permission: 'billing.manage' },
      { href: '/platform/plans', label: 'Plans & Pricing', icon: Package, permission: 'billing.manage' },
      { href: '/platform/payments', label: 'Payments & Gateways', icon: CreditCard, permission: 'billing.manage' },
      { href: '/platform/codes', label: 'Access Codes', icon: KeyRound, permission: 'billing.manage' },
    ],
  },
  {
    label: null,
    items: [
      { href: '/platform/admins', label: 'Users & Access', icon: Users, permission: 'admins.manage' },
      { href: '/platform/support', label: 'Support', icon: LifeBuoy, permission: 'support.access' },
      { href: '/platform/announcements', label: 'Announcements', icon: Megaphone, permission: 'announcements.manage' },
    ],
  },
  {
    label: 'Oversight',
    items: [
      { href: '/platform/reports', label: 'Reports & Audit', icon: ScrollText, permission: 'billing.manage' },
      { href: '/platform/audit', label: 'Audit Log', icon: BookOpenText, permission: 'audit.read' },
    ],
  },
  {
    label: null,
    items: [
      { href: '/platform/settings', label: 'Settings', icon: Settings2, permission: 'settings.manage' },
      { href: '/platform/sessions', label: 'My Sessions', icon: MonitorSmartphone },
      { href: '/platform/operations', label: 'Operations', icon: Activity, permission: 'ops.read' },
    ],
  },
]

/** localStorage key for the desktop collapsed-sidebar preference. */
const SIDEBAR_PREF_KEY = 'scholario.platform.sidebar'

/** Sidebar widths — principal AppShell tokens (260px / 72px). */
const SIDEBAR_W_EXPANDED = 'w-[260px]'
const SIDEBAR_W_COLLAPSED = 'w-[72px]'

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()
}

function roleLabel(isRoot: boolean): string {
  return isRoot ? 'Root admin' : 'Platform admin'
}

/** One sidebar link — the principal panel's nav row pattern: borderless
 *  `bg-primary/10 text-primary` active state, h-8 rows, quiet icons.
 *  `collapsed` renders the icon-only compact form — the accessible name
 *  stays the full label (aria-label + title). */
function SidebarLink({ item, pathname, collapsed }: { item: NavItem; pathname: string; collapsed: boolean }) {
  const active = pathname === item.href || (item.href !== '/platform' && pathname.startsWith(item.href))
  const Icon = item.icon
  return (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      aria-label={collapsed ? item.label : undefined}
      title={collapsed ? item.label : undefined}
      className={cn(
        'flex items-center gap-2.5 w-full h-8 rounded-md px-2.5 text-[13px] transition-colors focus-ring',
        collapsed && 'justify-center px-0',
        active
          ? 'bg-primary/10 text-primary font-medium'
          : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
      )}
    >
      <span
        className={cn('shrink-0 transition-colors [&>svg]:h-4 [&>svg]:w-4', active ? 'text-primary' : 'text-slate-400')}
        aria-hidden="true"
      >
        <Icon />
      </span>
      {!collapsed && <span className="truncate">{item.label}</span>}
    </Link>
  )
}

/** Live countdown for the step-up window ("4m 32s"). */
function useCountdown(target: string | null): string | null {
  const [, force] = useState(0)
  useEffect(() => {
    if (!target) return
    const t = setInterval(() => force((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [target])
  if (!target) return null
  const ms = new Date(target).getTime() - Date.now()
  if (ms <= 0) return null
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  return `${m}:${String(s % 60).padStart(2, '0')}`
}

function StepUpDialog({
  open,
  onOpenChange,
  onVerified,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  onVerified: () => void
}) {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    if (!/^\d{6}$/.test(code)) {
      setError('Enter the 6-digit code from your authenticator')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await platformApi('/api/platform/auth/step-up', {
        method: 'POST',
        body: JSON.stringify({ code }),
      })
      toast.success('Step-up verified — destructive actions unlocked for 10 minutes')
      setCode('')
      onOpenChange(false)
      onVerified()
    } catch (e) {
      const err = e as PlatformApiError
      setError(err.error || 'Verification failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-white border-slate-200 text-slate-900 sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-slate-900">
            <ShieldCheck className="h-4 w-4 text-amber-600" aria-hidden="true" />
            Step-up authentication
          </DialogTitle>
          <DialogDescription className="text-slate-500">
            Destructive control-plane actions require a recent multi-factor verification.
            Enter the current code from your authenticator app to open a 10-minute window.
          </DialogDescription>
        </DialogHeader>
        <Input
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="123456"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit()
          }}
          autoFocus
          aria-label="Authenticator code"
          className="bg-white border-slate-200 text-slate-900 placeholder:text-slate-400 text-lg tracking-[0.4em] text-center font-mono"
        />
        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="border-slate-300 bg-transparent text-slate-700 hover:bg-slate-100"
          >
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={busy} className="bg-teal-600 hover:bg-teal-700 text-white">
            {busy ? 'Verifying…' : 'Verify'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * ConsoleUnavailable — the session gate's retryable failure state.
 *
 * Rendered when /api/platform/auth/me could not be served (database or
 * control-plane failure, network exception) AND no session is loaded.
 * The operator's session may still be valid server-side — so this is a
 * retry surface, never a redirect to login and never a bare skeleton.
 */
function ConsoleUnavailable({ onRetry, onSignOut }: { onRetry: () => void; onSignOut: () => void }) {
  const [busy, setBusy] = useState(false)
  return (
    <div role="alert" className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100">
            <ServerCrash className="h-5 w-5 text-slate-500" aria-hidden="true" />
          </div>
          <h1 className="text-lg font-semibold text-slate-900">Control plane unavailable</h1>
        </div>
        <p className="mt-3 text-sm text-slate-600">
          The platform session service could not be reached. Your session may still be valid —
          retry once the service responds. Nothing was changed.
        </p>
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <Button
            onClick={() => {
              setBusy(true)
              onRetry()
              // Busy is cleared by the next render (success unmounts this
              // state); a timeout keeps the button honest on a slow retry.
              setTimeout(() => setBusy(false), 10_000)
            }}
            disabled={busy}
            className="bg-teal-600 hover:bg-teal-700 text-white"
          >
            <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
            {busy ? 'Retrying…' : 'Retry'}
          </Button>
          <Button variant="outline" onClick={onSignOut} className="border-slate-300 bg-transparent text-slate-700 hover:bg-slate-100">
            <LogOut className="mr-2 h-4 w-4" aria-hidden="true" />
            Sign out
          </Button>
        </div>
      </div>
    </div>
  )
}

/** The account dropdown in the pinned header — the principal panel's
 *  profile-dropdown pattern: identity card (name + email + role chip)
 *  and the sign-out action. */
function HeaderAccount({ name, email, isRoot, onSignOut }: { name: string; email: string; isRoot: boolean; onSignOut: () => void }) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement | null>(null)

  // A11y — Escape closes the menu from the keyboard and focus returns
  // to the trigger (same contract as the school shell's dropdown).
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        triggerRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <div className="relative shrink-0">
      <button
        ref={triggerRef}
        onClick={() => setOpen((o) => !o)}
        aria-label={`Account menu — ${name}`}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex items-center gap-3 pl-4 border-l border-slate-200 rounded-md hover:opacity-90 transition-opacity cursor-pointer group focus-ring"
        title="User Menu"
      >
        <div className="text-right hidden sm:block">
          <p className="text-xs font-semibold text-slate-900 leading-none group-hover:text-primary transition-colors truncate max-w-[12rem]">
            {name}
          </p>
          <p className="text-[10px] text-slate-500 mt-1 truncate max-w-[12rem]">{email}</p>
        </div>
        <div className="w-8 h-8 rounded-full bg-primary/10 text-primary font-semibold border border-slate-200 flex items-center justify-center text-xs shrink-0">
          {initials(name)}
        </div>
        <ChevronDown className="h-3.5 w-3.5 text-slate-400 group-hover:text-slate-700 transition-colors" aria-hidden="true" />
      </button>
      <AnimatePresence>
        {open && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden="true" />
            <motion.div
              role="dialog"
              aria-label="Account menu"
              initial={{ opacity: 0, y: 8, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.95 }}
              transition={{ duration: 0.15 }}
              className="absolute right-0 mt-2 w-64 rounded-xl bg-white border border-slate-200 shadow-xl p-2 z-50 text-slate-900"
            >
              <div className="p-3 border-b border-slate-200 bg-slate-50 rounded-lg mb-1">
                <p className="font-bold text-xs text-slate-900">{name}</p>
                <p className="text-[11px] text-slate-500 truncate">{email}</p>
                <div className="mt-1.5">
                  <span className="inline-block text-[9px] font-extrabold px-2 py-0.5 rounded bg-primary/15 text-primary uppercase tracking-wider">
                    {roleLabel(isRoot)}
                  </span>
                </div>
              </div>
              <div className="py-1">
                <button
                  onClick={() => {
                    setOpen(false)
                    onSignOut()
                  }}
                  className="flex items-center gap-2 w-full px-2.5 py-1.5 text-xs text-red-600 hover:bg-red-50 rounded-md transition-colors font-medium text-left focus-ring cursor-pointer"
                >
                  <LogOut className="h-3.5 w-3.5 text-red-600" aria-hidden="true" />
                  Sign Out
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}

export function ConsoleShell({ children }: { children: React.ReactNode }) {
  const { me, loading, unavailable, can, refresh, logout } = usePlatformSession()
  const pathname = usePathname()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [stepUpOpen, setStepUpOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(false)

  // Drawer a11y — Escape closes the drawer; focus lands INSIDE it on
  // open (close button) and returns to the hamburger when it closes.
  // The trigger node is captured INSIDE the effect (the ref value may
  // be reassigned by the time the cleanup runs — react-hooks lint
  // contract).
  const drawerCloseBtnRef = useRef<HTMLButtonElement | null>(null)
  const hamburgerBtnRef = useRef<HTMLButtonElement | null>(null)
  useEffect(() => {
    if (!drawerOpen) return
    drawerCloseBtnRef.current?.focus()
    const trigger = hamburgerBtnRef.current
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDrawerOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      trigger?.focus()
    }
  }, [drawerOpen])

  // Restore the desktop sidebar preference (client-only — the SSR
  // render always starts expanded to avoid hydration mismatches).
  useEffect(() => {
    try {
      if (window.localStorage.getItem(SIDEBAR_PREF_KEY) === 'collapsed') setCollapsed(true)
    } catch {
      /* preference unavailable — stay expanded */
    }
  }, [])

  const toggleCollapsed = () => {
    setCollapsed((c) => {
      try {
        window.localStorage.setItem(SIDEBAR_PREF_KEY, c ? 'expanded' : 'collapsed')
      } catch {
        /* ignore persistence failures */
      }
      return !c
    })
  }

  const countdown = useCountdown(me?.session.stepUpUntil ?? null)
  const stepUpActive = Boolean(me?.session.stepUpActive && countdown)
  // PRODUCT-DIRECTION RESET (Part 1) — with platform TOTP stood down
  // (mfa-config) there is no second factor, so the step-up pill and its
  // TOTP dialog are hidden entirely (no dead-end authenticator prompt).
  // The server-side step-up gate is dormant under the same flag.
  const mfaEnabled = Boolean(me?.mfaEnabled)

  // Close the mobile drawer on navigation.
  useEffect(() => {
    setDrawerOpen(false)
  }, [pathname])

  // Full-screen boot skeleton until the session resolves (401 redirect
  // happens inside the provider). A 5xx/network failure resolves to the
  // explicit unavailable state below — never an unlabelled skeleton.
  if (loading || (!me && !unavailable)) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="h-12 w-12 rounded-2xl bg-slate-200 animate-pulse" />
      </div>
    )
  }

  if (!me) {
    // Passed the gate above ⇒ !me implies `unavailable` (auth/me 5xx/network).
    return <ConsoleUnavailable onRetry={() => void refresh()} onSignOut={() => void logout()} />
  }

  // (Grouped navigation is computed inside renderNavLinks from NAV_GROUPS.)

  /** Sidebar header — the principal pattern: slate-900 "S" tile +
   *  SCHOLARIO wordmark + a quiet "Control Plane" line. `collapsed`
   *  keeps only the tile + collapse control. */
  const renderSidebarHeader = (compact: boolean) => (
    <div className={cn('h-16 shrink-0 border-b border-slate-200 flex items-center gap-2 px-3', compact && 'justify-center')}>
      <Link
        href="/platform"
        aria-label="SCHOLARIO Control Plane — back to Overview"
        title="Back to Overview"
        className="flex min-w-0 flex-1 items-center gap-2.5 focus-ring rounded-md"
      >
        <div
          className="w-8 h-8 rounded-lg bg-slate-900 flex items-center justify-center font-bold text-white shrink-0 text-sm"
          aria-hidden="true"
        >
          S
        </div>
        {!compact && (
          <div className="flex min-w-0 flex-col overflow-hidden">
            <span className="text-sm font-bold tracking-tight text-slate-900 leading-none">SCHOLARIO</span>
            <span className="mt-1 text-[11px] text-slate-500 truncate leading-none">Control Plane</span>
          </div>
        )}
      </Link>
      {!compact && (
        <button
          onClick={toggleCollapsed}
          className="hidden lg:flex p-1.5 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors shrink-0 cursor-pointer focus-ring"
          title="Collapse sidebar"
          aria-label="Collapse sidebar"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        </button>
      )}
    </div>
  )

  /** The compact expand control shown while collapsed. */
  const renderCollapsedExpand = () => (
    <button
      onClick={toggleCollapsed}
      className="flex p-1.5 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors shrink-0 cursor-pointer focus-ring"
      title="Expand sidebar"
      aria-label="Expand sidebar"
    >
      <ChevronRight className="h-4 w-4" aria-hidden="true" />
    </button>
  )

  /** Navigation links — labelled groups, principal row pattern. The
   *  Audit Log item is hidden for billing managers who cannot read the
   *  audit (the Reports & Audit page's audit tab still respects the
   *  audit.read gate server-side); the /platform/audit route itself
   *  stays alive for deep links. */
  const renderNavLinks = (compact: boolean) => {
    const visibleGroups = NAV_GROUPS.map((g) => ({
      label: g.label,
      items: g.items.filter((item) => !item.permission || can(item.permission)),
    })).filter((g) => g.items.length > 0)
    return (
      <nav aria-label="Platform navigation" className="flex-1 px-2.5 py-2.5 overflow-y-auto no-scrollbar">
        {visibleGroups.map((group, gi) => (
          <div key={group.label ?? `g${gi}`} className={gi > 0 ? 'mt-3' : undefined}>
            {group.label && !compact && (
              <p className="px-2.5 pb-1 text-[10px] font-semibold uppercase tracking-widest text-slate-400">{group.label}</p>
            )}
            {group.label && compact && <div className="mx-auto mb-2 mt-1 h-px w-8 bg-slate-200" aria-hidden="true" />}
            <ul className="space-y-0.5">
              {group.items.map((item) => (
                <li key={item.href} className={compact ? 'flex justify-center' : undefined}>
                  <SidebarLink item={item} pathname={pathname} collapsed={compact} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
    )
  }

  /** The QUIET identity block at the sidebar foot (principal pattern):
   *  avatar initials + name + role. The account ACTIONS (sign-out)
   *  live in the header dropdown; this block is the always-visible
   *  identity anchor. */
  const renderIdentityBlock = (compact: boolean) => (
    <div className={cn('shrink-0 border-t border-slate-200', compact ? 'flex justify-center py-2.5' : 'px-3 py-2.5')}>
      <div
        className={cn('flex items-center overflow-hidden', compact ? 'justify-center' : 'gap-2.5')}
        title={compact ? `${me.admin.name} · ${roleLabel(me.admin.isRoot)}` : undefined}
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary" aria-hidden="true">
          {initials(me.admin.name)}
        </span>
        {!compact && (
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-semibold text-slate-900">{me.admin.name}</span>
            <span className="block truncate text-[10px] text-slate-500">{roleLabel(me.admin.isRoot)}</span>
          </span>
        )}
      </div>
    </div>
  )

  return (
    <div className="app-shell-vh flex overflow-hidden bg-slate-50 text-slate-900 selection:bg-emerald-100 selection:text-emerald-900">
      {/* Desktop sidebar — IN-FLOW (never `fixed`): it shares the
          shell's height; 260px expanded, 72px icon-only when collapsed.
          The scroller below can therefore never slide under it. */}
      <aside
        className={cn(
          'hidden lg:flex flex-col shrink-0 border-r border-slate-200 bg-white transition-[width] duration-200',
          collapsed ? SIDEBAR_W_COLLAPSED : SIDEBAR_W_EXPANDED,
        )}
      >
        {renderSidebarHeader(collapsed)}
        {collapsed && <div className="flex justify-center pt-2">{renderCollapsedExpand()}</div>}
        {renderNavLinks(collapsed)}
        {renderIdentityBlock(collapsed)}
      </aside>

      {/* Mobile drawer — always full labels (never the collapsed form) */}
      {drawerOpen && (
        <div className="lg:hidden fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Platform navigation">
          <div className="absolute inset-0 bg-slate-900/40" onClick={() => setDrawerOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-72 max-w-[85vw] bg-white border-r border-slate-200 flex flex-col shadow-xl">
            <div className="h-16 shrink-0 border-b border-slate-200 flex items-center justify-between px-3">
              {/* Mobile drawer logo — same canonical Overview target. */}
              <Link
                href="/platform"
                aria-label="SCHOLARIO Control Plane — back to Overview"
                className="flex items-center gap-2.5 focus-ring rounded-md"
              >
                <div className="w-8 h-8 rounded-lg bg-slate-900 flex items-center justify-center font-bold text-white text-sm" aria-hidden="true">
                  S
                </div>
                <div className="flex min-w-0 flex-col">
                  <span className="text-sm font-bold tracking-tight text-slate-900 leading-none">SCHOLARIO</span>
                  <span className="mt-1 text-[11px] text-slate-500 leading-none">Control Plane</span>
                </div>
              </Link>
              <Button
                ref={drawerCloseBtnRef}
                variant="ghost"
                size="icon"
                onClick={() => setDrawerOpen(false)}
                aria-label="Close navigation"
                className="text-slate-500 hover:bg-slate-100"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </Button>
            </div>
            {renderNavLinks(false)}
            {renderIdentityBlock(false)}
          </div>
        </div>
      )}

      {/* Main column — the pinned-header + single-scroller model. */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Pinned header — EVERY width (the old shell had a mobile-only
            sticky bar and NO desktop header). h-16 white, matching the
            school panel's pinned header exactly. */}
        <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-4 sm:px-6 lg:px-8 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <Button
              ref={hamburgerBtnRef}
              variant="ghost"
              size="icon"
              className="lg:hidden text-slate-700 hover:bg-slate-100 h-10 w-10 shrink-0"
              onClick={() => setDrawerOpen(true)}
              aria-label="Open navigation"
            >
              <Menu className="h-5 w-5" aria-hidden="true" />
            </Button>
            <span className="text-sm font-bold tracking-tight text-slate-900 truncate">SCHOLARIO</span>
            <span className="hidden sm:inline text-[11px] text-slate-500 truncate">Control Plane</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {/* Step-up status — only while platform MFA is enabled
                (dormant while TOTP is stood down). */}
            {mfaEnabled && (stepUpActive ? (
              <button
                onClick={() => setStepUpOpen(true)}
                className="flex items-center justify-center gap-2 h-8 rounded-full border border-emerald-200 bg-emerald-50 text-emerald-700 text-xs font-semibold focus-ring"
                title="Destructive-action window"
              >
                <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="tabular-nums">{countdown}</span>
              </button>
            ) : (
              <button
                onClick={() => setStepUpOpen(true)}
                className="flex items-center justify-center gap-2 h-8 rounded-full border border-amber-200 bg-amber-50 text-amber-700 text-xs font-semibold focus-ring"
                title="Step-up verification required for destructive actions"
              >
                <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                Verify step-up
              </button>
            ))}
            <HeaderAccount
              name={me.admin.name}
              email={me.admin.email}
              isRoot={me.admin.isRoot}
              onSignOut={() => void logout()}
            />
          </div>
        </header>

        {/* THE content scroller — the only scrollable element on any
            console page (`scrollConsoleToTop()` targets it by
            attribute). The footer lives INSIDE it (mt-auto), so short
            content keeps the footer at the viewport bottom without
            ever overlaying or floating. */}
        {/* The [data-console-scroll] attribute is the contract
            lib/platform/console-scroll.ts targets — keep them in sync. */}
        <div data-console-scroll="" className="flex-1 overflow-y-auto custom-scrollbar flex flex-col [&>*]:min-w-0">
          <main className="flex-1 px-4 sm:px-6 lg:px-8 py-6 lg:py-8 w-full max-w-[1400px] mx-auto">
            {children}
          </main>
          <footer className="mt-auto border-t border-slate-200 bg-white py-4 text-center text-[11px] text-slate-500">
            <p>SCHOLARIO Platform · Restricted access · Every action is audited</p>
          </footer>
        </div>
      </div>

      <StepUpDialog open={stepUpOpen} onOpenChange={setStepUpOpen} onVerified={() => void refresh()} />
    </div>
  )
}
