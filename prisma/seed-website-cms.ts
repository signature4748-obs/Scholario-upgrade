/**
 * PHASE 7.5 seed — school configuration + website CMS + gallery for the
 * demo tenant.
 *
 * Makes the demo school's identity / branding / website content / gallery
 * REAL DB rows (the source of truth the settings UI, public site, and
 * login hydrate from) instead of component constants:
 *
 *   1. School identity columns (shortName, tagline, affiliation, website,
 *      principalName, established) — the values the public site + settings
 *      General tab previously hardcoded.
 *   2. School.websiteContent — the CMS document carrying the public
 *      website's editorial copy (hero, pillars, journey stages, facilities,
 *      admissions, contact, footer). Extracted verbatim from the previous
 *      component constants so the rendered site stays identical.
 *   3. School.settings — canonical configuration JSON seed (timetable
 *      ladder mirrored from lib/timetable/config PERIODS).
 *   4. Gallery — the five campus photographs registered as UploadedFile
 *      rows (scope 'website') and one PUBLISHED "Campus Life" album, so
 *      the public gallery renders from the DB like any school's would.
 *
 * Phase 8A (8A-C9b): the gallery bytes are stored in Supabase Storage's
 * PUBLIC 'public-media' bucket at the deterministic
 * `website/<schoolId>/<fileId>` path (x-upsert, idempotent) — the same
 * location /api/public/website/media redirects to. No local-disk copy.
 *
 * Idempotent: re-running refreshes content but never duplicates rows.
 * Usage: bun prisma/seed-website-cms.ts
 */
import { PrismaClient } from '@prisma/client'
import { randomBytes } from 'crypto'
import { readFile } from 'fs/promises'
import path from 'path'
import { assertSeedable } from './seed-guard'
import { DEMO_SCHOOL_SLUG } from './seed-identity'
import { storageUpload, storagePublicUrl } from '../src/lib/storage/supabase'

const db = new PrismaClient()

const SLUG = process.env.SEED_SCHOOL_SLUG || DEMO_SCHOOL_SLUG

