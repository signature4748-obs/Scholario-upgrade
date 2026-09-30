# School Website CMS

> **Status: implemented (PHASE 7.5).** Every school has a per-tenant
> website document, gallery, announcement pipeline, and image pipeline —
> one codebase, zero per-school code. This describes the actual
> implementation: storage, APIs, management UI, public rendering, and the
> privacy model for images.

---

## 1. Content model

`School.websiteContent` (JSON column, ≤ 32 KB) holds a `WebsiteContent`
document — one shared type used by the server, the settings Website tab
editors, and the public renderer (`src/lib/website-content.ts`):

| Section | Fields |
|---|---|
| `hero` | badgePrefix, title, titleAccent, description, ctaPrimary/ctaSecondary (label+href), imageId |
| `about` | title, subtitle |
| `pillars[]` | icon (registry key), title, description |
| `journey` | title, subtitle, stages[] (icon, title, grades, years, description) |
| `facilities[]` | icon, title, description |
| `principalMessage` | enabled, message (renders only when enabled **and** non-empty; the portrait/name come from server identity) |
| `admissions` | heading, subtitle, description, highlights[], officeHours, process |
| `contact` | address/phone/email lines (identity-sourced where set) |
| `footer` | about line, links |
| `seo` | title, description |

Neutral fallbacks (`NEUTRAL_WEBSITE_CONTENT`): a school that has not
configured a section renders generic, claim-free copy — **never**
fabricated marketing facts ("30,000+ titles", "since 1995"…). The demo
tenant ships a full editorial document (seeded from the previous static
copy) through the exact same code path a real school uses
(`prisma/seed-website-cms.ts`, classified **demo tenant data**).

`mergeWebsiteContent(raw)` merges the stored doc over the neutral base —
the renderer can trust every section to exist.

---

## 2. API surface (all tenant-scoped from the session)

| Route | Method | Who | Purpose |
|---|---|---|---|
| `/api/school/website` | GET | any school user | full CMS doc + school branding (previews, Website tab) |
| `/api/school/website` | PATCH | PRINCIPAL/MANAGEMENT | partial write — present sections replace wholesale, absent sections keep stored values; ≤32 KB; audit-logged |
| `/api/school/website/gallery` | GET/POST/PATCH/DELETE | PRINCIPAL/MANAGEMENT | albums CRUD (title, description, publish, order) — GET includes UNPUBLISHED (management view) |
| `/api/school/website/gallery/images` | POST/PATCH/DELETE | PRINCIPAL/MANAGEMENT | add images (fileId+caption), reorder (order), remove |
| `/api/school/website/upload` | POST | PRINCIPAL/MANAGEMENT | image upload (below) |
| `/api/announcements` | POST | PRINCIPAL/MANAGEMENT | announcement lifecycle create |
| `/api/announcements/[id]` | PATCH/DELETE | PRINCIPAL/MANAGEMENT | edit / status transitions / image swap / delete (cross-tenant id ⇒ fail-safe 404) |

A client-provided `schoolId` is never read on any of these routes.

---

## 3. Image pipeline (privacy by default)

```
upload (multipart, magic-byte sniffed — JPG/PNG/WebP only, ≤ 4 MB,
        per-user rate limit)
   → opaque server-minted fileId, registered in the UploadedFile
     OWNERSHIP REGISTRY (scope 'website', session school)
   → bytes stored under db/uploads/website (private, unguessable id)
   → served PUBLICLY only via /api/public/website/media/<fileId> when a
     PUBLISHED reference exists:
        · a GalleryImage whose album is published, OR
        · a PUBLISHED + currently-visible announcement carrying it, OR
        · it is the school's branding (School.logoUrl of an ACTIVE school)
   → otherwise 404 (drafts stay private)
```

- No raw storage paths are ever exposed to the browser (opaque ids only).
- The public media route is anonymous-IP rate-limited and validates the id
  shape before touching the registry.
- This is the seam for the future signed-access/private-storage migration
  (Supabase Storage phase): swap the storage backend behind the same
  registry + publication rule.

---

## 4. Announcement lifecycle (real workflow)

The `Notification` model gained a real editorial lifecycle
(`status DRAFT | PUBLISHED | ARCHIVED`, `publishAt`, `expiresAt`,
`imageId`, `updatedById`, `updatedAt`):

```
draft ──publish──► published ──unpublish──► draft
                         │                     
                    schedule (publishAt in future)
                         │
                    expiresAt passes ──► hidden everywhere (row kept)
                         │
                      archive ──► ARCHIVED (kept for audit, out of feeds)
```

- **Visibility is enforced server-side in every feed** through
  `notificationVisibilityWhere()` — bell feed, student notices, search,
  public site payload, RSS, and the public media route (this closes the
  latent leak flagged in the Phase 7.5 audit: a scheduled announcement is
  invisible before `publishAt`, an expired one after `expiresAt`).
- Announcements with images: the image follows the announcement's state
  (draft image = private bytes; publish = public bytes).
- The previously fabricated seed universe (client-store announcements
  with fake 1,842-recipient counts and invented authors) is **retired** —
  the communication store starts empty and renders honest empty states.
- Publishing a live announcement still pushes through the event-stream
  mini-service (live toasts on connected dashboards).

---

## 5. Management UI (Settings → Website)

- **Section editors** — hero, about, pillars, journey, facilities,
  principal message, admissions, contact, footer, SEO — each with its own
  Save (PATCH of that section); instant per-section feedback, never a
  monolithic 30-field form.
- **Gallery manager** — albums CRUD, multi-upload with per-file progress
 /validation/retry states, captions, reorder, publish toggles, honest
  empty/loading/error states.
- **Announcement composer** — Send Now / Save as Draft / Schedule
  (datetime), image attach/replace/remove; the announcements tab shows
  real lifecycle rows (status chips, publish window, image thumbs) with
  publish/unpublish/archive/edit/delete actions.

---

## 6. Public rendering

`/api/schools/public` (tenant-resolved, see TENANT_AWARE_WEBSITE_MODEL.md)
returns the merged content + published gallery albums + visible
announcements + honest counts. The public site renders:

- CMS hero/pillars/journey/facilities/principal-message/admissions/contact
  /footer with per-school branding colors, logo, favicon, SEO
  (`document.title` + meta description while mounted);
- gallery: published albums as "Campus Life" groups (lazy, capped 12 per
  album with an honest "+N more"); the static 4-tile mosaic renders ONLY
  for the demo tenant — an unconfigured real school gets an honest skip;
- notice board: featured notice with image banner, compact notices with
  thumbs, three-state (skeleton/empty/featured);
- skeletons while loading, neutral degraded copy on fetch failure.

**Tenant isolation:** School A's website payload can never resolve for
School B — content, gallery, announcements, and media are all
tenant-filtered server-side (pinned by tests).

---

## 7. Verification

`tests/security/phase75-product.test.ts`: A's gallery/announcements never
appear in B's public payload; B's CMS PATCH is rejected; draft
announcement + its image are invisible publicly; published album image
serves 200, unpublished album's image 404. Browser QA: gallery empty
states, announcement lifecycle chips, section-editor saves.
