import type { WebsiteContent } from '@/lib/website-content'

export interface PublicSchoolData {
  id: string
  name: string
  slug: string
  /** How the server resolved this tenant: 'domain' | 'slug' | 'single' | 'demo'.
   *  ARCHITECTURE RESET — the renderer uses this to decide school-website vs
   *  SCHOLARIO directory landing (a 'demo' fallback with no explicit slug is
   *  a deployment-domain visit, not a school visit). */
  resolvedVia?: string
  code: string
  address?: string
  city?: string
  phone?: string
  email?: string
  website?: string
  academicYear?: string
  isDemo?: boolean
  board?: string
  established?: string
  /** Identity fields (PHASE 7.5 — /api/schools/public flat contract). */
  shortName?: string
  tagline?: string
  affiliation?: string
  principalName?: string
  /** Branding (PHASE 7.5). themeColor/accentColor are hex strings; logoUrl
   *  is a same-origin media URL (or null) served by /api/public/website/media. */
  themeColor?: string
  accentColor?: string
  logoUrl?: string | null
  counts?: {
    students: number
    teachers: number
    classes: number
    subjects: number
    libraryBooks: number
  }
  /** Full website CMS document (server-merged over neutral fallbacks). */
  websiteContent?: WebsiteContent
  /** Published gallery albums (empty array when none are configured). */
  gallery?: PublicGalleryAlbum[]
  announcements?: Array<{
    id: string
    title: string
    message: string
    createdAt: string
    priority: string
    imageId?: string | null
    imageUrl?: string | null
  }>
  /** Task 2-a — live-published CMS notices (kind NOTICE, bounded 20). */
  notices?: PublicWebsiteNotice[]
  /** Task 2-a — live-published CMS announcements (kind ANNOUNCEMENT). */
  websiteAnnouncements?: PublicWebsiteNotice[]
  /** Task 2-a — the admissions singleton, ONLY while published. */
  admissions?: PublicAdmissionsStatus | null
  /** Task 2-a — managed social links (ordered, http(s) only). */
  socialLinks?: PublicSocialLink[]
}

export interface PublicWebsiteNotice {
  id: string
  title: string
  body: string
  category: string | null
  pinned: boolean
  publishedAt: string
  attachmentFileId: string | null
  attachmentUrl: string | null
}

export interface PublicAdmissionsStatus {
  status: 'OPEN' | 'CLOSED'
  session: string | null
  classesAccepting: string[]
  openingDate: string | null
  closingDate: string | null
  noticeTitle: string | null
  noticeBody: string | null
  applicationUrl: string | null
  contactEmail: string | null
  contactPhone: string | null
}

export interface PublicSocialLink {
  id: string
  platform: string
  url: string
  label: string | null
}

export interface PublicGalleryAlbum {
  id: string
  title: string
  description: string | null
  images: Array<{
    id: string
    url: string
    caption: string | null
  }>
}

export interface PublicWebsiteProps {
  onOpenPortal: (role?: string) => void
  onOpenPlatform?: () => void
}
