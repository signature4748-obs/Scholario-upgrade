/**
 * website-content — the School Website CMS document model.
 *
 * ONE shared type + defaults + merge used by:
 *   · the server (tenant-scoped read/write through /api/school/website)
 *   · the public website renderer (per-school content w/ neutral fallbacks)
 *   · the settings Website tab editors
 *
 * Storage: `School.websiteContent` (JSON string, per-tenant). The CMS never
 * fabricates content — a school that has not configured a section renders
 * NEUTRAL fallbacks (generic wording, no unverifiable claims), while the
 * demo tenant ships a full editorial document seeded from the previous
 * static copy (prisma/seed-website-cms.ts).
 */

export interface CtaConfig {
  label: string
  href?: string
}

export interface PillarItem {
  icon: string // registry key, mapped to lucide icons by the renderer
  title: string
  description: string
}

export interface JourneyStage {
  icon: string
  title: string
  grades: string
  years: string
  description: string
}

export interface FacilityItem {
  icon: string
  title: string
  description: string
}

export interface WebsiteContent {
  hero: {
    badgePrefix: string
    title: string
    titleAccent: string
    description: string
    ctaPrimary: CtaConfig
    ctaSecondary: CtaConfig
    imageId?: string | null
  }
  about: {
    title: string
    subtitle: string
  }
  pillars: PillarItem[]
  journey: {
    title: string
    subtitle: string
    stages: JourneyStage[]
  }
  facilities: {
    title: string
    subtitle: string
    items: FacilityItem[]
  }
  principalMessage: {
    enabled: boolean
    title: string
    message: string
  }
  admissions: {
    title: string
    subtitle: string
    heading: string
    description: string
    highlights: string[]
    officeHours: string
  }
  contact: {
    title: string
    subtitle: string
  }
  footer: {
    about: string
    social: {
      facebook?: string
      instagram?: string
      youtube?: string
      twitter?: string
      linkedin?: string
    }
  }
  seo: {
    title?: string
    description?: string
  }
}

/** Icon keys the renderer knows (CMS UI offers exactly these). */
export const WEBSITE_ICON_KEYS = [
  'target', 'heart', 'building', 'shield', 'sprout', 'compass', 'rocket',
  'library', 'flask', 'trophy', 'monitor', 'bus', 'palette', 'globe', 'music', 'laptop',
] as const

/** Neutral, claim-free fallbacks — rendered when a school has configured
 *  nothing. ARCHITECTURE RESET: the neutral document is EMPTY by design —
 *  no invented taglines, no marketing pillars, no journey stages, no
 *  facility claims, no admissions promises. The renderer hides any section
 *  whose content is empty; the hero falls back to the SCHOOL NAME (filled
 *  server-side in /api/schools/public). The CMS is the source of truth —
 *  the product never invents school content. */
export const NEUTRAL_WEBSITE_CONTENT: WebsiteContent = {
  hero: {
    badgePrefix: '',
    title: '',
    titleAccent: '',
    description: '',
    ctaPrimary: { label: 'Enquire about Admission' },
    ctaSecondary: { label: 'Login Portal' },
    imageId: null,
  },
  about: {
    title: '',
    subtitle: '',
  },
  pillars: [],
  journey: {
    title: '',
    subtitle: '',
    stages: [],
  },
  facilities: {
    title: '',
    subtitle: '',
    items: [],
  },
  principalMessage: {
    enabled: false,
    title: '',
    message: '',
  },
  admissions: {
    title: 'Admissions',
    subtitle: '',
    heading: '',
    description: 'Submit an enquiry and the school office will follow up.',
    highlights: [],
    officeHours: '',
  },
  contact: {
    title: 'Contact',
    subtitle: '',
  },
  footer: {
    about: '',
    social: {},
  },
  seo: {},
}

/** Deep-merge a stored (possibly partial/legacy) document over the neutral
 *  base — unknown keys dropped, arrays replaced wholesale (editorial lists
 *  are authoritative when present). Never throws on malformed JSON. */
export function mergeWebsiteContent(raw: string | null | undefined): WebsiteContent {
  if (!raw) return structuredClone(NEUTRAL_WEBSITE_CONTENT)
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return structuredClone(NEUTRAL_WEBSITE_CONTENT)
  }
  if (typeof parsed !== 'object' || parsed === null) return structuredClone(NEUTRAL_WEBSITE_CONTENT)
  const src = parsed as Record<string, any>
  const base = structuredClone(NEUTRAL_WEBSITE_CONTENT) as any
  const out: any = base
  for (const key of Object.keys(base)) {
    const incoming = src[key]
    if (incoming === undefined || incoming === null) continue
    if (Array.isArray(base[key])) {
      if (Array.isArray(incoming)) out[key] = incoming
    } else if (typeof base[key] === 'object') {
      if (typeof incoming === 'object' && !Array.isArray(incoming)) {
        out[key] = { ...base[key], ...incoming }
      }
    } else if (typeof incoming === typeof base[key]) {
      out[key] = incoming
    }
  }
  return out as WebsiteContent
}

/** Extract only CMS-owned strings for SEO-safe <meta> rendering. */
export function websiteSeo(content: WebsiteContent, schoolName: string) {
  return {
    title: content.seo.title?.trim() || `${schoolName} — Official Website`,
    description: content.seo.description?.trim() || content.hero.description,
  }
}
