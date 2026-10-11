# Production Email (Resend)

> Transactional email is **server-only**. Provider credentials never reach
> the browser, are never `NEXT_PUBLIC_*`, and exist only in Vercel
> environment variables (production + preview) and the local dev server
> env if explicitly provided.

## Architecture

`src/lib/email/` — a single server-only module (client import is blocked by a
`server-only` guard):

- **Provider adapters** (`src/lib/email/providers/`) — one adapter per
  provider behind the shared `sendEmail` pipeline:
  - `resend.ts` — Resend REST (`POST https://api.resend.com/emails`),
    bounded retries (3 attempts by default, 250 ms/1 s backoff, 5 s timeout
    each; the latency-sensitive public admission call site passes
    `maxAttempts: 2`).
  - `gmail-smtp.ts` — **temporary provider** (see the "Gmail SMTP" section):
    `smtp.gmail.com:465` TLS via nodemailer (lazily imported), 10 s
    connection / 15 s socket timeouts, same retry policy (network
    failures retried; auth failures permanent).
  - `dev-log` (in the pipeline) — structured `email_dev_delivery` log
    lines, nothing leaves the machine.
- **Provider selection**: `EMAIL_PROVIDER` env (`resend` | `gmail-smtp` |
  `dev-log` | `auto`; default `auto` = first provider with credentials:
  `RESEND_API_KEY` → Gmail creds → dev-log). An EXPLICIT pin without its
  credentials fails every send LOUDLY with a `[provider-config]`
  EmailDelivery row — never a silent fallback.
- **Error classification** (`provider-errors.ts`): every provider failure
  gets a typed, machine-parseable class tag in `EmailDelivery.lastError` —
  `[auth-invalid]` (401: rotate the key), `[testing-recipient-restricted]`
  (403: the account is in TESTING MODE — only the account-owner address
  is deliverable; **NOT an invalid API key — do not rotate the key**),
  `[unverified-sender-domain]` (403/422 domain language),
  `[rate-limited]` (429, retried), `[transient]` (5xx/network, retried),
  `[invalid-request]` (other 4xx, permanent), `[provider-config]`
  (missing credentials for an explicit pin).
- **Outbox / audit**: every send is recorded in the `EmailDelivery` table
  (`PENDING → QUEUED → SENT`, or `FAILED`; attempts, last error with
  class tag, provider message id).
- **Honest status semantics**: a provider 2xx (or SMTP 250) means
  ACCEPTED, not delivered — the row becomes `QUEUED`. `SENT` requires
  **delivery evidence**: the Resend webhook's `email.delivered` event
  (see "Webhooks") or the dev-log transport (the log line IS the
  delivery). An email is never reported as delivered when it was merely
  queued or rejected. Gmail SMTP has no delivery-confirmation channel —
  its accepted rows stay `QUEUED` (honestly).
- **Idempotency**: `dedupeKey` (unique) — a retried trigger (e.g. the same
  admission inquiry) can never double-send; the second pass resolves as
  `skipped` (a SENT **or QUEUED** row is protected — an already-accepted
  email is never re-sent).
- **Templates**: branded, HTML-escaped, tenant-aware (school name + primary
  color); tenant branding comes from the school row at render time.
