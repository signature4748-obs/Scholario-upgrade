'use client'

// School Settings module — composition root.
//
// IA REDESIGN (Task 2-b): the flat 13-tab strip is replaced by a TWO-PANE
// settings hub — a searchable category rail (left, md+; horizontal
// category/page chips on mobile) and a content pane. Pages are grouped
// into honest categories:
//
//   School        — School Profile (identity + platform change-request
//                   workflow), Branding, Academic Session, Rooms &
//                   Facilities, School Preferences (module flags)
//   People & …    — pointers to the Teachers / Students modules, the
//                   read-only role model, honest invitations empty state
//   Academic      — Timetable, Attendance, ID Cards, Uniforms
//   Finance       — Fees, Library Rules (fines), Salary pointer
//   Communication — pointers to the Communication / Messages modules
//   Website       — pointer to the Website Management module + the
//                   read-only domain status card (platform-owned)
//   Security      — My Account (password / sessions)
//
// Every existing settings page component is REUSED as-is (reorganized,
// not rewritten); the old website-tab/website-gallery editors were
// deleted (rebuilt inside the new Website Management module).
//
// Store hydration: on principal panel mount the school-settings store
// syncs from GET /api/school-settings (server-sync.ts — once-per-session
// promise, honest error state) so identity/branding and every settings
// slice follow the database.

import { useMemo, useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  Settings as SettingsIcon, School, Palette, BookOpen, DoorOpen, Blocks, Users,
  KeyRound, MailPlus, GraduationCap, CalendarCheck, IdCard, Shirt, IndianRupee,
  BookMarked, Wallet, Megaphone, Globe, ShieldCheck, Clock, Search, SearchX,
} from 'lucide-react'
import { SectionHeading } from '@/components/shared/ui'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

import { IdentityTab } from './identity-tab'
import { BrandingTab } from './branding-tab'
import { AcademicsTab } from './academics-tab'
import { FacilitiesTab } from './facilities-tab'
import { TimetableTab } from './timetable-tab'
import { AttendanceTab } from './attendance-tab'
import { FeesTab } from './fees-tab'
import { UniformsTab } from './uniforms-tab'
import { LibraryTab } from './library-tab'
import { IdCardTab } from './id-card-tab'
import { ModulesTab } from './modules-tab'
import { SecurityTab } from './security-tab'

import { PeopleOverviewPage } from './pages/people-overview'
import { RolesPermissionsPage } from './pages/roles-permissions'
import { InvitationsPage } from './pages/invitations'
import { SalaryPointerPage } from './pages/salary-pointer'
import { CommunicationOverviewPage } from './pages/communication-overview'
import { WebsiteOverviewPage } from './pages/website-overview'

/* ── Settings information architecture ────────────────────────────── */

interface SettingsPageDef {
  key: string
  label: string
  icon: LucideIcon
  /** One-line hint shown as the rail chip title (and used by search). */
  description: string
  /** Extra search vocabulary (e.g. legacy tab names). */
  keywords?: string[]
  render: () => React.ReactNode
}

interface SettingsCategoryDef {
  key: string
  label: string
  icon: LucideIcon
  pages: SettingsPageDef[]
}

