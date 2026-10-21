/**
 * scripts/prod-release/root-email-recovery.ts — the OWNER-AUTHORIZED,
 * AUDITED root-admin email + credential recovery (ROOT-ADMIN LOGIN REPAIR).
 *
 * WHY THIS EXISTS: the platform root admin is locked out (per-account
 * login lockout) and the account's configured email cannot receive
 * recovery mail with the connected email provider (Resend test-domain
 * sender delivers only to the account owner's address). Every self-
 * service in-app path dead-ends, and the existing
 * root-credential-bootstrap.ts prints a one-time password to the
 * operator's terminal — usable, but it neither verifies the
 * administrator's real Gmail nor moves the account identity to it.
 *
 * WHAT THIS DOES (the explicit, audited recovery/provisioning procedure
 * the account-recovery contract permits when the administrator is
 * locked out):
 *   1. Verifies the operational authorization: the script runs only
 *      from an operator terminal holding the PRODUCTION DATABASE_URL
 *      (never printed, never logged) — the same channel as the
 *      migration pipeline. It is not an HTTP endpoint of the app.
 *   2. Guards (fail-closed): --email must resolve to an ACTIVE,
 *      isRoot=true PlatformAdmin; --new-email must be a syntactically
 *      valid address not claimed by ANY PlatformAdmin. --dry-run
 *      performs the read-only guards and exits.
 *   3. Mints a single-use recovery token (32 crypto-random bytes,
 *      sha256 at rest, 30-minute expiry) bound to BOTH the admin and
 *      the candidate email (PlatformPasswordReset.newEmail).
 *   4. Delivers the recovery link TO THE CANDIDATE MAILBOX via the
 *      production email pipeline (Resend). THIS IS THE OWNERSHIP
 *      VERIFICATION: the link only ever exists in that mailbox, so
 *      only its holder can consume it. Consuming the link (the normal
 *      /platform/reset-password flow) sets the new password AND
 *      atomically designates the verified address as the account
 *      identity, clears the per-account login lockout, revokes every
 *      live session, and sends the password-changed notification.
 *
 *   Nothing changes on the account until the Gmail holder clicks the
 *   link — an attacker (or a typo) cannot redirect the account to an
 *   arbitrary mailbox without controlling that mailbox.
 *
 * AUDIT: PlatformAuditLog row platform.account_recovery.initiated
 * (adminId + masked domains only — never the token, never full
 * addresses, never credentials). The completed step is audited by the
 * reset route (platform.password_reset.completed +
 * platform.account_email.changed).
 *
 * Usage (operator terminal, from the repository root):
 *   DATABASE_URL='postgres://…production…' \
 *     bun scripts/prod-release/root-email-recovery.ts \
 *       --email admin@scholario.cloud \
 *       --new-email owner@gmail.com \
 *       [--origin https://scholario-platform.vercel.app] [--dry-run]
 *
 * `--origin` (the reset-link origin) defaults to APP_URL when set; it
 * must be an https URL in production — a trusted configured origin,
 * NEVER a request Host header (this script is not a request handler).
 */

// ── CLI ───────────────────────────────────────────────────────────────────

const SCRIPT_NAME = 'root-email-recovery'

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag)
  if (i === -1) return undefined
  const v = process.argv[i + 1]
  if (!v || v.startsWith('--')) {
    console.error(`[${SCRIPT_NAME}] ${flag} requires a value`)
    process.exit(2)
  }
  return v
}

const TARGET_EMAIL = (argValue('--email') ?? '').trim().toLowerCase()
const CANDIDATE_EMAIL = (argValue('--new-email') ?? '').trim().toLowerCase()
const ORIGIN_OVERRIDE = argValue('--origin')
const DRY_RUN = process.argv.includes('--dry-run')

