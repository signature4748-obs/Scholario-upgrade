'use client'

/**
 * Communication category — honest overview.
 *
 * Notifications, announcements, circulars and message templates are owned
 * by the Communication and Messages modules. Settings hosts no editors
 * for them — this page points at the real surfaces.
 */

import { Megaphone, MessageSquare, Bell, FileText, Info } from 'lucide-react'
import { SettingsTab } from '../shared'
import { ModuleLinkCard } from './module-link-card'

export function CommunicationOverviewPage() {
  return (
    <SettingsTab
      icon={Megaphone}
      title="Communication"
      description="Announcements, circulars and messages are sent from their own modules — Settings hosts no editors here."
    >
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <ModuleLinkCard
          icon={Megaphone}
          title="Announcements, Circulars & Broadcasts"
          description="Publishing notices, circulars and school-wide broadcasts (push / SMS / email), with scheduling, drafts and history."
          moduleKey="communication"
          ctaLabel="Open Communication module"
        />
        <ModuleLinkCard
          icon={MessageSquare}
          title="Messages & Templates"
          description="Direct messages to teachers, students and parents, plus the message templates used when composing."
          moduleKey="messaging"
          ctaLabel="Open Messages module"
        />
      </div>

      <div className="rounded-xl border border-dashed border-border bg-muted/30 px-4 py-6 sm:py-8 text-center space-y-2">
        <Bell className="h-7 w-7 text-muted-foreground/60 mx-auto" aria-hidden />
        <p className="text-sm font-semibold text-foreground">
          No communication settings to configure on this page
        </p>
        <p className="text-xs text-muted-foreground max-w-md mx-auto leading-relaxed">
          Delivery channels and recipients are chosen per message in the Communication and
          Messages modules. When per-school defaults (for example notification quiet hours or
          SMS sender IDs) become configurable, they will appear here — nothing is hidden behind
          this empty state today.
        </p>
      </div>

      <p className="text-[11px] text-muted-foreground leading-relaxed flex items-start gap-1.5">
        <Info className="h-3 w-3 mt-px shrink-0" aria-hidden />
        <span>
          Website notices and admission announcements (the public site) are part of the Website
          Management module — see <strong>Website</strong> on this category rail.
        </span>
      </p>

      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <FileText className="h-3 w-3" aria-hidden />
        <span>Every announcement you publish is audit-logged server-side.</span>
      </div>
    </SettingsTab>
  )
}
