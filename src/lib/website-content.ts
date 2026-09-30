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
 *  nothing. NO fabricated facts (no ratios, no founding years, no facility
 *  claims): the renderer hides empty optional copy instead of inventing. */
export const NEUTRAL_WEBSITE_CONTENT: WebsiteContent = {
  hero: {
    badgePrefix: 'Admissions open for',
    title: 'Welcome to',
    titleAccent: 'Our School',
    description: 'A learning community focused on curiosity, character, and growth.',
    ctaPrimary: { label: 'Apply for Admission' },
    ctaSecondary: { label: 'Explore Campus Life' },
    imageId: null,
  },
  about: {
    title: 'Why families choose us',
    subtitle: 'What our school stands for.',
  },
  pillars: [
    { icon: 'target', title: 'Academic Focus', description: 'A structured curriculum that builds strong foundations.' },
    { icon: 'heart', title: 'Holistic Growth', description: 'Sports, arts, and life-skills beyond the classroom.' },
    { icon: 'building', title: 'Learning Spaces', description: 'Classrooms and labs designed for engaged learning.' },
    { icon: 'shield', title: 'Safe & Inclusive', description: 'A secure campus where every child is valued.' },
  ],
  journey: {
    title: 'A journey for every stage',
    subtitle: 'Programs for each phase of growth.',
    stages: [
      { icon: 'sprout', title: 'Primary', grades: 'Grade 1–5', years: 'Ages 6–11', description: 'Foundations through discovery and play.' },
      { icon: 'compass', title: 'Middle', grades: 'Grade 6–8', years: 'Ages 11–14', description: 'Concept depth and collaborative projects.' },
      { icon: 'rocket', title: 'Senior', grades: 'Grade 9–12', years: 'Ages 14–18', description: 'Board-focused rigor and career mentoring.' },
    ],
  },
  facilities: {
    title: 'Campus & Facilities',
    subtitle: 'Spaces designed for curiosity and focus.',
    items: [
      { icon: 'library', title: 'Library', description: 'A reading and research space for all grades.' },
      { icon: 'flask', title: 'Science Labs', description: 'Hands-on experimentation for curious minds.' },
      { icon: 'trophy', title: 'Sports', description: 'Facilities that keep every season active.' },
      { icon: 'monitor', title: 'Classrooms', description: 'Engaging, well-equipped learning rooms.' },
    ],
  },
  principalMessage: {
    enabled: false,
    title: "From the Principal's Desk",
    message: '',
  },
  admissions: {
    title: 'Admissions',
    subtitle: 'Joining our community',
    heading: 'We look forward to meeting your family',
    description: 'Submit an inquiry below and our admissions office will reach out with next steps.',
    highlights: [],
    officeHours: '',
  },
  contact: {
    title: 'Visit us',
    subtitle: "We'd love to show you around.",
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
