'use client'

// ============================================================
// ConsoleShell — the /platform control-plane chrome (PHASE 6)
// ------------------------------------------------------------
// Dark control-plane identity (zinc-950 + emerald accents — brand
// continuity with the school product, deliberately distinct from the
// light school workspace). Provides:
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
  { href: '/platform/support', label: 'Support Tools', icon: LifeBuoy, permission: 'support.access' },
  { href: '/platform/audit', label: 'Audit Trail', icon: ScrollText, permission: 'audit.read' },
  { href: '/platform/announcements', label: 'Announcements', icon: Megaphone, permission: 'announcements.manage' },
  { href: '/platform/settings', label: 'Settings', icon: Settings2, permission: 'settings.manage' },
  { href: '/platform/admins', label: 'Admins', icon: Users, permission: 'admins.manage' },
  { href: '/platform/sessions', label: 'My Sessions', icon: MonitorSmartphone },
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
      <DialogContent className="bg-zinc-900 border-zinc-800 text-zinc-100 sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-zinc-50">
            <ShieldCheck className="h-4 w-4 text-amber-400" aria-hidden="true" />
            Step-up authentication
          </DialogTitle>
          <DialogDescription className="text-zinc-400">
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
          className="bg-zinc-950 border-zinc-800 text-zinc-100 text-lg tracking-[0.4em] text-center font-mono"
        />
        {error && (
          <p role="alert" className="text-sm text-red-400">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="border-zinc-700 bg-transparent text-zinc-300 hover:bg-zinc-800"
          >
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={busy} className="bg-emerald-600 hover:bg-emerald-500 text-zinc-950">
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

  // Close the mobile drawer on navigation.
  useEffect(() => {
    setDrawerOpen(false)
  }, [pathname])

  // Full-screen boot skeleton until the session resolves (401 redirect
  // happens inside the provider).
  if (loading || !me) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-emerald-400 to-teal-500 animate-pulse shadow-lg shadow-emerald-500/20" />
      </div>
    )
  }

  const nav = NAV.filter((item) => !item.permission || can(item.permission))

  const SidebarContent = (
    <nav aria-label="Platform navigation" className="flex-1 space-y-1 px-3 py-4 overflow-y-auto custom-scrollbar">
      <p className="px-3 pb-2 text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500">Control Plane</p>
      {nav.map((item) => {
        const active = pathname === item.href || (item.href !== '/platform' && pathname.startsWith(item.href))
        const Icon = item.icon
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors focus-ring ${
              active
                ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/20'
                : 'text-zinc-400 border border-transparent hover:text-zinc-100 hover:bg-zinc-900'
            }`}
          >
            <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
            {item.label}
          </Link>
        )
      })}
    </nav>
  )

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 selection:bg-emerald-500/20 selection:text-emerald-200">
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex fixed inset-y-0 left-0 w-64 flex-col border-r border-zinc-800/80 bg-zinc-950 z-40">
        <div className="flex items-center gap-3 h-20 px-5 border-b border-zinc-800/80">
          <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-emerald-400 to-teal-600 flex items-center justify-center text-zinc-950 shadow-lg shadow-emerald-500/25">
            <Cloud className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <p className="font-display font-extrabold text-base tracking-tight text-white leading-none">
              SCHOLARIO
            </p>
            <p className="text-[10px] font-semibold tracking-[0.22em] text-emerald-400/80 uppercase mt-1">
              Control Plane
            </p>
          </div>
        </div>
        {SidebarContent}
        <div className="border-t border-zinc-800/80 p-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-9 w-9 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center text-xs font-bold text-emerald-300 shrink-0">
              {initials(me.admin.name)}
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold text-zinc-100 truncate">{me.admin.name}</p>
              <p className="text-[10px] text-zinc-500 truncate">{me.admin.isRoot ? 'Root admin' : 'Platform admin'}</p>
            </div>
          </div>
        </div>
      </aside>

      {/* Mobile drawer */}
      {drawerOpen && (
        <div className="lg:hidden fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Platform navigation">
          <div className="absolute inset-0 bg-zinc-950/80 backdrop-blur-sm" onClick={() => setDrawerOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-72 max-w-[85vw] bg-zinc-950 border-r border-zinc-800 flex flex-col">
            <div className="flex items-center justify-between h-20 px-5 border-b border-zinc-800/80">
              <div className="flex items-center gap-2.5">
                <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-emerald-400 to-teal-600 flex items-center justify-center text-zinc-950">
                  <Cloud className="h-4 w-4" aria-hidden="true" />
                </div>
                <span className="font-display font-extrabold text-sm text-white">SCHOLARIO Control Plane</span>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setDrawerOpen(false)}
                aria-label="Close navigation"
                className="text-zinc-400 hover:bg-zinc-800"
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
        <header className="sticky top-0 z-30 border-b border-zinc-800/80 bg-zinc-950/85 backdrop-blur-xl">
          <div className="h-16 px-4 sm:px-6 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <Button
                variant="ghost"
                size="icon"
                className="lg:hidden text-zinc-300 hover:bg-zinc-800 h-11 w-11"
                onClick={() => setDrawerOpen(true)}
                aria-label="Open navigation"
              >
                <Menu className="h-5 w-5" aria-hidden="true" />
              </Button>
              <p className="text-sm font-semibold text-zinc-300 hidden sm:block truncate">
                Multi-tenant school infrastructure
              </p>
            </div>
            <div className="flex items-center gap-2 sm:gap-3">
              {/* Step-up status */}
              {stepUpActive ? (
                <button
                  onClick={() => setStepUpOpen(true)}
                  className="hidden sm:inline-flex items-center gap-2 h-9 px-3.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 text-xs font-semibold focus-ring"
                  title="Destructive-action window"
                >
                  <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                  <span className="tabular-nums">{countdown}</span>
                </button>
              ) : (
                <button
                  onClick={() => setStepUpOpen(true)}
                  className="inline-flex items-center gap-2 h-9 px-3.5 rounded-full border border-amber-500/30 bg-amber-500/10 text-amber-300 text-xs font-semibold focus-ring"
                  title="Step-up verification required for destructive actions"
                >
                  <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                  <span className="hidden sm:inline">Verify step-up</span>
                  <span className="sm:hidden" aria-hidden="true">MFA</span>
                </button>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => void logout()}
                className="border-zinc-700 bg-transparent text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100 focus-ring"
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

        <footer className="mt-auto border-t border-zinc-900 py-4 text-center text-[11px] text-zinc-600">
          <p>SCHOLARIO Platform · Restricted access · Every action is audited</p>
        </footer>
      </div>

      <StepUpDialog open={stepUpOpen} onOpenChange={setStepUpOpen} onVerified={() => void refresh()} />
    </div>
  )
}
