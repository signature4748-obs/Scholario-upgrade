'use client'

/**
 * Website Management module (task 2-a).
 *
 * The principal's CMS cockpit for the public school website. A
 * sub-navigation (left rail on desktop, horizontal scroll strip on
 * mobile) switches between the sections; each section is its own file
 * under modules/website/ with honest loading / error / empty states.
 *
 *   Overview · Homepage · Notices · Announcements · Gallery · Admissions
 *   About · Academics · Facilities · Contact · Social Links · Media Library
 *
 * Every write goes through the tenant-scoped /api/school/website/* APIs
 * (session school — a client schoolId is never read server-side).
 */

import { useEffect, useState } from 'react'
import {
  Globe, Home, Megaphone, PartyPopper, Images, DoorOpen, FileText,
  Compass, BookOpen, Mail, Link2, ImageIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { PageTransition } from '@/components/shared/ui'
import { ModuleHeader } from '../shared/module-header'
import { OverviewSection, type WebsiteSectionKey } from './overview'
import { HomepageSection } from './homepage'
import { NoticesManager } from './notices'
import { AnnouncementsSection } from './announcements'
import { GallerySection } from './gallery'
import { AdmissionsSection } from './admissions'
import { AboutSection } from './about'
import { AcademicsSection } from './academics'
import { FacilitiesSection } from './facilities'
import { ContactSection } from './contact'
import { SocialLinksSection } from './social-links'
import { MediaLibrarySection } from './media-library'

const SECTION_MEMORY_KEY = 'scholario-website-section'

const SECTIONS: Array<{
  key: WebsiteSectionKey
  label: string
  icon: React.ComponentType<{ className?: string }>
}> = [
  { key: 'overview', label: 'Overview', icon: Globe },
  { key: 'homepage', label: 'Homepage', icon: Home },
  { key: 'notices', label: 'Notices', icon: Megaphone },
  { key: 'announcements', label: 'Announcements', icon: PartyPopper },
  { key: 'gallery', label: 'Gallery', icon: Images },
  { key: 'admissions', label: 'Admissions', icon: DoorOpen },
  { key: 'about', label: 'About School', icon: FileText },
  { key: 'academics', label: 'Academics', icon: Compass },
  { key: 'facilities', label: 'Facilities', icon: BookOpen },
  { key: 'contact', label: 'Contact', icon: Mail },
  { key: 'social-links', label: 'Social Links', icon: Link2 },
  { key: 'media-library', label: 'Media Library', icon: ImageIcon },
]

function initialSection(): WebsiteSectionKey {
  if (typeof window === 'undefined') return 'overview'
  // ?section= deep-link (forwarded from the Overview quick links).
  const requested = new URLSearchParams(window.location.search).get('section')
  if (requested && SECTIONS.some((s) => s.key === requested)) return requested as WebsiteSectionKey
  try {
    const remembered = window.sessionStorage.getItem(SECTION_MEMORY_KEY)
    if (remembered && SECTIONS.some((s) => s.key === remembered)) {
      return remembered as WebsiteSectionKey
    }
  } catch {
    /* storage disabled — honest fallback */
  }
  return 'overview'
}

export function WebsiteManagementModule() {
  const [active, setActive] = useState<WebsiteSectionKey>(initialSection)

  useEffect(() => {
    try {
      window.sessionStorage.setItem(SECTION_MEMORY_KEY, active)
    } catch {
      /* storage disabled — nothing to remember */
    }
  }, [active])

  const navigate = (key: WebsiteSectionKey) => {
    setActive(key)
    // Keep the top of the section in view when switching (the sub-nav can
    // scroll away on long sections).
    document.getElementById('website-module-top')?.scrollIntoView({ block: 'start' })
  }

  return (
    <div id="website-module-top" className="min-w-0">
      <ModuleHeader
        label="Website Management"
        meta={['Public school website · CMS']}
      />

      <div className="lg:grid lg:grid-cols-[212px_minmax(0,1fr)] lg:gap-6 items-start">
        {/* Desktop left rail */}
        <nav
          className="hidden lg:flex flex-col gap-0.5 rounded-xl border border-border bg-card/40 p-1.5 lg:sticky lg:top-16"
          aria-label="Website sections"
        >
          {SECTIONS.map((s) => {
            const isActive = active === s.key
            return (
              <button
                key={s.key}
                onClick={() => navigate(s.key)}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-2.5 rounded-lg px-3 h-9 text-xs font-medium text-left transition-colors',
                  isActive
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/60',
                )}
              >
                <s.icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
                <span className="truncate">{s.label}</span>
              </button>
            )
          })}
        </nav>

        <div className="min-w-0 space-y-5">
          {/* Mobile horizontal scroll strip */}
          <nav
            className="lg:hidden flex gap-1.5 overflow-x-auto custom-scrollbar -mx-1 px-1 py-1"
            aria-label="Website sections"
          >
            {SECTIONS.map((s) => {
              const isActive = active === s.key
              return (
                <button
                  key={s.key}
                  onClick={() => setActive(s.key)}
                  aria-current={isActive ? 'page' : undefined}
                  className={cn(
                    'flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3 h-8 text-xs font-medium transition-colors shrink-0',
                    isActive
                      ? 'bg-primary/10 text-primary border-primary/30'
                      : 'border-border text-muted-foreground hover:text-foreground',
                  )}
                >
                  <s.icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  <span>{s.label}</span>
                </button>
              )
            })}
          </nav>

          <PageTransition key={active}>
            {active === 'overview' ? (
              <OverviewSection onNavigate={navigate} />
            ) : active === 'homepage' ? (
              <HomepageSection />
            ) : active === 'notices' ? (
              <NoticesManager kind="NOTICE" />
            ) : active === 'announcements' ? (
              <AnnouncementsSection />
            ) : active === 'gallery' ? (
              <GallerySection />
            ) : active === 'admissions' ? (
              <AdmissionsSection />
            ) : active === 'about' ? (
              <AboutSection />
            ) : active === 'academics' ? (
              <AcademicsSection />
            ) : active === 'facilities' ? (
              <FacilitiesSection />
            ) : active === 'contact' ? (
              <ContactSection />
            ) : active === 'social-links' ? (
              <SocialLinksSection />
            ) : (
              <MediaLibrarySection />
            )}
          </PageTransition>
        </div>
      </div>
    </div>
  )
}

export default WebsiteManagementModule