const CATEGORIES: SettingsCategoryDef[] = [
  {
    key: 'school',
    label: 'School',
    icon: School,
    pages: [
      {
        key: 'school-profile',
        label: 'School Profile',
        icon: School,
        description: 'Legal identity, contact details and presentation on official records.',
        keywords: ['identity', 'name', 'code', 'affiliation', 'address', 'phone', 'email', 'tagline'],
        render: () => <IdentityTab />,
      },
      {
        key: 'branding',
        label: 'Branding',
        icon: Palette,
        description: 'Colors, logo and favicon for the website, login and documents.',
        keywords: ['colors', 'logo', 'favicon', 'theme'],
        render: () => <BrandingTab />,
      },
      {
        key: 'academics',
        label: 'Academic Session',
        icon: BookOpen,
        description: 'Session, board and the class/subject masters.',
        keywords: ['session', 'board', 'classes', 'subjects'],
        render: () => <AcademicsTab />,
      },
      {
        key: 'facilities',
        label: 'Rooms & Facilities',
        icon: DoorOpen,
        description: 'Rooms and facilities used across the timetable.',
        keywords: ['rooms', 'facilities', 'labs'],
        render: () => <FacilitiesTab />,
      },
      {
        key: 'preferences',
        label: 'School Preferences',
        icon: Blocks,
        description: 'The feature modules available to this school.',
        keywords: ['modules', 'flags', 'features'],
        render: () => <ModulesTab />,
      },
    ],
  },
  {
    key: 'people',
    label: 'People & Access',
    icon: Users,
    pages: [
      {
        key: 'people',
        label: 'People',
        icon: Users,
        description: 'Where teachers, students and parents are managed.',
        keywords: ['teachers', 'students', 'parents', 'guardians', 'directory'],
        render: () => <PeopleOverviewPage />,
      },
      {
        key: 'roles',
        label: 'Roles & Permissions',
        icon: KeyRound,
        description: 'What each role can do — read-only summary.',
        keywords: ['permissions', 'roles', 'access', 'capabilities'],
        render: () => <RolesPermissionsPage />,
      },
      {
        key: 'invitations',
        label: 'Invitations',
        icon: MailPlus,
        description: 'How new people get their accounts (no invite emails).',
        keywords: ['invite', 'account', 'credentials', 'signup'],
        render: () => <InvitationsPage />,
      },
    ],
  },
  {
    key: 'academic',
    label: 'Academic',
    icon: GraduationCap,
    pages: [
      {
        key: 'timetable',
        label: 'Timetable',
        icon: Clock,
        description: 'School-day timings and the master period ladder.',
        keywords: ['periods', 'bells', 'school day'],
        render: () => <TimetableTab />,
      },
      {
        key: 'attendance',
        label: 'Attendance',
        icon: CalendarCheck,
        description: 'Status thresholds and late-arrival rules.',
        keywords: ['policy', 'absent', 'late'],
        render: () => <AttendanceTab />,
      },
      {
        key: 'id-cards',
        label: 'ID Cards',
        icon: IdCard,
        description: 'The student identity-card template and preview.',
        keywords: ['idcard', 'card', 'template'],
        render: () => <IdCardTab />,
      },
      {
        key: 'uniforms',
        label: 'Uniforms',
        icon: Shirt,
        description: 'Uniform items, sizes and pricing.',
        keywords: ['apparel', 'dress code'],
        render: () => <UniformsTab />,
      },
    ],
  },
  {
    key: 'finance',
    label: 'Finance',
    icon: IndianRupee,
    pages: [
      {
        key: 'fees',
        label: 'Fees',
        icon: IndianRupee,
        description: 'Local fee heads and templates for the school.',
        keywords: ['fee heads', 'concessions', 'installments'],
        render: () => <FeesTab />,
      },
      {
        key: 'library-rules',
        label: 'Library Rules',
        icon: BookMarked,
        description: 'Issue limits, lending period and overdue fines.',
        keywords: ['library', 'fine', 'books', 'issue'],
        render: () => <LibraryTab />,
      },
      {
        key: 'salary',
        label: 'Salary',
        icon: Wallet,
        description: 'Salary & Payroll lives in its own module — pointer.',
        keywords: ['payroll', 'pay', 'salary'],
        render: () => <SalaryPointerPage />,
      },
    ],
  },
  {
    key: 'communication',
    label: 'Communication',
    icon: Megaphone,
    pages: [
      {
        key: 'communication',
        label: 'Overview',
        icon: Megaphone,
        description: 'Announcements, circulars and messages — module pointers.',
        keywords: ['announcements', 'notices', 'sms', 'templates', 'messages'],
        render: () => <CommunicationOverviewPage />,
      },
    ],
  },
  {
    key: 'website',
    label: 'Website',
    icon: Globe,
    pages: [
      {
        key: 'website',
        label: 'Website & Domain',
        icon: Globe,
        description: 'Website Management module pointer + domain status.',
        keywords: ['cms', 'domain', 'gallery', 'notices', 'seo'],
        render: () => <WebsiteOverviewPage />,
      },
    ],
  },
  {
    key: 'security',
    label: 'Security',
    icon: ShieldCheck,
    pages: [
      {
        key: 'my-account',
        label: 'My Account',
        icon: ShieldCheck,
        description: 'Your password, sessions and sign-in security.',
        keywords: ['password', 'sessions', 'account', 'login'],
        render: () => <SecurityTab />,
      },
    ],
  },
]

