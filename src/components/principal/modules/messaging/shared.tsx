'use client'

/**
 * Shared visual primitives for the Messages module.
 *
 * `ConversationAvatar` — one consistent avatar treatment across the
 * conversation list, chat header, contact sheet, composer picker, drafts
 * and groups panel. Soft solid type colors (no loud gradients) keep the
 * module calm; type stays distinguishable at a glance:
 *   staff → emerald · parent → amber · student → amber · group → violet
 */

import { cn } from '@/lib/utils'
import type { ConversationType } from '@/lib/store/messaging-store'

const TYPE_BG: Record<ConversationType, string> = {
  staff: 'bg-emerald-600/90 dark:bg-emerald-600',
  parent: 'bg-amber-500/90 dark:bg-amber-600',
  student: 'bg-amber-500/90 dark:bg-amber-600',
  group: 'bg-violet-600/90 dark:bg-violet-600',
}

const SIZES = {
  sm: 'h-8 w-8 text-[10px]',
  md: 'h-9 w-9 text-[11px]',
  lg: 'h-12 w-12 text-sm',
} as const

export function ConversationAvatar({
  avatar,
  type,
  size = 'md',
  className,
}: {
  avatar: string
  type: ConversationType
  size?: keyof typeof SIZES
  className?: string
}) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full font-semibold tracking-wide text-white select-none',
        TYPE_BG[type],
        SIZES[size],
        className,
      )}
    >
      {avatar}
    </div>
  )
}

/** Map a label id → its quiet dot color used in the folders nav. */
export const LABEL_DOT: Record<string, string> = {
  Staff: 'bg-emerald-500',
  Parents: 'bg-amber-500',
  Groups: 'bg-violet-500',
  Urgent: 'bg-rose-500',
}