async function main() {
  // Phase 8A — shared seed lock (fail-safe, first statement).
  assertSeedable('seed-website-cms')

  const school = await db.school.findUnique({ where: { slug: SLUG } })
  if (!school) {
    console.log(`[seed-website-cms] school "${SLUG}" not found — nothing to seed.`)
    return
  }

  // ── 1. Identity columns (only fill what is not already configured) ──
  // Phase 8A rebrand: Greenwood identity → Sunrise Academy.
  const identity = {
    shortName: school.shortName ?? 'Sunrise',
    tagline: school.tagline ?? 'Excellence in Education & Innovation',
    affiliation: school.affiliation ?? 'CBSE — Affiliation No. 1730456',
    website: school.website ?? 'https://sunriseacademy.edu',
    principalName: school.principalName ?? 'Dr. Ananya Iyer',
    established: school.established ?? '1995',
  }

  // ── 2. Website CMS document (current public-site copy, verbatim) ────
  const websiteContent: Record<string, unknown> = {
    hero: {
      badgePrefix: 'Admissions open for',
      title: 'Empowering Minds,',
      titleAccent: 'Inspiring Excellence',
      description:
        'A future-ready learning community where tradition meets innovation. Discover an education that nurtures intellect, character, and curiosity.',
      ctaPrimary: { label: 'Apply for Admission' },
      ctaSecondary: { label: 'Explore Campus Life' },
    },
    pillars: [
      {
        icon: 'target',
        title: 'Academic Excellence',
        description: 'A rigorous, NEP-aligned curriculum that consistently produces top-tier board results.',
      },
      {
        icon: 'heart',
        title: 'Holistic Growth',
        description: 'Sports, arts, and life-skills programs that shape confident, well-rounded individuals.',
      },
      {
        icon: 'building',
        title: 'Modern Facilities',
        description: 'Smart classrooms, advanced labs, and digital libraries built for 21st-century learning.',
      },
      {
        icon: 'shield',
        title: 'Safe & Inclusive',
        description: 'A nurturing, secure campus where every child feels seen, heard, and valued.',
      },
    ],
    journey: {
      title: 'A journey built for every stage',
      subtitle: 'From first steps to final boards — a program for each phase of growth.',
      stages: [
        {
          title: 'Primary',
          grades: 'Grade 1–5',
          years: 'Ages 6–11',
          description:
            'Play-based foundations, phonics, numeracy, and curiosity-driven discovery in warm, colorful spaces.',
          icon: 'sprout',
        },
        {
          title: 'Middle',
          grades: 'Grade 6–8',
          years: 'Ages 11–14',
          description:
            'Concept depth, lab sciences, collaborative projects, and the independence to own their learning.',
          icon: 'compass',
        },
        {
          title: 'Senior',
          grades: 'Grade 9–12',
          years: 'Ages 14–18',
          description:
            'Board-focused rigor, career mentoring, and streams that open every university pathway.',
          icon: 'rocket',
        },
      ],
    },
    facilities: {
      title: 'Campus & Facilities',
      subtitle: 'Spaces designed for curiosity, movement, and quiet focus.',
      items: [
        {
          icon: 'library',
          title: 'The Library',
          description: 'A sunlit reading haven with curated titles and a digital research hub.',
        },
        {
          icon: 'flask',
          title: 'Science Labs',
          description: 'Physics, chemistry, and biology labs built for hands-on experimentation.',
        },
        {
          icon: 'trophy',
          title: 'Sports Complex',
          description: 'Courts, fields, and indoor facilities that keep every season active.',
        },
        {
          icon: 'monitor',
          title: 'Smart Classrooms',
          description: 'Interactive panels and AV tools in every classroom.',
        },
      ],
    },
    admissions: {
      title: 'Admissions',
      subtitle: 'Joining our community',
      heading: 'A place for every ambition',
      description:
        'We look forward to meeting your family. Submit an inquiry below and our admissions office will reach out with next steps, campus visit options, and the application checklist.',
      highlights: [
        'Campus tours every Saturday, 10 am – 1 pm',
        'Interaction-based assessment — no entrance exam stress',
        'Sibling and merit scholarships available',
      ],
      officeHours: 'Admissions office: Monday to Saturday, 9 am – 4 pm',
    },
    contact: {
      title: 'Visit us',
      subtitle: "We'd love to show you around.",
    },
    footer: {
      about:
        'Nurturing minds, shaping character, and inspiring excellence.',
      social: {
        facebook: 'https://facebook.com/sunriseacademyedu',
        instagram: 'https://instagram.com/sunriseacademyedu',
        youtube: 'https://youtube.com/@sunriseacademyedu',
        twitter: 'https://x.com/sunriseacademyedu',
      },
    },
    seo: {
      title: 'Sunrise Academy — Excellence in Education',
      description:
        'A future-ready learning community where tradition meets innovation. Admissions open.',
    },
  }

  // ── 3. Canonical settings JSON (timetable ladder mirror) ────────────
  const settings: Record<string, unknown> = {
    timetable: {
      dayStart: '08:30 AM',
      dayEnd: '02:45 PM',
      periodMinutes: 45,
      shortBreakAfterPeriod: 3,
      shortBreakMinutes: 15,
      lunchAfterPeriod: 6,
      lunchMinutes: 30,
      workingDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
    },
    attendance: {
      lateAfterMinutes: 15,
      notifyGuardianOnAbsent: true,
    },
  }

  await db.school.update({
    where: { id: school.id },
    data: {
      ...identity,
      settings: JSON.stringify(settings),
      websiteContent: JSON.stringify(websiteContent),
    },
  })
  console.log('[seed-website-cms] school identity + settings + websiteContent updated')

  // ── 4. Gallery: campus images → registered files + published album ──
  const images = [
    { src: 'library.jpg', caption: 'The Library', description: '30,000+ titles & a digital research hub', order: 1 },
    { src: 'science-lab.jpg', caption: 'Science Labs', description: 'Hands-on experimentation spaces', order: 2 },
    { src: 'sports.jpg', caption: 'Sports Complex', description: 'Courts, fields & indoor facilities', order: 3 },
    { src: 'classroom.jpg', caption: 'Smart Classrooms', description: 'Interactive learning environments', order: 4 },
  ]

  const principal = await db.user.findFirst({
    where: { schoolId: school.id, role: 'PRINCIPAL' },
    select: { id: true },
  })

  const campusDir = path.join(process.cwd(), 'public', 'images', 'campus')

  let album = await db.galleryAlbum.findUnique({
    where: { schoolId_title: { schoolId: school.id, title: 'Campus Life' } },
    include: { images: true },
  })
  if (!album) {
    album = await db.galleryAlbum.create({
      data: { schoolId: school.id, title: 'Campus Life', published: true, order: 1 },
      include: { images: true },
    })
  }

  for (const img of images) {
    const existing = album.images.find((i) => i.caption === img.caption)
    if (existing) continue
    const source = path.join(campusDir, img.src)
    try {
      const bytes = await readFile(source)
      const fileId = `seed-${randomBytes(6).toString('hex')}.jpg`
      // Phase 8A: store in the PUBLIC 'public-media' bucket at the
      // deterministic website/<schoolId>/<fileId> path (x-upsert).
      const stored = await storageUpload('website', fileId, bytes, 'image/jpeg', school.id)
      await db.uploadedFile.create({
        data: {
          id: fileId,
          schoolId: school.id,
          scope: 'website',
          uploadedById: principal?.id ?? 'seed',
        },
      })
      await db.galleryImage.create({
        data: {
          albumId: album.id,
          fileId,
          caption: `${img.caption} — ${img.description}`,
          order: img.order,
        },
      })
      console.log(
        `[seed-website-cms] gallery image registered: ${img.caption} ` +
          `→ ${storagePublicUrl(stored.bucket, stored.path)}`,
      )
    } catch (e) {
      console.warn(`[seed-website-cms] skip ${img.src}: ${(e as Error).message}`)
    }
  }

  // ensure the album reflects published state
  await db.galleryAlbum.update({ where: { id: album.id }, data: { published: true } })

  const final = await db.school.findUnique({
    where: { id: school.id },
    select: { shortName: true, settings: true, websiteContent: true },
  })
  console.log('[seed-website-cms] final state:', {
    shortName: final?.shortName,
    settingsBytes: final?.settings?.length ?? 0,
    websiteContentBytes: final?.websiteContent?.length ?? 0,
  })
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
