'use client'

// ============================================================
// ConsoleShell — the /platform control-plane chrome (PHASE 6)
// ------------------------------------------------------------
// Scholario production design system — LIGHT (slate canvas, white
// chrome, teal/emerald accents — same light identity as /platform/login).
// Provides:
//   · session gate (401 → /platform/login via the provider),
//   · permission-filtered navigation (hiding is UX; the server
//     authorizes every route),
//   · step-up pill: amber when the destructive-action window is stale,
//     emerald live countdown when fresh; "Verify" opens the TOTP
//     dialog (POST /api/platform/auth/step-up),
//   · sign-out.
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

const NAV: NavItem[] = [
  { href: '/platform', label: 'Overview', icon: LayoutDashboard },
  { href: '/platform/schools', label: 'Schools', icon: Building2, permission: 'schools.read' },
  { href: '/platform/support', label: 'Support', icon: LifeBuoy, permission: 'support.access' },
  { href: '/platform/audit', label: 'Audit Log', icon: ScrollText, permission: 'audit.read' },
  { href: '/platform/announcements', label: 'Announcements', icon: Megaphone, permission: 'announcements.manage' },
  { href: '/platform/settings', label: 'Settings', icon: Settings2, permission: 'settings.manage' },
  { href: '/platform/admins', label: 'Users', icon: Users, permission: 'admins.manage' },
  { href: '/platform/sessions', label: 'My Sessions', icon: MonitorSmartphone },
]

/** ARCHITECTURE RESET — grouped control-plane IA (premium console nav):
 *  honest modules that ACTUALLY exist — no invented Plans/Billing or
 *  Security modules (plan management lives inside Schools → school detail;
 *  session security lives under My Sessions). Renames for honest labels:
 *  Admins → Users (platform users), Support Tools → Support, Audit Trail →
 *  Audit Log. */
const NAV_GROUPS: Array<{ label: string; items: NavItem[] }> = [
  { label: 'Platform', items: [NAV[0]] },
  { label: 'Tenants', items: [NAV[1]] },
  { label: 'Operations', items: [NAV[2], NAV[4]] },
  { label: 'Governance', items: [NAV[3]] },
  { label: 'Administration', items: [NAV[5], NAV[6]] },
  { label: 'Account', items: [NAV[7]] },
]

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()
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

export function ConsoleShell({ children }: { children: React.ReactNode }) {
  const { me, loading, can, refresh, logout } = usePlatformSession()
  const pathname = usePathname()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [stepUpOpen, setStepUpOpen] = useState(false)

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
  // happens inside the provider).
  if (loading || !me) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="h-12 w-12 rounded-2xl bg-slate-200 animate-pulse" />
      </div>
    )
  }

  const nav = NAV.filter((item) => !item.permission || can(item.permission))
  const navGroups = NAV_GROUPS.map((g) => ({
    label: g.label,
    items: g.items.filter((item) => nav.includes(item)),
  })).filter((g) => g.items.length > 0)

  const SidebarContent = (
    <nav aria-label="Platform navigation" className="flex-1 space-y-4 px-3 py-4 overflow-y-auto custom-scrollbar">
      {navGroups.map((group) => (
        <div key={group.label}>
          <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
            {group.label}
          </p>
          <div className="space-y-0.5">
            {group.items.map((item) => {
              const active = pathname === item.href || (item.href !== '/platform' && pathname.startsWith(item.href))
              const Icon = item.icon
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors focus-ring ${
                    active
                      ? 'bg-teal-50 text-teal-700 border border-teal-200'
                      : 'text-slate-600 border border-transparent hover:text-slate-900 hover:bg-slate-50'
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                  {item.label}
                </Link>
              )
            })}
          </div>
        </div>
      ))}
    </nav>
  )

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 selection:bg-emerald-100 selection:text-emerald-900">
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex fixed inset-y-0 left-0 w-64 flex-col border-r border-slate-200 bg-white z-40">
        <div className="flex items-center gap-3 h-20 px-5 border-b border-slate-200">
          <div className="h-10 w-10 rounded-xl bg-teal-600 flex items-center justify-center text-white shadow-sm">
            <Cloud className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <p className="font-display font-extrabold text-base tracking-tight text-slate-900 leading-none">
              SCHOLARIO
            </p>
            <p className="text-[10px] font-semibold tracking-[0.22em] text-teal-600 uppercase mt-1">
              Control Plane
            </p>
          </div>
        </div>
        {SidebarContent}
        <div className="border-t border-slate-200 p-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-9 w-9 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center text-xs font-bold text-teal-700 shrink-0">
              {initials(me.admin.name)}
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold text-slate-900 truncate">{me.admin.name}</p>
              <p className="text-[10px] text-slate-500 truncate">{me.admin.isRoot ? 'Root admin' : 'Platform admin'}</p>
            </div>
          </div>
        </div>
      </aside>

      {/* Mobile drawer */}
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
            {SidebarContent}
          </div>
        </div>
      )}

      {/* Main column */}
      <div className="lg:pl-64 flex flex-col min-h-screen">
        <header className="sticky top-0 z-30 border-b border-slate-200 bg-white">
          <div className="h-16 px-4 sm:px-6 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <Button
                variant="ghost"
                size="icon"
                className="lg:hidden text-slate-700 hover:bg-slate-100 h-11 w-11"
                onClick={() => setDrawerOpen(true)}
                aria-label="Open navigation"
              >
                <Menu className="h-5 w-5" aria-hidden="true" />
              </Button>
              <p className="text-sm font-semibold text-slate-700 hidden sm:block truncate">
                Multi-tenant school infrastructure
              </p>
            </div>
            <div className="flex items-center gap-2 sm:gap-3">
              {/* Step-up status — only while platform MFA is enabled */}
              {mfaEnabled && stepUpActive ? (
                <button
                  onClick={() => setStepUpOpen(true)}
                  className="hidden sm:inline-flex items-center gap-2 h-9 px-3.5 rounded-full border border-emerald-200 bg-emerald-50 text-emerald-700 text-xs font-semibold focus-ring"
                  title="Destructive-action window"
                >
                  <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                  <span className="tabular-nums">{countdown}</span>
                </button>
              ) : mfaEnabled ? (
                <button
                  onClick={() => setStepUpOpen(true)}
                  className="inline-flex items-center gap-2 h-9 px-3.5 rounded-full border border-amber-200 bg-amber-50 text-amber-700 text-xs font-semibold focus-ring"
                  title="Step-up verification required for destructive actions"
                >
                  <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                  <span className="hidden sm:inline">Verify step-up</span>
                  <span className="sm:hidden" aria-hidden="true">MFA</span>
                </button>
              ) : null}
              <Button
                variant="outline"
                size="sm"
                onClick={() => void logout()}
                className="border-slate-300 bg-transparent text-slate-700 hover:bg-slate-100 hover:text-slate-900 focus-ring"
              >
                <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="hidden sm:inline">Sign out</span>
                <span className="sr-only sm:hidden">Sign out</span>
              </Button>
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
