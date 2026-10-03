'use client'

/**
 * Avatar — the shared initials/photo avatar component for SCHOLARIO.
 *
 * Visual identity:
 *   - Deterministic color assignment (same person → same color everywhere)
 *   - Initials generated from name if not provided
 *   - Optional photo URL (falls back to initials)
 *   - Restrained palette (6 muted solid tints — no gradients, no rainbow)
 *   - Circle (default) or square shape
 *   - Sizes: xs (24px) / sm (32px) / md (40px) / lg (48px) / xl (64px)
 *
 * This is the SINGLE source of truth for avatars across the ERP.
 * Replaces the 60+ GradientAvatar callers + the dead shadcn Avatar.
 *
 * Design language (matches Academics + the neutral-premium system):
 *   - rounded-full (or rounded-lg for square)
 *   - muted solid tint with deterministic text color
 *   - font-semibold
 *   - shadow-sm
 *   - subtle ring for emphasis variants
 */

import { forwardRef } from 'react'
import { cn } from '@/lib/utils'
// SS-1 fix: the photo branch needs the Radix Avatar ROOT context — the
// previous import pulled only Image/Fallback, which crash outside a root.
// (The src path was never exercised before profile photos existed.)
import { Avatar as UIAvatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'

export interface AvatarProps {
  /** Full name — used to generate initials and deterministic color */
  name: string
  /** Override the auto-generated initials (e.g. "AS" for "Aarav Sharma") */
  initials?: string
  /** Optional photo URL. If provided and loads, shows the photo; falls back to initials. */
  src?: string
  /** Avatar size */
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl'
  /** Shape */
  shape?: 'circle' | 'square'
  /** Override the deterministic tint (rarely needed) */
  gradient?: string
  /** Add a subtle ring (for emphasis in lists) */
  ring?: boolean
  className?: string
}

const AVATAR_SIZES: Record<string, string> = {
  xs: 'h-6 w-6 text-[10px]',
  sm: 'h-8 w-8 text-xs',
  md: 'h-10 w-10 text-sm',
  lg: 'h-12 w-12 text-base',
  xl: 'h-16 w-16 text-xl',
}

// Restrained palette — 6 muted solid tints, light + dark safe
// (mirrors GradientAvatar in shared/ui.tsx — neutral-premium avatars)
const AVATAR_TINTS = [
  'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300',
  'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
  'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
  'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300',
  'bg-slate-200 text-slate-600 dark:bg-slate-700/60 dark:text-slate-300',
]

function hashString(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash)
  return Math.abs(hash)
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase()
}

export const Avatar = forwardRef<HTMLDivElement, AvatarProps>(
  ({ name, initials, src, size = 'md', shape = 'circle', gradient, ring, className }, ref) => {
    const text = initials ?? getInitials(name)
    const g = gradient ?? AVATAR_TINTS[hashString(name) % AVATAR_TINTS.length]
    const shapeClass = shape === 'circle' ? 'rounded-full' : 'rounded-lg'

    // If a photo URL is provided, use the Radix Avatar root (context for
    // Image/Fallback) skinned with our tint + sizing; falls back to
    // initials automatically if the image fails to load.
    if (src) {
      return (
        <div
          ref={ref}
          className={cn(
            'relative shrink-0',
            shapeClass,
            AVATAR_SIZES[size],
            ring && 'ring-2 ring-background',
            className,
          )}
        >
          <UIAvatar
            className={cn(
              'h-full w-full overflow-hidden font-semibold shadow-sm',
              g,
            )}
          >
            <AvatarImage src={src} alt={name} className="h-full w-full object-cover" />
            <AvatarFallback className="bg-transparent font-semibold">{text}</AvatarFallback>
          </UIAvatar>
        </div>
      )
    }

    // No photo — render initials with deterministic tint
    return (
      <div
        ref={ref}
        className={cn(
          'flex shrink-0 items-center justify-center font-semibold shadow-sm',
          shapeClass,
          g,
          AVATAR_SIZES[size],
          ring && 'ring-2 ring-background',
          className,
        )}
      >
        {text}
      </div>
    )
  },
)
Avatar.displayName = 'Avatar'

// Backward-compatible re-export so existing GradientAvatar callers keep working.
// New code should use <Avatar> directly.
export { Avatar as GradientAvatar }
