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

## Verification evidence (this phase)

- Email-infrastructure suite: 10/10 (retries bounded, dedupe idempotency,
  template escaping, server-only guard, transport selection).
- End-to-end app-path send: a real admission enquiry submitted on production
  produced a `SENT` `EmailDelivery` row (see the release report) and the
  message is visible in the Resend account's email log (delivered).
- Real delivery probe: direct Resend REST send to the account owner address
  recorded in Resend's `GET /emails` log with delivery status.
