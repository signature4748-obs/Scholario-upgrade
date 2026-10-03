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
  // Final-acceptance rebrand: Sunrise → Hawkings High School Prithvipur.
  // ARCHITECTURE RESET — NO INVENTED TAGLINES: a school that has not
  // provided a tagline shows none (the name IS the identity). No slogan,
  // no motto, no marketing line is ever seeded as default content.
  const identity = {
    shortName: school.shortName ?? 'Hawkings High',
    tagline: school.tagline ?? null,
    affiliation: school.affiliation ?? 'CBSE (Patna Region)',
    website: school.website ?? 'https://hawkingshigh.edu',
    principalName: school.principalName ?? 'Dr. (Smt.) Sunita Verma',
    established: school.established ?? '2004',
  }

  // ── 2. Website CMS document — HONEST DEMO CONTENT (ARCHITECTURE RESET).
  // Only factual, school-provided statements. No slogan hero, no marketing
  // pillars, no invented claims. Sections the school did not provide are
  // simply absent (the renderer omits empty sections — nothing is invented
  // to fill space). The hero title is the school name.
  const websiteContent: Record<string, unknown> = {
    hero: {
      badgePrefix: '',
      title: 'Hawkings High School Prithvipur',
      titleAccent: '',
      description:
        'English-medium, CBSE-pattern education from Nursery to Class 12, serving Prithvipur, Ghazipur since 2004.',
      ctaPrimary: { label: 'Enquire about Admission' },
      ctaSecondary: { label: 'Login Portal' },
    },
    journey: {
      title: 'Programme',
      subtitle: 'Nursery to Class 12, on one campus.',
      stages: [
        {
          title: 'Pre-Primary',
          grades: 'Nursery – IKG',
          years: 'Ages 3–6',
          description: 'Play-based foundations — rhymes, colours, numbers.',
          icon: 'sprout',
        },
        {
          title: 'Primary',
          grades: 'Classes 1–5',
          years: 'Ages 6–11',
          description: 'Reading, writing and numeracy with class teachers.',
          icon: 'compass',
        },
        {
          title: 'Middle',
          grades: 'Classes 6–8',
          years: 'Ages 11–14',
          description: 'Mathematics, Science, Sanskrit and Computer Education.',
          icon: 'compass',
        },
        {
          title: 'Secondary & Senior',
          grades: 'Classes 9–12',
          years: 'Ages 14–18',
          description: 'Science stream (PCM/PCB) with regular tests and remedial support.',
          icon: 'rocket',
        },
      ],
    },
    facilities: {
      title: 'Campus & Facilities',
      subtitle: '',
      items: [
        {
          icon: 'library',
          title: 'The Library',
          description: 'Hindi and English titles for all grades.',
        },
        {
          icon: 'flask',
          title: 'Science Laboratory',
          description: 'Physics, Chemistry and Biology practicals up to Class 12.',
        },
        {
          icon: 'monitor',
          title: 'Computer Lab',
          description: 'Computer Education periods for Classes 9–12.',
        },
        {
          icon: 'trophy',
          title: 'Playground',
          description: 'School ground for games periods, sports day and the annual function.',
        },
      ],
    },
    admissions: {
      title: 'Admissions',
      subtitle: '',
      heading: '',
      description:
        'Registrations for the 2027-28 session open in January. Visit the school office with your child\'s birth certificate, Aadhaar and the previous Transfer Certificate.',
      highlights: [
        'Registration at the school office — 10:00 AM to 2:00 PM',
        'Interaction with the child — no entrance exam',
        'Sibling concession on tuition; merit scholarships from Class 9',
      ],
      officeHours: 'School office: Monday to Saturday, 8:00 AM – 2:00 PM',
    },
    contact: {
      title: 'Contact',
      subtitle: '',
    },
    footer: {
      about:
        'Hawkings High School Prithvipur — serving Prithvipur, Ghazipur since 2004.',
      social: {
        facebook: 'https://facebook.com/hawkingshighprithvipur',
        instagram: 'https://instagram.com/hawkingshigh',
        youtube: 'https://youtube.com/@hawkingshighschool',
        twitter: 'https://x.com/hawkingshigh',
      },
    },
    seo: {
      title: 'Hawkings High School Prithvipur — Ghazipur, Uttar Pradesh',
      description:
        'CBSE-pattern English-medium school in Prithvipur, Ghazipur (UP) — Nursery to Class 12.',
    },
  }

  // ── 3. Canonical settings JSON (timetable ladder mirror) ────────────
  const settings: Record<string, unknown> = {
    timetable: {
      dayStart: '08:00 AM',
      dayEnd: '03:00 PM',
      periodMinutes: 45,
      shortBreakAfterPeriod: 3,
      shortBreakMinutes: 30,
      lunchAfterPeriod: 6,
      lunchMinutes: 30,
      workingDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
    },
    attendance: {
      lateAfterMinutes: 15,
      notifyGuardianOnAbsent: true,
    },
  }

  // ── 2b. The school CREST — repo branding asset → public-media storage,
  //        registered as an UploadedFile (scope 'website'), referenced by
  //        School.logoUrl (the fileId the media route serves).
  const crestPath = path.join(process.cwd(), 'public', 'images', 'branding', 'hawkings-crest.png')
  try {
    const crestBytes = await readFile(crestPath)
    const crestId = 'seed-hawkings-crest.png'
    await storageUpload('website', crestId, crestBytes, 'image/png', school.id)
    await db.uploadedFile.upsert({
      where: { id: crestId },
      update: { schoolId: school.id, scope: 'website' },
      create: {
        id: crestId,
        schoolId: school.id,
        scope: 'website',
        uploadedById: (await db.user.findFirst({ where: { schoolId: school.id, role: 'PRINCIPAL' }, select: { id: true } }))?.id ?? 'seed',
      },
    })
    await db.school.update({ where: { id: school.id }, data: { logoUrl: crestId } })
    console.log('[seed-website-cms] crest registered (logoUrl → seed-hawkings-crest.png)')
  } catch (e) {
    console.warn(`[seed-website-cms] crest skipped: ${(e as Error).message}`)
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
    { src: 'hawkings-campus.png', caption: 'The School Campus', description: 'Main building & courtyard, Prithvipur', order: 1 },
    { src: 'library.jpg', caption: 'The Library', description: '3,000+ Hindi & English titles', order: 2 },
    { src: 'science-lab.jpg', caption: 'Science Laboratory', description: 'Practicals up to Class 12', order: 3 },
    { src: 'classroom.jpg', caption: 'Classrooms', description: 'Small classes, caring teachers', order: 4 },
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
