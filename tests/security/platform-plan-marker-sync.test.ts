/**
 * PLATFORM PLAN MARKER — field-sync invariant (the 2026-10-19
 * practical-acceptance regression).
 *
 * The "tenant plan marker" is RECORDED TWICE by design:
 *   · School.plan             — what the Schools list chip and the
 *                               Plan & billing marker control display
 *   · SchoolSubscription.plan — what the entitlement snapshot card, the
 *                               Subscriptions registry page and
 *                               evaluateTenantEntitlement read
 *
 * Provisioning writes BOTH with the same value in one transaction. The
 * marker-change route (PATCH /api/platform/schools/[id]/plan) previously
 * wrote ONLY School.plan, which:
 *
 *   1. left the Plan & billing card's baseline (it loads
 *      SchoolSubscription.plan via GET .../subscription) at the OLD
 *      value, so after a successful save the marker select SNAPPED BACK
 *      to the pre-save value — the UI contradicted its own success toast
 *      ("Tenant plan marker set to ENTERPRISE (audited)");
 *   2. made the console's plan surfaces disagree (Schools list chip said
 *      ENTERPRISE while the school-detail Snapshot card said STANDARD);
 *   3. could DISABLE a legitimate follow-up save (choice == stale
 *      baseline) — reproduced during the acceptance test when restoring
 *      the marker proved impossible without a page refresh.
 *
 * This suite pins the restored invariant with a real fixture tenant
 * (school + subscription, exactly the shape provisioning creates):
 *
 *   1. a marker change updates BOTH fields atomically;
 *   2. the GET .../subscription wire payload (the Plan & billing card's
 *      data source) reflects the NEW plan after the change — the
 *      post-save reload can no longer snap the select back;
 *   3. the Schools list row (school.plan) agrees with the subscription
 *      payload (SchoolSubscription.plan) after the change;
 *   4. the change is audited with the old → new pair;
 *   5. same→same is still rejected 409 (the idempotence guard);
 *   6. no session → 401 (fail-closed, unchanged).
 *
 * Live-HTTP against the dev server, same style as
 * platform-subscriptions-registry-summary; root session with the
 * direct-row fallback when the login limiter is hot. The fixture school
 * is removed in afterAll (cascade-verified teardown).
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { randomBytes } from 'crypto'

import { db } from '../helpers/db'
import { hashSessionToken } from '@/lib/auth'
import {
  PLATFORM_ROOT_EMAIL,
  PLATFORM_ROOT_PASSWORD,
} from '../helpers/credentials'
import { liveFetch } from '../helpers/live-http'

const BASE = process.env.TENANT_TEST_BASE ?? 'http://localhost:3000'
const T = 30_000

const RUN = `planmk${randomBytes(4).toString('hex')}`
const RUN_IP = `10.237.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`

const createdSessionHashes: string[] = []
let rootToken = ''
let schoolId = ''

/** Direct PlatformAdminSession row (auth fixture — bypasses only the
 *  login limiter, never an authorization gate). */
async function directPlatformSession(): Promise<string> {
  const admin = await db.platformAdmin.findUnique({ where: { email: PLATFORM_ROOT_EMAIL } })
  if (!admin) throw new Error(`no platform admin ${PLATFORM_ROOT_EMAIL}`)
  const token = randomBytes(32).toString('hex')
  await db.platformAdminSession.create({
    data: {
      adminId: admin.id,
      tokenHash: hashSessionToken(token),
      expiresAt: new Date(Date.now() + 3600_000),
    },
  })
  createdSessionHashes.push(hashSessionToken(token))
  return token
}

