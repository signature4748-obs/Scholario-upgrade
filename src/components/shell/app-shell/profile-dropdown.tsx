'use client'

import { useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { LogOut, Settings, ShieldCheck, Building2, ChevronDown } from 'lucide-react'
// The school context line renders the authenticated user's actual school
// (the active tenant) — never a switcher. Multi-school switching only
// exists when the session carries real, authorized memberships.
import { useActiveTenant } from '@/lib/tenant/store'
// SS-1 — server identity: renders the user's real profile photo when set.
import { useCurrentUser } from '@/lib/store/current-user-store'

interface ProfileUser {
  name?: string
  email?: string
}

interface ProfileDropdownProps {
  open: boolean
  onClose: () => void
  user: ProfileUser | null
  role: ShellRole
  onNavigateSettings: () => void
  onLogout: () => void
  /** Navigate to the platform control plane (super admin). */
  onOpenPlatform?: () => void
}

type ShellRole = 'principal' | 'teacher' | 'student' | 'superadmin'

export function ProfileDropdownTrigger({
  user,
  open,
  onToggle,
  buttonRef,
}: {
  user: ProfileUser | null
  open: boolean
  onToggle: () => void
  /** A11y — lets the shell restore focus here when Escape closes the menu. */
  buttonRef?: React.Ref<HTMLButtonElement>
}) {
  const serverAvatar = useCurrentUser((s) => s.me?.avatarUrl)
  const displayName = user?.name || 'Dr. Ramesh Varma'
  return (
    <button
      ref={buttonRef}
      onClick={onToggle}
      aria-label={`Account menu — ${displayName}`}
      aria-expanded={open}
      aria-haspopup="menu"
      className="flex items-center gap-3 pl-4 border-l border-border rounded-md hover:opacity-90 transition-opacity cursor-pointer group focus-ring"
      title="User Menu"
    >
      <div className="text-right hidden sm:block">
        <p className="text-xs font-semibold text-foreground leading-none group-hover:text-primary transition-colors">{displayName}</p>
        <p className="text-[10px] text-muted-foreground mt-1">{user?.email || 'principal@scholario.edu'}</p>
      </div>
      <div className="w-8 h-8 rounded-full bg-muted text-foreground font-bold border border-border flex items-center justify-center text-xs shrink-0 overflow-hidden group-hover:border-primary transition-colors">
        {serverAvatar ? (
          <img src={serverAvatar} alt={`${displayName} profile photo`} className="h-full w-full object-cover" />
        ) : (
          displayName.split(' ').map((n) => n[0]).join('').slice(0, 2)
        )}
      </div>
      <ChevronDown className="h-3.5 w-3.5 text-muted-foreground group-hover:text-foreground transition-colors" aria-hidden="true" />
    </button>
  )
}

export function ProfileDropdown({
  open,
  onClose,
  user,
  role,
  onNavigateSettings,
  onLogout,
  onOpenPlatform,
}: ProfileDropdownProps) {
  const activeTenant = useActiveTenant()

  // A11y — Escape closes the menu from the keyboard (the shell also
  // restores focus to the trigger; handled there via buttonRef).
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  return (
    <AnimatePresence>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={onClose} aria-hidden="true" />
          <motion.div
            role="dialog"
            aria-label="Account menu"
            initial={{ opacity: 0, y: 8, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 mt-2 w-64 rounded-xl bg-card border border-border shadow-xl p-2 z-50 text-card-foreground"
          >
            <div className="p-3 border-b border-border bg-muted/40 rounded-lg mb-1">
              <p className="font-bold text-xs text-foreground">{user?.name || 'Dr. Ramesh Varma'}</p>
              <p className="text-[11px] text-muted-foreground truncate">{user?.email || 'principal@scholario.edu'}</p>
              <div className="flex items-center gap-1.5 mt-1.5">
                <span className="inline-block text-[9px] font-extrabold px-2 py-0.5 rounded bg-primary/15 text-emerald-700 dark:text-emerald-400 uppercase tracking-wider">
                  {role}
                </span>
                {role !== 'superadmin' && (
                  <span className="inline-flex min-w-0 items-center gap-1 text-[10px] text-muted-foreground" title={activeTenant.name}>
                    <Building2 className="h-3 w-3 shrink-0" aria-hidden="true" />
                    <span className="truncate">{activeTenant.name}</span>
                  </span>
                )}
              </div>
            </div>

            {role === 'superadmin' && onOpenPlatform && (
              <div className="py-1 border-b border-border space-y-0.5">
                <p className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                  <ShieldCheck className="h-3 w-3 text-primary" /> Platform
                </p>
                <button
                  onClick={() => { onClose(); onOpenPlatform() }}
                  className="flex items-center gap-2 w-full px-2.5 py-1.5 text-xs text-foreground hover:bg-muted rounded-md transition-colors text-left focus-ring"
                >
                  <ShieldCheck className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
                  Go to Control Plane
                </button>
              </div>
            )}

            <div className="py-1 space-y-0.5">
              <button
                onClick={onNavigateSettings}
                className="flex items-center gap-2 w-full px-2.5 py-1.5 text-xs text-foreground hover:bg-muted rounded-md transition-colors font-medium text-left focus-ring"
              >
                <Settings className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                Account Settings
              </button>
              <button
                onClick={onLogout}
                className="flex items-center gap-2 w-full px-2.5 py-1.5 text-xs text-destructive hover:bg-destructive/10 rounded-md transition-colors font-medium text-left focus-ring"
              >
                <LogOut className="h-3.5 w-3.5 text-destructive" aria-hidden="true" />
                Sign Out
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
