# OWNER_RECOVERY — Super Admin access recovery runbook

**Audience:** the platform owner (the person who holds the Supabase
`SUPABASE_ACCESS_TOKEN`). **No agent or assistant is required.**

This document is the exact procedure for recovering Super Admin
(root) access to the Scholario platform console at
`https://scholario-platform.vercel.app`.

---

## When to use this

Any of:

- you cannot sign in as `admin@scholario.cloud` (forgotten password,
  credential lost, account locked out past the rate-limit window);
- email delivery is broken, so "Forgot password?" never arrives
  (today the Resend sending domain is unverified — the emailed reset
  flow is NOT a working recovery path until that is fixed);
- you want to rotate the root credential deliberately.

What this procedure **never** does: expose, print or reverse the
stored password hash; create new admins; change permissions; touch
school data.

---

## The one command

Run from a checkout of `signature4748-obs/Scholario-upgrade` on any
machine with [bun](https://bun.sh) installed:

```bash
SUPABASE_ACCESS_TOKEN=<your token> \
SUPABASE_PROJECT_REF=kbyknezedewvgrnqervj \
bun scripts/prod-release/root-credential-bootstrap.ts \
  --email admin@scholario.cloud
```

Optional flags:

| flag | effect |
| --- | --- |
| `--mark-production` | also sets the seed-era `isDemo` marker to `false` (see "The isDemo marker" below) |
| `--out /path/file.txt` | write the one-time password to a specific file (default: `~/.scholario-root-credential.txt`, `chmod 600`) |
| `--dry-run` | run every read-only guard and print what would happen; writes nothing |

What the command does (all in one database transaction, through the
Supabase Management API — the same authoritative channel the
migration pipeline uses):

1. verifies the target is the ACTIVE, `isRoot=true` PlatformAdmin
   (refuses anything else, fail-closed);
2. generates a **crypto-random one-time password** and stores only
   its **scrypt hash** — hashed with the exact production
   implementation (`src/lib/auth.ts hashPassword`);
3. revokes every live platform session of the account;
4. writes a `platform.root_credential.bootstrapped` audit row (no
   secrets in it);
5. prints the one-time password **once** to your terminal and writes
   it once to the file above.

An unauthenticated visitor can never reach this operation: it is not
an application endpoint. The authority is your Supabase access token.

## After the command: sign in and rotate

1. Sign in at `https://scholario-platform.vercel.app/platform/login`
   with `admin@scholario.cloud` and the printed one-time password.
2. **Immediately change the password:**
   `Settings → Account & sign-in → Change password`.
   This form (new in this release) verifies your current password,
   applies the new one, signs out every other device and rotates your
   current session. Before this release the only rotation path was
   the emailed reset link — which is why a broken email channel used
   to lock the credential in place.
3. Delete the credential file (`rm ~/.scholario-root-credential.txt`).

If you sign in but do NOT change the password, the one-time value
remains the active credential — change it the same day.

---

## Verification (what "root works" means)

After signing in you should see, without any assistant:

- **Schools** in the left navigation listing every real tenant with
  its status, plan, demo/production marker, founding principal email,
  and copy buttons for the canonical
  - login URL: `https://scholario-app-virid.vercel.app/s/<slug>/login`
  - website preview URL: `https://scholario-app-virid.vercel.app/?tenant=<slug>`
- **Add School** opens the provisioning wizard; on success it shows
  the new school's name, PENDING status, login URL, website preview
  URL, founding principal email and — only if the server generated
  it — the one-time principal credential, plus the activation
  next-step.

## Troubleshooting

| symptom | cause / fix |
| --- | --- |
| `REFUSING: no PlatformAdmin exists` | wrong `--email`; the target must already exist (this bootstrap never creates accounts) |
| `REFUSING: … not a root admin` | the bootstrap only targets root accounts by design |
| `REFUSING: … is SUSPENDED` | reactivate the account first (needs a second admin or direct DB action by the owner) |
| login says "Too many failed sign-ins" | the account rate-limit bucket (5 attempts / lockout window); wait it out — the lockout is minutes, not permanent |
| Management API `HTTP 401` | the `SUPABASE_ACCESS_TOKEN` is wrong or revoked — generate a new one in the Supabase dashboard |

## The isDemo marker (classification truth)

- The root account was created by the development seed, which marks
  every seeded platform admin `isDemo=true`. In production this flag
  has **no effect** (the only thing it gates — the dev-preview
  "demo authenticator" widget — is hard-disabled in production
  builds). It is a labelling artifact. `--mark-production` corrects
  the label deliberately; nothing about permissions changes either way.
- The school **Hawkings High School Prithvipur** is demo-marked
  because it was intentionally rebuilt as the platform's
  demo/showcase tenant by `scripts/transform-demo-tenant.ts` (the
  documented production demo-tenant transform). No record was changed
  by this release.

## Related mechanisms (already in the product)

- `POST /api/platform/auth/forgot-password` + `reset-password` —
  works only while email delivery works (single-use, 30-minute
  tokens; new requests supersede old ones).
- Dual-control root recovery (`/api/platform/admins/recovery`) —
  needs a second `admins.manage` holder; inert while only one ACTIVE
  admin exists. If you create a second admin, this becomes the
  preferred in-product root recovery path.
- `POST /api/platform/auth/change-password` — the in-session
  self-service rotation added by this release (see above).
