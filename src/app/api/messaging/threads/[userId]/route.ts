import { NextRequest } from 'next/server'
import { z } from 'zod'
import { withAuthz } from '@/lib/security/authz'
import { db } from '@/lib/db'
import { enforceRateLimit, RATE_LIMITS } from '@/lib/security/rate-limit'
import { publishToUser } from '@/lib/realtime/publish'
import type { DirectThreadDetail, DirectMessageCreated } from '@/lib/messaging/types'
import {
  assertCanSendTo,
  fetchDirectCounterpart,
  DIRECT_MESSAGE_SUBJECT,
  DIRECT_MESSAGE_MAX,
} from '@/lib/messaging/direct'

export const runtime = 'nodejs'

/** Full thread history served per open — mirrors the teacher hub's pane. */
const THREAD_TAKE = 100
const REALTIME_PREVIEW_MAX = 80

// Direct-message send body: 1–4000 chars after trimming. zod-validated;
// failures surface as a deliberate route-authored 400 (the same shape the
// teacher direct route uses for missing subject/body), not a 422 schema
// dump — one honest sentence the client can show verbatim.
const sendSchema = z.object({
  body: z.string().trim().min(1).max(DIRECT_MESSAGE_MAX),
})

/**
 * GET /api/messaging/threads/[userId] — one direct thread between the
 * viewer and a same-school ACTIVE counterpart: the last 100 messages
 * (oldest → newest), the viewer's per-thread state, plus the side
 * effects that make the thread "opened":
 *   · every unread message the counterpart sent flips read=true
 *   · the viewer's DirectThreadState row upserts needsReply=false
 * A foreign-tenant or non-ACTIVE counterpart id is a fail-safe 404 (no
 * existence oracle).
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
) {
  return withAuthz({ tenant: 'school' }, async (ctx) => {
    const { userId } = await params
    const counterpart = await fetchDirectCounterpart(ctx, userId)

    const [rows, state] = await Promise.all([
      db.message.findMany({
        where: {
          schoolId: ctx.schoolId,
          OR: [
            { senderId: ctx.user.id, recipientId: counterpart.id },
            { senderId: counterpart.id, recipientId: ctx.user.id },
          ],
        },
        orderBy: { createdAt: 'desc' },
        take: THREAD_TAKE,
        select: { id: true, senderId: true, body: true, read: true, createdAt: true },
      }),
      db.directThreadState.findUnique({
        where: { userId_counterpartId: { userId: ctx.user.id, counterpartId: counterpart.id } },
      }),
    ])

    // Opening the thread marks the counterpart's messages read (server
    // truth for both sides' unread badges).
    await db.message.updateMany({
      where: {
        schoolId: ctx.schoolId,
        recipientId: ctx.user.id,
        senderId: counterpart.id,
        read: false,
      },
      data: { read: true },
    })

    // The viewer has now seen the thread — her "needs reply" flag clears.
    // (Upsert-on-open keeps the row's other viewer-owned flags intact.)
    await db.directThreadState.upsert({
      where: {
        userId_counterpartId: { userId: ctx.user.id, counterpartId: counterpart.id },
      },
      create: {
        schoolId: ctx.schoolId,
        userId: ctx.user.id,
        counterpartId: counterpart.id,
        needsReply: false,
      },
      update: { needsReply: false },
    })

    const payload: DirectThreadDetail = {
      counterpart: {
        id: counterpart.id,
        name: counterpart.name,
        role: counterpart.role,
        avatarUrl: counterpart.avatarUrl,
      },
      threadState: {
        pinned: state?.pinned ?? false,
        archived: state?.archived ?? false,
        needsReply: false,
      },
      // newest-first fetch, oldest-first render
      messages: rows
        .slice()
        .reverse()
        .map((m) => ({
          id: m.id,
          senderId: m.senderId ?? counterpart.id,
          body: m.body,
          read: m.read,
          createdAt: m.createdAt.toISOString(),
        })),
    }
    return payload
  })
}

/**
 * POST /api/messaging/threads/[userId] — send a direct message.
 *
 * One Message row in the shared table (the teacher hub, this API and
 * every future surface read the same rows). Guarantees, in order:
 *   rate limit ('message' profile, per-user, shared budget with the
 *     legacy /api/messages + teacher-direct routes)
 *   · body 1–4000 chars (zod; route-authored 400 on failure)
 *   · counterpart exists, is SAME-SCHOOL and ACTIVE (fail-safe 404 —
 *     cross-tenant ids never confirm existence)
 *   · no self-send
 *   · recipient policy (students/parents message staff only; staff
 *     message students, staff and parents; unknown sender roles closed)
 * Recipients get a realtime 'message' hint (ids + an 80-char preview;
 * never row data) through the fire-safe publisher.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
) {
  return withAuthz({ tenant: 'school' }, async (ctx) => {
    // Same profile + key family as the other message-send routes — a
    // hijacked account cannot multiply its budget across surfaces.
    enforceRateLimit(`rl:msg:${ctx.user.id}`, RATE_LIMITS.message)

    const { userId } = await params

    const raw = await req.json().catch(() => null)
    const parsed = sendSchema.safeParse(raw)
    if (!parsed.success) {
      throw new Error(`Message is required (1–${DIRECT_MESSAGE_MAX} characters)`)
    }
    const bodyText = parsed.data.body

    const counterpart = await fetchDirectCounterpart(ctx, userId)
    if (counterpart.id === ctx.user.id) {
      throw new Error('You cannot message yourself')
    }
    assertCanSendTo(ctx.role, counterpart.role)

    const created = await db.message.create({
      data: {
        schoolId: ctx.schoolId,
        senderId: ctx.user.id,
        recipientId: counterpart.id,
        subject: DIRECT_MESSAGE_SUBJECT,
        body: bodyText,
      },
    })

    // Realtime hint to the recipient — ids/preview only, fire-safe (the
    // DB row above is the truth; this is a best-effort wake-up ping).
    await publishToUser(ctx.schoolId, counterpart.id, 'message', {
      id: created.id,
      at: created.createdAt.toISOString(),
      senderId: ctx.user.id,
      senderName: ctx.user.name ?? 'User',
      preview: bodyText.slice(0, REALTIME_PREVIEW_MAX),
    })

    const payload: DirectMessageCreated = {
      message: {
        id: created.id,
        senderId: created.senderId ?? ctx.user.id,
        recipientId: created.recipientId ?? counterpart.id,
        subject: created.subject,
        body: created.body,
        read: created.read,
        createdAt: created.createdAt.toISOString(),
      },
    }
    return payload
  })
}