async function rootLogin(): Promise<string> {
  const res = await liveFetch(`${BASE}/api/platform/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': RUN_IP },
    body: JSON.stringify({ email: PLATFORM_ROOT_EMAIL, password: PLATFORM_ROOT_PASSWORD }),
  }, T)
  if (res.status === 429) return directPlatformSession()
  const body = (await res.json()) as { ok: boolean; data?: { sessionToken?: string } }
  if (!body.ok || !body.data?.sessionToken) {
    throw new Error(`platform login failed: ${JSON.stringify(body)}`)
  }
  return body.data.sessionToken
}

interface PlanBody {
  ok: boolean
  data?: { ok?: true; plan?: string }
  error?: string
}

async function patchPlan(
  token: string | null,
  plan: string,
  reason: string,
): Promise<{ status: number; body: PlanBody | null }> {
  const res = await liveFetch(`${BASE}/api/platform/schools/${schoolId}/plan`, {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
      ...(token ? { cookie: `scholario_platform_session=${token}` } : {}),
    },
    body: JSON.stringify({ plan, reason }),
  }, T)
  let body: PlanBody | null = null
  try {
    body = (await res.json()) as PlanBody
  } catch {
    /* non-JSON error body — assertions below surface it */
  }
  return { status: res.status, body }
}

beforeAll(async () => {
  rootToken = await rootLogin()

  // Fixture tenant — exactly the shape the provisioning wizard creates:
  // School + SchoolSubscription with the SAME plan value, one status
  // lifecycle, no pending-migration columns touched.
  const school = await db.school.create({
    data: {
      name: `PlanMarkerSync ${RUN}`,
      slug: `planmk-${RUN}`,
      code: `PM${RUN.slice(6, 12).toUpperCase()}`,
      plan: 'STANDARD',
      status: 'ACTIVE',
      board: 'CBSE',
      academicYear: '2026-2027',
      featureFlags: '{}',
      subscription: {
        create: {
          status: 'ACTIVE',
          plan: 'STANDARD',
          billingModel: 'SCHOOL_WIDE',
          periodStart: new Date(),
          periodEnd: null,
          graceDays: 14,
        },
      },
    },
    select: { id: true },
  })
  schoolId = school.id
})

afterAll(async () => {
  if (schoolId) {
    await db.school.delete({ where: { id: schoolId } }).catch(() => {})
  }
  for (const tokenHash of createdSessionHashes) {
    await db.platformAdminSession.deleteMany({ where: { tokenHash } }).catch(() => {})
  }
})

describe('plan marker — School.plan ⇄ SchoolSubscription.plan sync invariant', () => {
  test('a marker change updates BOTH recordings atomically (the acceptance-test regression)', async () => {
    const before = await db.school.findUnique({
      where: { id: schoolId },
      select: { plan: true, subscription: { select: { plan: true } } },
    })
    expect(before?.plan).toBe('STANDARD')
    expect(before?.subscription?.plan).toBe('STANDARD')

    const { status, body } = await patchPlan(rootToken, 'PRO', 'plan-marker sync regression')
    expect(status).toBe(200)
    expect(body?.ok).toBe(true)
    expect(body?.data?.plan).toBe('PRO')

    const after = await db.school.findUnique({
      where: { id: schoolId },
      select: { plan: true, subscription: { select: { plan: true } } },
    })
    // THE INVARIANT: both recordings move together.
    expect(after?.plan).toBe('PRO')
    expect(after?.subscription?.plan).toBe('PRO')
  }, T)

  test('the Plan & billing card’s data source (GET …/subscription) reflects the NEW plan', async () => {
    const res = await liveFetch(`${BASE}/api/platform/schools/${schoolId}/subscription`, {
      headers: { cookie: `scholario_platform_session=${rootToken}` },
    }, T)
    expect(res.status).toBe(200)
    const payload = (await res.json()) as {
      data?: { subscription?: { plan?: string }; school?: { id: string } }
    }
    // The card reloads this payload after a save — its baseline must now
    // show PRO, so the select can never snap back to the pre-save value.
    expect(payload.data?.subscription?.plan).toBe('PRO')
  }, T)

  test('the Schools list row and the subscription payload agree after a change', async () => {
    const res = await liveFetch(`${BASE}/api/platform/schools?summary=1&pageSize=100`, {
      headers: { cookie: `scholario_platform_session=${rootToken}` },
    }, T)
    expect(res.status).toBe(200)
    const payload = (await res.json()) as {
      data?: { schools?: Array<{ id: string; plan?: string }> }
    }
    const row = payload.data?.schools?.find((s) => s.id === schoolId)
    // school.plan (the list chip) must equal SchoolSubscription.plan (the
    // snapshot card) — the two console surfaces can no longer disagree.
    expect(row?.plan).toBe('PRO')
  }, T)

  test('the change is audited with the old → new pair', async () => {
    const audit = await db.platformAuditLog.findFirst({
      where: { action: 'platform.school.plan_changed', schoolId },
      orderBy: { createdAt: 'desc' },
      select: { reason: true, metadata: true },
    })
    expect(audit).not.toBeNull()
    expect(audit?.reason).toBe('plan-marker sync regression')
    const meta = audit?.metadata ? (JSON.parse(audit.metadata) as { from?: string; to?: string }) : null
    expect(meta?.from).toBe('STANDARD')
    expect(meta?.to).toBe('PRO')
  }, T)

  test('same→same is still rejected 409 (idempotence guard intact)', async () => {
    const { status } = await patchPlan(rootToken, 'PRO', 'same-plan guard probe')
    expect(status).toBe(409)
  }, T)

  test('no session → 401 (fail-closed, unchanged)', async () => {
    const { status } = await patchPlan(null, 'ENTERPRISE', 'unauthenticated probe')
    expect(status).toBe(401)
  }, T)
})
