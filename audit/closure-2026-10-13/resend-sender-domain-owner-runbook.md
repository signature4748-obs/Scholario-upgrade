# Resend sender-domain setup — owner runbook (BLOCKED on owner domain decision)

> Status 2026-10-13: Resend has ZERO verified domains. Both canonical planes
> send from `onboarding@resend.dev` (EMAIL_FROM host = resend.dev on both
> projects) — Resend only delivers that address to the ACCOUNT OWNER'S own
> inbox; every other recipient is rejected. Email delivery (and every
> emailed recovery path) stays non-operational until a custom domain is
> verified.

## Why the owner must decide (not the agent)

1. A VERIFIED sender domain must be a domain the OWNER controls (DNS access).
   A Vercel application URL (scholario-app-virid.vercel.app /
   scholario-platform.vercel.app) is NOT a substitute: you cannot publish DNS
   records for a vercel.app subdomain, and providers reject it as an
   authenticated sender.
2. Adding the domain to Resend and publishing the DNS records changes the
   owner's DNS zone — an owner action per the standing safeguards.

## The exact procedure (owner-executed, ~10 minutes)

### 1. Add the domain to Resend (dashboard → Domains → Add Domain, or API)

    curl -X POST https://api.resend.com/domains \
      -H "Authorization: Bearer <RESEND_API_KEY>" \
      -H "Content-Type: application/json" \
      -d '{"name": "<your-domain.example>"}'

Resend returns the domain object INCLUDING the exact `records` array it
wants published (each: `record`, `name`, `type`, `ttl`, `value`, `status`,
optional `priority`). The record FAMILY (per Resend's standard verification):

| # | Type | Host | Purpose |
|---|------|------|---------|
| 1 | TXT | `<your-domain>` | SPF — authorizes Resend's senders |
| 2 | TXT | `resend._domainkey.<your-domain>` | DKIM public key (per-domain generated) |
| 3 | TXT | `_dmarc.<your-domain>` | DMARC policy (recommended: `p=none` first, tighten later) |

**Do not use values from this table's memory — copy the EXACT `name`/`value`
pairs Resend returns for YOUR domain (DKIM keys are per-domain generated).**
The owner (or an approved assistant) can fetch them read-only after the
domain exists:

    curl https://api.resend.com/domains/<domain-id> \
      -H "Authorization: Bearer <RESEND_API_KEY>"

### 2. Publish the records in the owner's DNS zone (manual, owner approval)

Copy each record EXACTLY (type, host, value, TTL). Wait for propagation
(minutes to hours). Re-check in the Resend dashboard → Domains → status
`pending` → `verified`. `GET /domains` will show `"status": "verified"`.

### 3. Update EMAIL_FROM on BOTH canonical projects + redeploy

After verification only. Supported flow: update the env var (value shape:
`Scholario <no-reply@<your-domain>>`) on `scholario-app` and
`scholario-platform` for production+preview, then trigger a fresh deployment
of each plane (git push or deploy hook — the app reads EMAIL_FROM at send
time, but a clean redeploy pins the release). Values are never printed by
the tooling; the operator sets them.

### 4. Authorized test delivery (explicit recipient consent required)

Send ONE test to an explicitly authorized recipient (e.g. the owner's own
address or a consenting staff member). Verify BOTH:

- provider status: `GET https://api.resend.com/emails/<id>` → `delivered`
  (HTTP 202 from the send call only means accepted/queued — NOT delivered);
- the webhook pipeline: the platform's `/api/webhooks/resend` (id 774c8167)
  should record a `WebhookEvent` row (email.delivered) and upgrade the
  matching `EmailDelivery` row to `SENT` — the DB rows are the delivery
  evidence.

Never test with arbitrary user addresses.

### 5. Webhook/tenant integrity (already verified 2026-10-13, code-level + live)

- signature: fail-closed Svix v1 HMAC-SHA256 (no/bogus signature → 401, live-tested);
- replay: svix-timestamp older than 5 minutes → 401;
- idempotency: svix-id unique in WebhookEvent — redelivery is acknowledged, never re-processed;
- tenant isolation: state sync only by providerMessageId (global message id — no tenant rows touched).

These remain intact regardless of the sender domain change (the webhook
secret is independent of the sending domain).

## While email is down (owner reference)

Platform root recovery does NOT depend on email:
`root-credential-bootstrap` (Management API channel) or Google-linked
PlatformAdmin sign-in. School-plane: principal/platform credential reissue
flows. The emailed platform forgot-password path is the only dead lane.
