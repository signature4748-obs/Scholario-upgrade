# Production Email (Resend)

> Transactional email is **server-only**. The Resend API key never reaches the
> browser, is never `NEXT_PUBLIC_*`, and exists only in Vercel environment
> variables (production + preview) and the local dev server env if explicitly
> provided.

## Architecture

`src/lib/email/` — a single server-only module (client import is blocked by a
`server-only` guard):

- **Transports**
  - `RESEND_API_KEY` set → Resend REST (`POST https://api.resend.com/send`),
    bounded retries (2 attempts, 250 ms backoff, 5 s timeout each).
  - key absent (local dev / CI) → **dev-log transport**: structured
    `email_dev_delivery` log lines, nothing leaves the machine.
- **Outbox / audit**: every send is recorded in the `EmailDelivery` table
  (`PENDING → SENT/FAILED`, attempts, last error, provider message id).
- **Idempotency**: `dedupeKey` (unique) — a retried trigger (e.g. the same
  admission inquiry) can never double-send; the second pass resolves as
  `skipped`.
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
| Salary payment voided | `salary-payment-voided` | `POST /api/salary/payments/[id]/void` |
| Platform password reset requested | `platform-password-reset` | `POST /api/platform/auth/forgot-password` + admin-assisted `/api/platform/admins/[id]/reset-password` + recovery-confirm execution (single-use link; anti-enumeration generic response; see `docs/PLATFORM_ACCOUNT_RECOVERY.md`) |

## Custom sending domain (status + runbook)

Current state: **no verified custom domain** on the Resend account — the system
sends from Resend's shared `onboarding@resend.dev` sender, which Resend only
delivers to the account owner's own address. Real end-user delivery requires
one external action that only the account/domain owner can perform:

1. In the Resend dashboard: **Domains → Add domain** (the school's own domain).
2. Add the returned DNS records (DKIM/SPF) at the domain's DNS provider.
3. Wait for Resend's verification, then set `EMAIL_FROM` on Vercel to
   `Scholario <no-reply@<verified-domain>>` and redeploy.

No DNS credentials exist in this environment, so the domain verification itself
is the single remaining external step; everything else (key wiring, transport,
audit, idempotency, tenant branding) is deployed and verified.

## Webhooks (delivery lifecycle — bounce/complaint/failure state sync)

`POST /api/webhooks/resend` is the provider→us half of the email system. The
outbox (`EmailDelivery`) records what the API said at send time (`SENT` /
`FAILED`); the webhook records what the provider learned afterwards and
synchronizes terminal failure states:

| Resend event | Effect |
| --- | --- |
| `email.bounced` | row → `BOUNCED`, `lastError` carries the bounce code/detail |
| `email.complained` | row → `COMPLAINED` (feedback loop) |
| `email.failed` | row → `FAILED`, `lastError` carries the provider reason |
| `email.delivered` / `.sent` / `.delivery_delayed` / others | `WebhookEvent` audit row only — the send-side row is never rewritten |

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

Owner action to activate (one-time, needs the Resend dashboard): create the
webhook endpoint at `https://<production-domain>/api/webhooks/resend` with the
bounce / complaint / delivery events enabled, copy the endpoint's signing
secret into the Vercel production env as `RESEND_WEBHOOK_SECRET`. Until then
the route stays fail-closed and the outbox simply lacks provider-side
delivery evidence.

## Verification evidence (this phase)

- Email-infrastructure suite: 10/10 (retries bounded, dedupe idempotency,
  template escaping, server-only guard, transport selection).
- Resend-webhook suite: 11/11 (fail-closed boundary, Svix signature +
  replay window, bounce/complaint/failure state sync, delivered =
  evidence-only, duplicate redelivery, unknown event types, multi-token
  headers).
- End-to-end app-path send: a real admission enquiry submitted on production
  produced a `SENT` `EmailDelivery` row (see the release report) and the
  message is visible in the Resend account's email log (delivered).
- Real delivery probe: direct Resend REST send to the account owner address
  recorded in Resend's `GET /emails` log with delivery status.
