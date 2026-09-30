# School Configuration Model

> **Status: implemented (PHASE 7.5).** The `School` row is the single
> canonical source of truth for a school's identity, branding and
> configuration slices. This document describes the actual runtime model:
> storage, validation, API surface, client hydration, module gating, and
> the honest remaining split (fee-head catalogue, §7).

---

## 1. Principle — settings drive the application

Pre-Phase 7.5, "School Settings" was 100% browser localStorage seeded with
a Greenwood universe (fabricated contact block, 21 fee heads, houses with
invented captains), while the DB `School` row carried a *different*
identity that nothing consumed. That is gone. Now:

```
School row (DB)  ── the canonical configuration
   │
   ├── identity columns   (name, shortName, tagline, affiliation, address,
   │                       city, phone, email, website, principalName,
   │                       established, code, board, academicYear, faviconUrl)
   ├── branding columns   (themeColor, accentColor, logoUrl)
   ├── settings JSON      (per-slice config: timetable, attendance, library, …)
   ├── websiteContent JSON (Website CMS document — see SCHOOL_WEBSITE_CMS.md)
   └── featureFlags JSON  (module availability — platform-plane owned)
```

Everything that renders school identity or consumes school configuration
now reads this row through one of two paths:

- **Server path** — `src/lib/school-config.ts`
  (`getSchoolConfig(schoolId)`), used by APIs, documents, and the public site.
