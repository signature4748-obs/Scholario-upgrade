'use client'

// ============================================================
// ConsoleShell — the /platform control-plane chrome
// ------------------------------------------------------------
// Scholario production design system — LIGHT (slate canvas, white
// chrome, teal accents — same light identity as /platform/login).
// SUPER-ADMIN CONTROL PANEL IA (2026-10 simplification):
//   · ONE flat primary navigation, exactly nine destinations in a
//     fixed order (Overview · Schools · Subscriptions · Users &
//     Access · Support · Announcements · Audit Log · Settings ·
//     My Sessions) — no group headers, no submenus.
//   · Compact desktop sidebar with an OPTIONAL collapsed icon-only
//     state (persisted in localStorage; icon links keep accessible
//     names; mobile drawer always shows full labels).
//   · Account identity + sign-out live in ONE compact account area
//     at the sidebar foot (no duplicate sign-out in the top bar).
// Provides:
//   · session gate (401 → /platform/login via the provider),
//   · permission-filtered navigation (hiding is UX; the server
//     authorizes every route),
//   · step-up pill: amber when the destructive-action window is stale,
//     emerald live countdown when fresh; "Verify" opens the TOTP
//     dialog (POST /api/platform/auth/step-up) — dormant while
//     platform MFA is stood down (mfaEnabled stays false).
// ============================================================

import React, { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
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
  Cloud,
  Wallet,
  ServerCrash,
  RefreshCw,
  PanelLeftClose,
  PanelLeftOpen,
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

interface NavItem {
  href: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  permission?: string
}

/** FLAT IA — the nine primary destinations, fixed order, no groups. */
const NAV: NavItem[] = [
  { href: '/platform', label: 'Overview', icon: LayoutDashboard },
  { href: '/platform/schools', label: 'Schools', icon: Building2, permission: 'schools.read' },
  { href: '/platform/subscriptions', label: 'Subscriptions', icon: Wallet, permission: 'billing.manage' },
  { href: '/platform/admins', label: 'Users & Access', icon: Users, permission: 'admins.manage' },
  { href: '/platform/support', label: 'Support', icon: LifeBuoy, permission: 'support.access' },
  { href: '/platform/announcements', label: 'Announcements', icon: Megaphone, permission: 'announcements.manage' },
  { href: '/platform/audit', label: 'Audit Log', icon: ScrollText, permission: 'audit.read' },
  { href: '/platform/settings', label: 'Settings', icon: Settings2, permission: 'settings.manage' },
  { href: '/platform/sessions', label: 'My Sessions', icon: MonitorSmartphone },
]

/** localStorage key for the desktop collapsed-sidebar preference. */
const SIDEBAR_PREF_KEY = 'scholario.platform.sidebar'

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()
}

/** One sidebar link. `collapsed` renders the icon-only compact form —
 *  the accessible name stays the full label (aria-label + title). */
