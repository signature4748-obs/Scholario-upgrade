'use client'

/**
 * Website Management — Announcements section (task 2-a).
 * The celebrations/achievements manager: the SAME NoticesManager
 * filtered to kind=ANNOUNCEMENT (one lifecycle, two surfaces).
 */

import { PartyPopper } from 'lucide-react'
import { GlassCard } from '@/components/shared/ui'
import { NoticesManager } from './notices'

export function AnnouncementsSection() {
  return (
    <div className="space-y-5">
      <GlassCard className="p-5 sm:p-6 flex items-start gap-3">
        <PartyPopper className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" aria-hidden />
        <div className="min-w-0">
          <h3 className="font-bold text-sm text-foreground">Announcements</h3>
          <p className="text-xs text-muted-foreground mt-0.5 max-w-xl">
            Celebrations and achievements render as a highlights strip on the public website.
            They follow the same draft → schedule → publish lifecycle as notices.
          </p>
        </div>
      </GlassCard>
      <NoticesManager kind="ANNOUNCEMENT" />
    </div>
  )
}
