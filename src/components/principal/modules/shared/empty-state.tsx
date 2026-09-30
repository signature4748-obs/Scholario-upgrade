'use client'

/**
 * ModuleEmptyState — the ONE canonical empty-state pattern for the four
 * Phase-5 polished modules (dashboard / exams / timetable / fees).
 *
 * Visual language (shared across every usage):
 *   - framed (default): a dashed-border hint card (`rounded-xl
 *     border-dashed bg-muted/20`) sitting inside its parent section —
 *     reads as "nothing here yet", never as an error.
 *   - unframed: the same icon/title/description/action hierarchy without
 *     the dashed frame, for tight spots (table cells, nested lists) where
 *     a nested frame would double up.
 *   - icon tile: h-11 w-11 circle (ring + muted tint), icon h-5 w-5.
 *   - title: text-sm font-semibold text-foreground.
 *   - description: one line, text-xs text-muted-foreground, leading-snug.
 *   - action: optional secondary (outline) button below, mt-4.
 */

import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export interface ModuleEmptyStateProps {
  /** Lucide icon — render at h-5 w-5; sized by the h-11 tile. */
  icon: ReactNode
  /** Short headline (text-sm font-semibold). */
  title: string
  /** One-line helper text (text-xs muted). */
  description?: ReactNode
  /** Optional secondary action (usually an outline Button). */
  action?: ReactNode
  /** Dashed hint-card frame (default) vs bare centered layout. */
  framed?: boolean
  className?: string
}

export function ModuleEmptyState({
  icon, title, description, action, framed = true, className,
}: ModuleEmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center',
        framed
          ? 'm-4 rounded-xl border border-dashed border-border/80 bg-muted/20 px-4 py-8'
          : 'py-10',
        className,
      )}
    >
      <div className="flex h-11 w-11 items-center justify-center rounded-full bg-muted/50 text-muted-foreground/70 ring-1 ring-border/60">
        {icon}
      </div>
      <p className="mt-3 text-sm font-semibold text-foreground">{title}</p>
      {description && (
        <p className="mt-1 max-w-xs text-xs leading-snug text-muted-foreground">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
