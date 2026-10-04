'use client'

/**
 * Website category — the Website CMS now lives in its own "Website
 * Management" module (content, notices, admissions, gallery). From
 * Settings, the school sees: a link card to that module + the READ-ONLY
 * domain status card (custom-domain-card.tsx — platform-owned domains).
 *
 * The old website-tab.tsx / website-gallery.tsx editors were retired with
 * this IA change (rebuilt inside the new module).
 */

import { Globe, Info } from 'lucide-react'
import { SettingsTab } from '../shared'
import { CustomDomainCard } from '../custom-domain-card'
import { ModuleLinkCard } from './module-link-card'

export function WebsiteOverviewPage() {
  return (
    <div className="space-y-4">
      <SettingsTab
        icon={Globe}
        title="Website & Domain"
        description="Public website content is edited in the Website Management module; domain connection is platform-owned."
      >
        <ModuleLinkCard
          icon={Globe}
          title="Website Management"
          description="Hero, about, programmes, facilities, gallery, notices and admissions copy for the public website — every section saves independently in its own module."
          moduleKey="website"
          ctaLabel="Open Website Management"
        />
        <p className="text-[11px] text-muted-foreground leading-relaxed flex items-start gap-1.5">
          <Info className="h-3 w-3 mt-px shrink-0" aria-hidden />
          <span>
            Contact details shown on the website (address, phone, email) come from
            <strong> School → School Profile</strong> — keep that record current and the site
            follows it.
          </span>
        </p>
      </SettingsTab>

      <CustomDomainCard />
    </div>
  )
}