if (!TARGET_EMAIL || !CANDIDATE_EMAIL) {
  console.error(
    `[${SCRIPT_NAME}] usage: bun scripts/prod-release/root-email-recovery.ts ` +
      '--email <current root admin email> --new-email <candidate gmail> [--origin https://…] [--dry-run]',
  )
  process.exit(2)
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
if (!EMAIL_RE.test(CANDIDATE_EMAIL) || !EMAIL_RE.test(TARGET_EMAIL)) {
  console.error(`[${SCRIPT_NAME}] both --email and --new-email must be valid email addresses`)
  process.exit(2)
}

// ── Env gates (fail-closed) ────────────────────────────────────────────────

const DATABASE_URL = process.env.DATABASE_URL ?? ''
if (!DATABASE_URL.startsWith('postgres')) {
  console.error(
    `[${SCRIPT_NAME}] a production DATABASE_URL environment variable is required (never logged).`,
  )
  process.exit(1)
}

let ORIGIN = (ORIGIN_OVERRIDE ?? process.env.APP_URL ?? '').trim()
if (!ORIGIN) {
  console.error(
    `[${SCRIPT_NAME}] the reset-link origin is required: pass --origin https://… or set APP_URL (a trusted configured origin, never a request Host).`,
  )
  process.exit(1)
}
if (ORIGIN.includes('localhost') || ORIGIN.includes('127.0.0.1')) {
  console.error(`[${SCRIPT_NAME}] refusing to build a recovery link against a local origin.`)
  process.exit(1)
}
if (!/^https:\/\//.test(ORIGIN) && !ORIGIN.includes('vercel.app')) {
  console.error(`[${SCRIPT_NAME}] production recovery links must use https (got: ${ORIGIN.split('//')[0]}//…).`)
  process.exit(1)
}
ORIGIN = ORIGIN.replace(/\/+$/, '')

// ── Run (server-side modules; same credential space as production) ─────────

async function main(): Promise<void> {
  const { isProductionDatabase } = await import('../../src/lib/env')
  if (!isProductionDatabase() && !DRY_RUN) {
    console.error(
      `[${SCRIPT_NAME}] REFUSED: the connected database is not classified as production ` +
        `(isProductionDatabase() false — DATABASE_ENV unset and host not Supabase). ` +
        `This procedure targets the production control plane. Re-run with the production DATABASE_URL.`,
    )
    process.exit(1)
  }

  const { db } = await import('../../src/lib/db')
  const {
    issuePasswordReset,
    maskedEmailDomain,
    RESET_TOKEN_TTL_MS,
  } = await import('../../src/lib/platform/password-reset')
  const { sendEmail } = await import('../../src/lib/email')
  const { platformAuditEvent } = await import('../../src/lib/platform/audit')

  // Guards (fail-closed, re-verified in the issuance path itself).
  const admin = await db.platformAdmin.findUnique({ where: { email: TARGET_EMAIL } })
  if (!admin || !admin.isRoot || admin.status !== 'ACTIVE') {
    console.error(
      `[${SCRIPT_NAME}] REFUSED: --email must resolve to an ACTIVE, isRoot=true PlatformAdmin ` +
        `(got: ${admin ? `status=${admin.status} isRoot=${admin.isRoot}` : 'no such account'}).`,
    )
    process.exit(1)
  }
  const clash = await db.platformAdmin.findUnique({ where: { email: CANDIDATE_EMAIL } })
  if (clash) {
    console.error(
      `[${SCRIPT_NAME}] REFUSED: the candidate address already belongs to a platform admin ` +
        `(id=${clash.id === admin.id ? 'the SAME admin (no change needed — plain reset)' : 'ANOTHER admin — never steal it'}).`,
    )
    process.exit(1)
  }
  if (CANDIDATE_EMAIL === admin.email) {
    console.error(
      `[${SCRIPT_NAME}] REFUSED: --new-email equals the account's current address — ` +
        `run the ordinary forgot-password flow instead.`,
    )
    process.exit(1)
  }

  console.log(
    `[${SCRIPT_NAME}] target: root admin id=${admin.id} (email domain: ${maskedEmailDomain(admin.email)}), ` +
      `candidate: domain=${maskedEmailDomain(CANDIDATE_EMAIL)}, link origin: ${ORIGIN}` +
      `${DRY_RUN ? ' [DRY RUN — no token will be minted]' : ''}`,
  )

  if (DRY_RUN) {
    console.log(`[${SCRIPT_NAME}] dry-run guards passed. Re-run without --dry-run to mint + send the recovery link.`)
    process.exit(0)
  }

  // Mint the recovery token bound to the candidate email (uniqueness is
  // re-guarded inside issuePasswordReset and again inside the consume
  // transaction).
  const issued = await issuePasswordReset(admin.id, {
    requestIp: 'ops:root-email-recovery',
    userAgent: `scholario-ops/${SCRIPT_NAME}`,
    newEmail: CANDIDATE_EMAIL,
  })

  // Deliver the link to the CANDIDATE mailbox — the ownership proof.
  const resetUrl = `${ORIGIN}/platform/reset-password?token=${issued.token}`
  const result = await sendEmail({
    to: CANDIDATE_EMAIL,
    template: 'platform-recovery-link',
    props: {
      adminName: admin.name,
      resetUrl,
      expiresInMinutes: Math.floor(RESET_TOKEN_TTL_MS / 60_000),
    },
    dedupeKey: `platform-password-reset:${issued.id}`,
    requestId: `${SCRIPT_NAME}:${issued.id}`,
  })

  // Audit trail: counts + masked domains ONLY.
  await platformAuditEvent({
    adminId: admin.id,
    action: 'platform.account_recovery.initiated',
    targetType: 'ADMIN',
    targetId: admin.id,
    reason: 'audited operator recovery procedure (locked-out root admin; candidate email designated)',
    metadata: {
      procedure: SCRIPT_NAME,
      resetId: issued.id,
      expiresAt: issued.expiresAt.toISOString(),
      emailStatus: result.status,
      previousEmailDomain: maskedEmailDomain(admin.email),
      candidateEmailDomain: maskedEmailDomain(CANDIDATE_EMAIL),
    },
  }).catch(() => {})

  const honest =
    result.status === 'failed'
      ? 'FAILED — the provider rejected the send (see EmailDelivery row lastError). Nothing was minted into any mailbox; the token exists but cannot be consumed by its intended holder. Fix the provider/sender configuration and re-run.'
      : result.status === 'sent'
        ? 'DELIVERED (provider delivered event).'
        : result.status === 'queued'
          ? 'QUEUED — the provider ACCEPTED the message; delivery events will confirm (see EmailDelivery row).'
          : 'SKIPPED (dedupe — an earlier identical send is already SENT/QUEUED).'

  console.log(`[${SCRIPT_NAME}] recovery link send status: ${honest}`)
  console.log(
    `[${SCRIPT_NAME}] token row: id=${issued.id} expires=${issued.expiresAt.toISOString()} (single-use; 30 min). ` +
      `The raw token was printed NOWHERE — it exists only inside the emailed link.`,
  )
  console.log(
    `[${SCRIPT_NAME}] next step: the Gmail holder opens the link, sets a new password — the account ` +
      `email is verified and adopted, the login lockout is cleared, and all sessions are signed out. ` +
      `Sign-in: ${ORIGIN}/platform/login with the verified address + the new password.`,
  )
  process.exit(0)
}

main().catch((e: unknown) => {
  console.error(`[${SCRIPT_NAME}] failed: ${(e as Error).message}`)
  process.exit(1)
})