function SidebarLink({ item, pathname, collapsed }: { item: NavItem; pathname: string; collapsed: boolean }) {
  const active = pathname === item.href || (item.href !== '/platform' && pathname.startsWith(item.href))
  const Icon = item.icon
  if (collapsed) {
    return (
      <Link
        href={item.href}
        aria-current={active ? 'page' : undefined}
        aria-label={item.label}
        title={item.label}
        className={`flex h-10 w-10 items-center justify-center rounded-lg transition-colors focus-ring ${
          active
            ? 'bg-teal-50 text-teal-700 border border-teal-200'
            : 'text-slate-500 border border-transparent hover:text-slate-900 hover:bg-slate-50'
        }`}
      >
        <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
      </Link>
    )
  }
  return (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      className={`flex items-center gap-3 rounded-lg py-2 px-3 text-sm font-medium transition-colors focus-ring ${
        active
          ? 'bg-teal-50 text-teal-700 border border-teal-200'
          : 'text-slate-600 border border-transparent hover:text-slate-900 hover:bg-slate-50'
      }`}
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
      {item.label}
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

export function ConsoleShell({ children }: { children: React.ReactNode }) {
  const { me, loading, unavailable, can, refresh, logout } = usePlatformSession()
  const pathname = usePathname()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [stepUpOpen, setStepUpOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(false)

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

  const nav = NAV.filter((item) => !item.permission || can(item.permission))

  /** Navigation links — one flat list. Render helper (plain element,
   *  matching the original SidebarContent pattern — no component is
   *  created during render). `compact` = desktop collapsed. */
  const renderNavLinks = (compact: boolean) => (
    <nav
      aria-label="Platform navigation"
      className="flex-1 px-3 py-4 overflow-y-auto custom-scrollbar"
    >
      <ul className={compact ? 'space-y-1' : 'space-y-0.5'}>
        {nav.map((item) => (
          <li key={item.href} className={compact ? 'flex justify-center' : undefined}>
            <SidebarLink item={item} pathname={pathname} collapsed={compact} />
          </li>
        ))}
      </ul>
    </nav>
  )

  /** The compact account area — identity + sign-out in one place.
   *  Render helper. `compact` = icon-only (desktop collapsed sidebar). */
  const renderAccountArea = (compact: boolean) => (
    <div className={`border-t border-slate-200 ${compact ? 'p-3 space-y-2' : 'p-4'}`}>
      {compact ? (
        <>
          <div
            className="flex h-9 w-9 mx-auto items-center justify-center rounded-full bg-slate-100 border border-slate-200 text-xs font-bold text-teal-700"
            title={me.admin.name}
          >
            {initials(me.admin.name)}
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => void logout()}
            aria-label="Sign out"
            title="Sign out"
            className="h-9 w-9 mx-auto flex text-slate-500 hover:bg-slate-100 hover:text-slate-700"
          >
            <LogOut className="h-4 w-4" aria-hidden="true" />
          </Button>
        </>
      ) : (
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-9 w-9 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center text-xs font-bold text-teal-700 shrink-0">
            {initials(me.admin.name)}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-slate-900 truncate">{me.admin.name}</p>
            <p className="text-[10px] text-slate-500 truncate">{me.admin.isRoot ? 'Root admin' : 'Platform admin'}</p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => void logout()}
            aria-label="Sign out"
            title="Sign out"
            className="h-8 w-8 shrink-0 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <LogOut className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      )}
      {/* Step-up status — only while platform MFA is enabled (dormant
          while TOTP is stood down). Rendered inline in the account area. */}
      {mfaEnabled && (stepUpActive ? (
        <button
          onClick={() => setStepUpOpen(true)}
          className="mt-2 flex w-full items-center justify-center gap-2 h-8 rounded-full border border-emerald-200 bg-emerald-50 text-emerald-700 text-xs font-semibold focus-ring"
          title="Destructive-action window"
        >
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="tabular-nums">{countdown}</span>
        </button>
      ) : (
        <button
          onClick={() => setStepUpOpen(true)}
          className="mt-2 flex w-full items-center justify-center gap-2 h-8 rounded-full border border-amber-200 bg-amber-50 text-amber-700 text-xs font-semibold focus-ring"
          title="Step-up verification required for destructive actions"
        >
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
          Verify step-up
        </button>
      ))}
    </div>
  )

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 selection:bg-emerald-100 selection:text-emerald-900">
      {/* Desktop sidebar — w-64 expanded, icon-only when collapsed */}
      <aside
        className={`hidden lg:flex fixed inset-y-0 left-0 flex-col border-r border-slate-200 bg-white z-40 transition-[width] ${
          collapsed ? 'w-[68px]' : 'w-64'
        }`}
      >
        <div
          className={
            collapsed
              ? 'flex flex-col items-center gap-1 border-b border-slate-200 py-4'
              : 'flex items-center gap-3 h-20 px-5 border-b border-slate-200'
          }
        >
          <div
            className="h-10 w-10 rounded-xl bg-teal-600 flex items-center justify-center text-white shadow-sm shrink-0"
            title="SCHOLARIO Control Plane"
          >
            <Cloud className="h-5 w-5" aria-hidden="true" />
          </div>
          {collapsed ? (
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleCollapsed}
              aria-label="Expand sidebar"
              title="Expand sidebar"
              className="h-8 w-8 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            >
              <PanelLeftOpen className="h-4 w-4" aria-hidden="true" />
            </Button>
          ) : (
            <>
              <div className="min-w-0 flex-1">
                <p className="font-display font-extrabold text-base tracking-tight text-slate-900 leading-none">
                  SCHOLARIO
                </p>
                <p className="text-[10px] font-semibold tracking-[0.22em] text-teal-600 uppercase mt-1">
                  Control Plane
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={toggleCollapsed}
                aria-label="Collapse sidebar"
                title="Collapse sidebar"
                className="h-8 w-8 shrink-0 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                <PanelLeftClose className="h-4 w-4" aria-hidden="true" />
              </Button>
            </>
          )}
        </div>
        {renderNavLinks(collapsed)}
        {renderAccountArea(collapsed)}
      </aside>

      {/* Mobile drawer — always full labels (never the collapsed form) */}
      {drawerOpen && (
        <div className="lg:hidden fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Platform navigation">
          <div className="absolute inset-0 bg-slate-900/40" onClick={() => setDrawerOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-72 max-w-[85vw] bg-white border-r border-slate-200 flex flex-col shadow-xl">
            <div className="flex items-center justify-between h-20 px-5 border-b border-slate-200">
              <div className="flex items-center gap-2.5">
                <div className="h-8 w-8 rounded-lg bg-teal-600 flex items-center justify-center text-white">
                  <Cloud className="h-4 w-4" aria-hidden="true" />
                </div>
                <span className="font-display font-extrabold text-sm text-slate-900">SCHOLARIO Control Plane</span>
              </div>
              <Button
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
            {renderAccountArea(false)}
          </div>
        </div>
      )}

      {/* Main column — padding tracks the sidebar width */}
      <div
        className={`flex flex-col min-h-screen transition-[padding] ${
          collapsed ? 'lg:pl-[68px]' : 'lg:pl-64'
        }`}
      >
        {/* Simple top bar (mobile only — the desktop sidebar carries
            identity; every page renders its own header) */}
        <header className="lg:hidden sticky top-0 z-30 border-b border-slate-200 bg-white">
          <div className="h-14 px-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <Button
                variant="ghost"
                size="icon"
                className="text-slate-700 hover:bg-slate-100 h-10 w-10"
                onClick={() => setDrawerOpen(true)}
                aria-label="Open navigation"
              >
                <Menu className="h-5 w-5" aria-hidden="true" />
              </Button>
              <span className="font-display font-bold text-sm text-slate-900 truncate">
                SCHOLARIO
              </span>
              <span className="text-[10px] font-semibold tracking-[0.18em] text-teal-600 uppercase">
                Control Plane
              </span>
            </div>
          </div>
        </header>

        <main className="flex-1 px-4 sm:px-6 lg:px-8 py-6 lg:py-8 w-full max-w-[1400px] mx-auto">
          {children}
        </main>

        <footer className="mt-auto border-t border-slate-200 bg-white py-4 text-center text-[11px] text-slate-400">
          <p>SCHOLARIO Platform · Restricted access · Every action is audited</p>
        </footer>
      </div>

      <StepUpDialog open={stepUpOpen} onOpenChange={setStepUpOpen} onVerified={() => void refresh()} />
    </div>
  )
}