- **Client path** — the school-settings store hydrates from
  `GET /api/school-settings` once per session
  (`src/lib/store/school-settings-store/server-sync.ts`) and realigns its
  legacy local slices to the server values ("server over seed, seed only
  where the server is silent").

The old `lib/mock/school` fabricated-identity module is **retired from the
runtime path**: `school-profile.ts` runs a server → local → NEUTRAL
fallback cascade (payslips, receipts, letters, certificates, timetable
PDFs, comm-compose and the app-shell footer all follow it).

---

## 2. API surface

### GET `/api/school-settings` — read (any authenticated school user)
Returns `{ identity, branding, settings, moduleFlags }` for the **session's
school** (never a client-provided schoolId). Consumers: settings store
hydration, effective module-flag gating, login/documents defaults.

### PATCH `/api/school-settings` — write (PRINCIPAL / MANAGEMENT only)
Three validated fragments (any combination):

| Fragment | Destination | Validation |
|---|---|---|
| `{ identity: {...} }` | School columns | per-key length caps (name ≤120, tagline/affiliation/address ≤400, …); name cannot be emptied |
| `{ branding: { primaryColor?, accentColor?, logoUrl?, faviconUrl? } }` | School columns | strict hex; **WCAG contrast ≥ 3.5:1 on white for the primary** (rejects with an actionable message); logo/favicon must be website-scope uploaded file ids, never arbitrary URLs |
| `{ settings: { <slice>: {...} } }` | settings JSON | ≤ 30 keys, key regex `^[a-zA-Z][a-zA-Z0-9_]{0,39}$`, ≤ 16 KB per slice; shallow slice-level deep merge server-side |

Every write is **audit-logged** (`SCHOOL_SETTINGS_UPDATED`, with the
changed fragment list and actor). The response returns the updated full
config so the client re-syncs from the authoritative value immediately.

Contrast validation is mirrored client-side in
`src/lib/branding-contrast.ts` (same math) for instant feedback in the
Branding tab; the **server re-validates** — a bypassed client cannot store
an unreadable brand color.

---

## 3. Settings slices and their consumers

| Slice | Written by | Consumed by (actual) |
|---|---|---|
| `timetable` (dayStart/dayEnd/periodMinutes/breaks/workingDays) | Settings → Timetable tab | the period ladder + timetable module defaults (`lib/timetable/config` mapping); working days drive grids |
| `attendance` (thresholds/late rules) | Settings → Attendance tab | attendance overview thresholds, low-attendance lists |
| `library` (rules/fines) | Settings → Library tab | persisted; enforcement in the library API is honestly labeled as pending where true |
| `general` (display identity) | realigned from identity on hydration | documents, ID cards, print identity |
| `fees` (local template list) | Settings → Fees tab | **honest split — see §7** |

Slices the server does not carry keep their local value on hydration —
nothing is invented, nothing is silently dropped.

---

## 4. Module gating (server vocabulary, one pipeline)

The **effective** module availability is a server decision:

```
School.featureFlags ?? PlatformSetting.moduleFlags ?? true
        └─► effectiveModuleFlags(schoolId)  (src/lib/platform/module-flags.ts)
                └─► exposed on GET /api/school-settings as `moduleFlags`
                        └─► client nav gating: useEffectiveModuleFlags()
                            (src/lib/hooks/use-effective-module-flags.ts)
```

Client gating contract:

- explicit server vocabulary (`exams`, `fees`, `library`, `transport`,
  `homework`) — mapped **explicitly** from the client registry vocabulary
  (`examinations → exams`, etc.); nothing is guessed;
- fail-open only while unsynced (matches the server default-true design);
  once loaded, a module is hidden **only** when its flag is explicitly
  `false`;
- the legacy client tenant-registry `features` map is decorative
  (all-on seeds, zero writers) and is documented as such — the server flags
  are the truth.

---

## 5. Branding application (design tokens, not scattered colors)

- School branding colors are applied through **CSS custom properties**
  (`--school-primary`, `--school-accent`) consumed by the
  `school-brand-*` token classes in `globals.css` (unlayered, so they
  deterministically win over Tailwind utilities, with color-mix() tints,
  hover + dark-mode variants, and emerald/amber fallbacks when inert).
- The identity surfaces of the **public website and login** follow the
  school brand; the authenticated workspace intentionally keeps the
  default Scholario theme (a per-school *workspace* skin is a deliberate
  future option — documented, not silently half-built).
- Structural greens in the workspace remain the Scholario design language
  (visual identity retention per the phase brief); the brand color owns
  the school-specific identity surfaces.
- Colors are contrast-validated (§2) — arbitrary colors cannot destroy
  readability.

---

## 6. Identity cascade (who renders what)

```
server identity (School row via /api/school-settings session sync)
  → local general slice (only where server is silent)
    → NEUTRAL fallbacks ("Our School", no fabricated address/phone)
```

Applied by: `school-profile.ts` (documents, letters, receipts), the
app-shell footer, ID cards, login branding (one deduplicated
`/api/schools/public` fetch), and the public website. Session-derived
academic year (`School.academicYear`) replaced the hardcoded
`'2026-2027'` fallback.

---

## 7. Honest remaining split — fee heads (documented, not hidden)

Two fee-head universes pre-date this phase and still coexist **by design**:

1. **`MasterFeeHead` (DB)** — the billing catalogue. Consumed by
   `/api/fees/structures` (catalogue-linked heads are FK-validated
   per-school) and seeded per tenant. Managed via `/api/fees/catalogue`.
2. **Settings-store `fees.feeHeads`** — the school's local template list
   used by the Fees module Catalogue tab and the structure picker
   (heads may optionally carry a `catalogueId` link to the DB row).

The Settings → Fees tab renders an honest scope banner stating that the
billing catalogue lives in Fee Management → Catalogue, and edits only the
local template list. Consolidating to a single DB catalogue is a known
remaining item (see the completion report's "remaining known issues") —
deliberately not rushed in this phase because the Fees module
(structures, receipts, defaulters) is a Phase 7-hardened surface.

---

## 8. Verification

- `tests/security/phase75-product.test.ts` proves: A's settings PATCH
  cannot affect B (cross-tenant write rejected); client-provided
  schoolId is never honored; branding validation rejects
  low-contrast colors; hydration returns A only A's config.
- Manual/browser: Settings tabs show per-session school identity, sync
  chips (Synced/Unsaved), and retry on failed sync.
