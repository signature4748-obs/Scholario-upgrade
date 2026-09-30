'use client'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { CheckCheck, Clock, MoreHorizontal, RotateCcw, Zap, Radio } from 'lucide-react'
import { cn } from '@/lib/utils'
import { snoozeOptions } from './data'

/**
 * LiveAlertsToolbar — the 3 real actions + a "More" dropdown menu.
 *
 * Redesigned (DASH-1) from the previous 7-button bar:
 *   - Resolve All (emerald solid, primary action)
 *   - Snooze All (outline, opens a small dropdown of durations)
 *   - More (ghost, dropdown menu hiding the demo / less-used actions:
 *     Simulate Alert, Auto-toggle, Reset All, Restore)
 *
 * The "View All" fake button is removed (the panel itself shows all alerts).
 *
 * Buttons follow the Academics h-8 text-xs language.
 */
export interface LiveAlertsToolbarProps {
  alertsLength: number
  dismissedCount: number
  snoozedCount: number
  autoAlertsEnabled: boolean
  countdown: number
  snoozeAllMenuOpen: boolean
  setSnoozeAllMenuOpen: (open: boolean | ((prev: boolean) => boolean)) => void
  onResolveAll: () => void
  onSnoozeAll: (minutes: number) => void
  onSimulateNewAlert: () => void
  onToggleAutoAlerts: () => void
  onResetAll: () => void
  onRestore: () => void
}

export function LiveAlertsToolbar({
  alertsLength, dismissedCount, snoozedCount, autoAlertsEnabled, countdown,
  snoozeAllMenuOpen, setSnoozeAllMenuOpen, onResolveAll, onSnoozeAll,
  onSimulateNewAlert, onToggleAutoAlerts, onResetAll, onRestore,
}: LiveAlertsToolbarProps) {
  return (
    <div className="flex items-center gap-1.5">
      {alertsLength > 0 && (
        <>
          {/* Resolve All — primary emerald solid */}
          <button
            onClick={onResolveAll}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium transition-colors"
            title="Resolve all active alerts"
          >
            <CheckCheck className="h-3.5 w-3.5" />
            Resolve All
          </button>

          {/* Snooze All — outline with nested duration dropdown */}
          <DropdownMenu
            open={snoozeAllMenuOpen}
            onOpenChange={setSnoozeAllMenuOpen}
          >
            <DropdownMenuTrigger asChild>
              <button
                className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-border bg-card text-foreground text-xs font-medium shadow-xs transition-colors hover:bg-muted hover:border-border/80"
                title="Snooze all alerts"
              >
                <Clock className="h-3.5 w-3.5" />
                Snooze All
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <div className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Snooze all for…
              </div>
              {snoozeOptions.map((opt) => (
                <DropdownMenuItem
                  key={opt.minutes}
                  onClick={() => onSnoozeAll(opt.minutes)}
                  className="flex items-center justify-between gap-2"
                >
                  <div className="flex flex-col">
                    <span className="font-medium">{opt.label}</span>
                    <span className="text-[10px] text-muted-foreground">{opt.desc}</span>
                  </div>
                  <Clock className="h-3 w-3 text-amber-500 shrink-0" />
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      )}

      {/* More — ghost dropdown with the demo / less-used actions */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md text-muted-foreground hover:bg-muted/60 hover:text-foreground text-xs font-medium transition-colors"
            title="More actions"
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
            More
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem onClick={onSimulateNewAlert}>
            <Zap className="h-3.5 w-3.5" />
            <div className="flex flex-col">
              <span>Simulate new alert</span>
              <span className="text-[10px] text-muted-foreground">Push a fresh test alert</span>
            </div>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onToggleAutoAlerts}>
            <Radio className={cn('h-3.5 w-3.5', autoAlertsEnabled && 'text-rose-500')} />
            <div className="flex flex-col">
              <span>{autoAlertsEnabled ? 'Stop auto-alerts' : 'Enable auto-alerts'}</span>
              <span className="text-[10px] text-muted-foreground">
                {autoAlertsEnabled ? `Next in ${countdown}s · click to stop` : 'Auto-arrive every 30s'}
              </span>
            </div>
          </DropdownMenuItem>
          {(dismissedCount > 0 || snoozedCount > 0) && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={onResetAll}
                disabled={dismissedCount === 0 && snoozedCount === 0}
              >
                <RotateCcw className="h-3.5 w-3.5" />
                <div className="flex flex-col">
                  <span>Reset to initial state</span>
                  <span className="text-[10px] text-muted-foreground">Restore all alerts</span>
                </div>
              </DropdownMenuItem>
            </>
          )}
          {dismissedCount > 0 && (
            <DropdownMenuItem onClick={onRestore}>
              <CheckCheck className="h-3.5 w-3.5" />
              <div className="flex flex-col">
                <span>Restore dismissed</span>
                <span className="text-[10px] text-muted-foreground">{dismissedCount} dismissed alert{dismissedCount > 1 ? 's' : ''}</span>
              </div>
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