- **Sender**: `EMAIL_FROM` env override, otherwise `Scholario
  <onboarding@resend.dev>` (Resend's shared sender — delivers to the account
  owner's address until a custom domain is verified).

## Delivery triggers (server-side)

| Event | Template | Trigger site |
| --- | --- | --- |
| Admission enquiry accepted | `admission-enquiry-received` | `POST /api/admissions/public` (best-effort; the public response never depends on email) |
| Salary payment recorded | `salary-payment-recorded` | `POST /api/salary/payments` (receipt to the teacher) |
| Platform password reset requested | `platform-password-reset` | `POST /api/platform/auth/forgot-password` + admin-assisted `/api/platform/admins/[id]/reset-password` + recovery-confirm execution (single-use link; anti-enumeration generic response; see `docs/PLATFORM_ACCOUNT_RECOVERY.md`) |

## Custom sending domain (status + runbook)

Current state (verified 2026-10 via the Resend API `GET /domains`): **zero
domains on the account, none verified.** The account is in Resend's
**testing mode**: sends from the shared `onboarding@resend.dev` sender are
only delivered to the account owner's own address
(`signature4748@gmail.com`). Every send to any other recipient (including
`admin@scholario.cloud` platform password resets) is rejected with
**HTTP 403** — classified `[testing-recipient-restricted]` in the outbox.
This is an **account-level restriction, NOT an invalid API key** (the key
is verified valid; rotating it would fix nothing).

The owner does not currently want to purchase a domain. Real end-user
delivery therefore needs EITHER:

1. **Verify a sending domain** (the permanent fix — one external action
   only the account/domain owner can perform):
   1. In the Resend dashboard: **Domains → Add domain** (the school's own
      domain).
   2. Add the returned DNS records (DKIM/SPF) at the domain's DNS
      provider.
   3. Wait for Resend's verification, then set `EMAIL_FROM` on Vercel to
      `Scholario <no-reply@<verified-domain>>` and redeploy.
2. **Temporarily route through Gmail SMTP** (no domain purchase needed —
   see the next section; requires the owner to create a Google App
   Password).

No DNS credentials exist in this environment, so the domain verification
itself remains the single external step for option 1; everything else
(key wiring, transport, audit, idempotency, tenant branding, error
classification, diagnostics) is deployed and verified.

## Gmail SMTP — temporary real-recipient delivery (optional)

Because the owner does not want to purchase a domain yet, the pipeline
ships a **server-side Gmail SMTP provider adapter** so transactional
email can reach real recipients without a verified domain:

- **Activation** (owner actions, all configuration — no code changes):
  1. A Google account with **2FA enabled**; create a 16-char **App
     Password** (Google Account → Security → 2-Step Verification → App
     passwords).
  2. Set `GMAIL_SMTP_USER` + `GMAIL_SMTP_APP_PASSWORD` on Vercel (both
     active projects; **Sensitive** env vars, server-only, never
     browser).
  3. Either set `EMAIL_PROVIDER=gmail-smtp`, or unset `RESEND_API_KEY`
     (auto-selection then picks Gmail).
- **Honest limits**: consumer Gmail caps at ~500 recipients/day; Gmail
  rewrites the From header to the authenticated address (school branding
  survives in subject/body); there is **no delivery webhook for SMTP** —
  accepted sends stay `QUEUED` in the outbox (SMTP 250 = accepted, not
  delivered; no false "delivered" claims).
- **Safety**: credentials exist only in server env; they never reach the
  browser, never appear in logs, EmailDelivery rows or diagnostics
  (diagnostics show a masked address + presence booleans only);
  nodemailer is imported lazily server-side; timeouts (10 s connection /
  15 s socket) and the same bounded retry policy apply (auth failures
  permanent `[auth-invalid]`, network failures retried).
- **Live delivery NOT yet verified** — no Gmail credentials exist in this
  environment (only the owner can create the App Password). The adapter
  is unit-tested with injected SMTP stubs; once the owner configures
  credentials, `/api/platform/health/email` reports the provider active
  and the first real trigger verifies end-to-end.

## Webhooks (delivery lifecycle — bounce/complaint/failure state sync)

`POST /api/webhooks/resend` is the provider→us half of the email system. The
outbox (`EmailDelivery`) records what the API said at send time (`QUEUED` on
acceptance / `FAILED` on rejection); the webhook records what the provider
learned afterwards — delivery evidence (upgrades `QUEUED` → `SENT`) and
terminal failure states:

| Resend event | Effect |
| --- | --- |
| `email.bounced` | row → `BOUNCED`, `lastError` carries the bounce code/detail |
| `email.complained` | row → `COMPLAINED` (feedback loop) |
| `email.failed` | row → `FAILED`, `lastError` carries the provider reason |
| `email.delivered` | **delivery evidence** — a `QUEUED`/`PENDING` row (provider-accepted) is upgraded to `SENT`; an already-`SENT` row is untouched (idempotent) |
| `email.sent` / `.delivery_delayed` / others | `WebhookEvent` audit row only — the send-side row is never rewritten (`delayed` ≠ delivered) |

Security and reliability contract (same shape as the payment webhook):

- **Svix signature verification** — `svix-id` / `svix-timestamp` /
  `svix-signature` (v1 HMAC-SHA256 over `id.timestamp.body`, base64,
  multi-token headers honored), timing-safe compare, keyed by the
  `RESEND_WEBHOOK_SECRET` env (server-only).
- **Fail-closed** — no secret ⇒ every request is 401 and the route is inert;
  sending is unaffected.
- **Replay protection** — a `svix-timestamp` older than 5 minutes is rejected.
- **Idempotency** — `svix-id` is unique in `WebhookEvent`; redeliveries are
  acknowledged (200) and counted, never re-processed.
- **Honest matching** — rows are matched by `providerMessageId` (the id
  Resend returned at send time), never by recipient; an event without a
  usable id is recorded with an honest error, never guessed.
- Every event is recorded in `WebhookEvent` (`gatewayName: 'resend'`) with
  its (clipped) raw payload — the delivery evidence trail.

Owner action to activate (one-time): create the webhook endpoint at
`https://<production-domain>/api/webhooks/resend` with the bounce /
complaint / delivery events enabled (Resend dashboard → Webhooks, or the
Resend Webhooks API which returns the endpoint's real signing secret),
copy the endpoint's signing secret into the Vercel production env as
`RESEND_WEBHOOK_SECRET` on both active projects and redeploy. Until then
the route stays fail-closed, and provider-accepted rows simply stay
`QUEUED` (no delivery evidence — honest, never misreported as delivered).

## Verification evidence (this phase)

- Email-infrastructure suite: 18/18 (retries bounded, dedupe idempotency
  incl. QUEUED rows, template escaping, transport selection, error
  classification classes, EMAIL_PROVIDER pinning incl. loud
  misconfiguration).
- Email-providers suite: 31/31 (HTTP + SMTP error classification, class
  tag round-trip, Gmail SMTP adapter with injected stubs, provider
  selection matrix, diagnostics masking).
- Resend-webhook suite: 13/13 (fail-closed boundary, Svix signature +
  replay window, bounce/complaint/failure state sync, delivered =
  QUEUED→SENT delivery-evidence upgrade + idempotent redelivery,
  duplicate svix-id, unknown event types, multi-token headers).
- Production diagnosis (2026-10, read-only): the account-owner test
  email was accepted AND delivered (Resend `GET /emails` →
  last_event "delivered"); a controlled send to a non-owner address
  returned the exact 403 testing-mode body, now classified
  `[testing-recipient-restricted]` in the outbox.
- End-to-end app-path send: a real admission enquiry submitted on production
  produced a `SENT` `EmailDelivery` row (see the release report) and the
  message is visible in the Resend account's email log (delivered).
- Real delivery probe: direct Resend REST send to the account owner address
  recorded in Resend's `GET /emails` log with delivery status.

## Diagnostics (secret-safe)

`GET /api/platform/health/email` (any authenticated platform admin; optional
`?live=1` for an authenticated read-only provider check) answers "why are
emails not arriving?" without exposing a single credential:

- active provider + selection reason (explicit pin vs auto detection) and
  configuration state;
- Resend: key presence (boolean), configured sender address, webhook
  secret presence (boolean), and — with `?live=1` — the verified-domain
  count straight from `GET /domains` (so "testing mode / zero domains"
  is visible in-app, and a working key proves itself);
- Gmail SMTP: presence booleans + a MASKED account address;
- outbox: 7-day status counts (PENDING/QUEUED/SENT/FAILED/BOUNCED/
  COMPLAINED) and the latest failure's parsed `[error-class]` — the 403
  testing-recipient restriction shows up under its own name, not a wall
  of provider JSON.

The route only READS state: it can never send email, rotate keys or
mutate the outbox. No secrets, no full recipient addresses.

## Provider independence & the two-project topology

The email pipeline is **domain-independent** — nothing in the code knows or
hard-codes the sending domain. What exists per send: an `EmailDelivery`
audit row (`PENDING → SENT/FAILED`, attempts, provider message id) with
`dedupeKey` idempotency, bounded-retry transport, and the Svix-signature-
verified webhook at `POST /api/webhooks/resend`. When the `scholario.<TLD>`
domain is purchased, the switch is **configuration only**:

1. Resend dashboard → Domains → Add the domain → add the returned
   DKIM/SPF DNS records (the existing "Custom sending domain" runbook
   above — same steps).
2. Set `EMAIL_FROM` on Vercel to `Scholario <no-reply@scholario.<TLD>>` and
   redeploy.

No code changes, no template changes, no pipeline changes.

**Webhook endpoint per plane.** The webhook lives at
`/api/webhooks/resend` and is **served on every plane** — it is shared
infrastructure, like `/api` and `/api/app-version` (see
`isSharedApiRoute` in `src/lib/plane.ts`): the platform deployment
(`scholario-platform`), the school deployment (`scholario-app`), and the
legacy unified deployment (`scholario-production`) all expose the same
route, verified by the same `RESEND_WEBHOOK_SECRET`. Resend's dashboard
webhook URL points at whichever origin is the canonical production domain;
because all three deployments share one database, a bounce event delivered
to any plane's endpoint synchronizes the same `EmailDelivery` row. See
`docs/VERCEL_PROJECTS.md` for the deployment map.

**Honest state (sender limitation).** Resend is currently limited to the
shared `onboarding@resend.dev` testing sender: with no verified custom
domain on the account, Resend only delivers that sender to the account
owner's own address (the "Custom sending domain" section above documents
this and the fix; failures are classified
`[testing-recipient-restricted]`, never mislabeled as an invalid key).
Real end-user delivery is pending the one external domain-verification
action — or the temporary Gmail SMTP provider above — not code.

**SMTP-for-Supabase-Auth: not needed.** Supabase Auth is not used —
authentication is the application's custom scrypt/session model
(`docs/AUTH_ARCHITECTURE.md`), so the "configure SMTP in Supabase for auth
mail" step that a GoTrue adoption would require does not exist and is not
planned. The provider-adapter seam this phase shipped (providers behind
`sendEmail`) was exercised by the Gmail SMTP adapter — additional
providers can be added without touching call sites.
