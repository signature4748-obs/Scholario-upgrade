'use client'

/**
 * ModuleLinkCard — a settings-page card that points at another ERP module.
 *
 * HONEST IA: several Settings categories (People & Access, Communication,
 * Website, Finance → Salary) no longer host their own editors — the real
 * management surface lives in a dedicated module. This card links there
 * with a plain deep-link (`/?tenant=<slug>&module=<key>` — a full page
 * navigation; the principal panel reads ?module= on boot) and states
 * plainly what the target module owns. It NEVER pretends to manage the
 * domain itself.
 */

import type { LucideIcon } from 'lucide-react'
import { ArrowUpRight, Info } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useCurrentUser } from '@/lib/store/current-user-store'

interface ModuleLinkCardProps {
  icon: LucideIcon
  title: string
  description: string
  /** Registry key of the target module (principal-panel ?module= deep-link). */
  moduleKey: string
  /** CTA label — defaults to "Open <title>". */
  ctaLabel?: string
  /** Honest note rendered under the CTA. */
  note?: string
  className?: string
}

export function ModuleLinkCard({
  icon: Icon,
  title,
  description,
  moduleKey,
  ctaLabel,
  note,
  className,
}: ModuleLinkCardProps) {
  const slug = useCurrentUser((s) => s.me?.school?.slug)
  const href = slug
    ? `/?tenant=${encodeURIComponent(slug)}&module=${moduleKey}`
    : `/?module=${moduleKey}`

  return (
    <div className={cn('rounded-xl border border-border bg-card p-4 sm:p-5 space-y-3', className)}>
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted">
          <Icon className="h-4.5 w-4.5 text-muted-foreground" aria-hidden />
        </div>
        <div className="min-w-0">
          <h4 className="text-sm font-semibold text-foreground">{title}</h4>
          <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{description}</p>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <a
          href={href}
          className={cn(
            'inline-flex h-9 w-fit items-center justify-center gap-1.5 rounded-lg px-3.5 text-xs font-bold',
            'bg-foreground text-background hover:opacity-90 transition-opacity',
          )}
        >
          {ctaLabel ?? `Open ${title}`}
          <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
        </a>
        <p className="text-[11px] text-muted-foreground flex items-start gap-1.5">
          <Info className="h-3 w-3 mt-px shrink-0" aria-hidden />
          <span>
            {note ??
              'Switches the workspace to this module in a full page load — use the sidebar to come back to Settings.'}
          </span>
        </p>
      </div>
    </div>
  )
}