const ALL_PAGES: Array<{ category: SettingsCategoryDef; page: SettingsPageDef }> =
  CATEGORIES.flatMap((category) => category.pages.map((page) => ({ category, page })))

/* ── Search ───────────────────────────────────────────────────────── */

function pageMatches(page: SettingsPageDef, categoryLabel: string, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  const haystack = [page.label, categoryLabel, page.description, ...(page.keywords ?? [])]
    .join(' ')
    .toLowerCase()
  return q.split(/\s+/).every((term) => haystack.includes(term))
}

/** Highlights the first matching query run inside `text` (search UX). */
function Highlight({ text, query }: { text: string; query: string }) {
  const q = query.trim()
  if (!q) return <>{text}</>
  const idx = text.toLowerCase().indexOf(q.toLowerCase())
  if (idx < 0) return <>{text}</>
  const end = idx + q.length
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-amber-200/70 dark:bg-amber-500/25 text-foreground rounded-[3px] px-0.5">
        {text.slice(idx, end)}
      </mark>
      {text.slice(end)}
    </>
  )
}

/* ── Module ───────────────────────────────────────────────────────── */

export function SchoolSettingsModule() {
  const [activePageKey, setActivePageKey] = useState('school-profile')
  const [query, setQuery] = useState('')

  const active = ALL_PAGES.find(({ page }) => page.key === activePageKey) ?? ALL_PAGES[0]

  // Client-side rail filter: pages matching the query, grouped under their
  // categories (categories without matches are hidden while searching).
  const filteredCategories = useMemo(() => {
    const q = query.trim()
    return CATEGORIES.map((category) => ({
      ...category,
      pages: category.pages.filter((page) => pageMatches(page, category.label, q)),
    })).filter((category) => category.pages.length > 0)
  }, [query])

  const matchCount = useMemo(
    () => filteredCategories.reduce((n, c) => n + c.pages.length, 0),
    [filteredCategories],
  )
  const hasQuery = query.trim().length > 0
  const searching = hasQuery && matchCount === 0

  const activeCategory = active.category
  const categoryChips = hasQuery ? filteredCategories : CATEGORIES

  return (
    <div className="space-y-5">
      <SectionHeading
        title="School Settings"
        subtitle="Server-backed school configuration · grouped by School, People & Access, Academic, Finance, Communication, Website and Security"
        icon={<SettingsIcon className="h-5 w-5" />}
      />

      <div className="md:flex md:items-start md:gap-6">
        {/* ── Rail: search + category navigation ────────────────────── */}
        <nav
          aria-label="Settings categories"
          className="md:w-64 lg:w-72 md:shrink-0 md:sticky md:top-4 md:max-h-[calc(100vh-8rem)] md:overflow-y-auto custom-scrollbar space-y-3 mb-4 md:mb-0"
        >
          {/* Search box (filters the rail items by label) */}
          <div className="relative">
            <Search
              className="h-3.5 w-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
              aria-hidden
            />
            <Input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search settings pages…"
              aria-label="Search settings pages"
              className="h-9 pl-8.5 text-xs rounded-lg"
            />
          </div>

          {/* Mobile: horizontal category chips + page chips. */}
          <div className="md:hidden space-y-2">
            <div
              className="flex gap-1.5 overflow-x-auto custom-scrollbar -mx-1 px-1 py-0.5"
              role="tablist"
              aria-label="Settings categories"
            >
              {categoryChips.map((category) => {
                const isActive = activeCategory.key === category.key
                return (
                  <button
                    key={category.key}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    onClick={() => setActivePageKey(category.pages[0].key)}
                    className={cn(
                      'flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-xs font-medium transition-colors',
                      isActive
                        ? 'bg-foreground text-background border-foreground'
                        : 'border-border bg-card text-muted-foreground hover:text-foreground',
                    )}
                  >
                    <category.icon className="h-3.5 w-3.5" aria-hidden />
                    <Highlight text={category.label} query={hasQuery ? query : ''} />
                  </button>
                )
              })}
            </div>

            {/* Page chips: the active category's pages (all matching pages
                while searching). Hidden for single-page categories. */}
            {(hasQuery
              ? matchCount > 0
                ? filteredCategories.flatMap((c) => c.pages)
                : []
              : activeCategory.pages.length > 1
                ? activeCategory.pages
                : []
            ).length > 0 && (
              <div
                className="flex gap-1.5 overflow-x-auto custom-scrollbar -mx-1 px-1 py-0.5"
                role="tablist"
                aria-label="Settings pages"
              >
                {(hasQuery
                  ? filteredCategories.flatMap((c) => c.pages)
                  : activeCategory.pages
                ).map((page) => {
                  const isActive = page.key === activePageKey
                  return (
                    <button
                      key={page.key}
                      type="button"
                      role="tab"
                      aria-selected={isActive}
                      title={page.description}
                      onClick={() => setActivePageKey(page.key)}
                      className={cn(
                        'flex h-7.5 min-h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-[11px] font-medium transition-colors',
                        isActive
                          ? 'bg-muted text-foreground border-foreground/30'
                          : 'border-transparent bg-muted/40 text-muted-foreground hover:text-foreground',
                      )}
                    >
                      <page.icon className="h-3 w-3" aria-hidden />
                      <Highlight text={page.label} query={hasQuery ? query : ''} />
                    </button>
                  )
                })}
              </div>
            )}

            {searching && (
              <div className="flex items-center gap-2 rounded-lg border border-dashed border-border bg-muted/30 px-3 py-2.5 text-[11px] text-muted-foreground">
                <SearchX className="h-3.5 w-3.5 shrink-0" aria-hidden />
                <span>
                  No settings pages match “<span className="font-medium text-foreground">{query.trim()}</span>”.
                </span>
              </div>
            )}
          </div>

          {/* Desktop: full category rail with nested pages. */}
          <div className="hidden md:block space-y-3">
            {filteredCategories.map((category) => (
              <div key={category.key} className="space-y-1">
                <div className="flex items-center gap-1.5 px-2.5 pt-1.5 pb-0.5">
                  <category.icon className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                  <span className="text-[10px] uppercase font-semibold tracking-wider text-muted-foreground">
                    <Highlight text={category.label} query={hasQuery ? query : ''} />
                  </span>
                </div>
                <ul className="space-y-0.5">
                  {category.pages.map((page) => {
                    const isActive = page.key === activePageKey
                    return (
                      <li key={page.key}>
                        <button
                          type="button"
                          onClick={() => setActivePageKey(page.key)}
                          aria-current={isActive ? 'page' : undefined}
                          title={page.description}
                          className={cn(
                            'flex w-full items-center gap-2 rounded-lg px-2.5 min-h-9 py-1.5 text-left text-xs transition-colors',
                            isActive
                              ? 'bg-muted text-foreground font-semibold'
                              : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
                          )}
                        >
                          <page.icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
                          <span className="truncate">
                            <Highlight text={page.label} query={hasQuery ? query : ''} />
                          </span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </div>
            ))}

            {searching && (
              <div className="flex items-start gap-2 rounded-lg border border-dashed border-border bg-muted/30 px-3 py-2.5 text-[11px] text-muted-foreground">
                <SearchX className="h-3.5 w-3.5 shrink-0 mt-px" aria-hidden />
                <span>
                  No settings pages match “<span className="font-medium text-foreground">{query.trim()}</span>”.
                </span>
              </div>
            )}
          </div>
        </nav>

        {/* ── Content pane ─────────────────────────────────────────── */}
        <div className="flex-1 min-w-0" role="tabpanel" aria-label={`${activeCategory.label} settings`}>
          <div key={active.page.key} className="animate-in fade-in-0 slide-in-from-bottom-1 duration-300">
            {active.page.render()}
          </div>
        </div>
      </div>
    </div>
  )
}

export default SchoolSettingsModule
