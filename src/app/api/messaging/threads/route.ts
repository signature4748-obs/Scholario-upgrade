import { withAuthz } from '@/lib/security/authz'
import { db } from '@/lib/db'
import type { DirectThreadSummary, DirectThreadsPayload } from '@/lib/messaging/types'

export const runtime = 'nodejs'

/**
 * GET /api/messaging/threads — the CURRENT user's direct-message threads.
 *
 * Server-canonical (Task 8B-7-d): every school-plane role (student,
 * parent, teacher, principal, management …) sees the SAME thread list
 * derived from the shared Message table — the engine the teacher
 * Communication Hub also reads. A thread started by a student here is
 * exactly the thread the teacher sees in her hub, and vice versa.
 *
 * Per thread: counterpart profile, last-message excerpt (≤120 chars),
 * exact unread count (recipient=me ∧ sender=counterpart ∧ read=false)
 * and the viewer's DirectThreadState flags (pin / archive / needs-reply,
 * defaults false). Ordered by last-message time, capped at 100.
 */
const DIRECT_FETCH_WINDOW = 300
const THREAD_CAP = 100
const EXCERPT_MAX = 120

export async function GET() {
  return withAuthz({ tenant: 'school' }, async (ctx) => {
    const me = ctx.user.id

    // 1 — the viewer's direct Message rows (both directions), newest
    //     first: the first row seen per counterpart is that thread's
    //     last message. School-scoped — the rows themselves guarantee
    //     same-school counterparts.
    // 2 — exact unread counts per sender (whole history, not just the
    //     fetch window) for threads the window touches.
    // 3 — the viewer's per-thread state rows.
    const [rows, unreadGroups, states] = await Promise.all([
      db.message.findMany({
        where: { schoolId: ctx.schoolId, OR: [{ senderId: me }, { recipientId: me }] },
        orderBy: { createdAt: 'desc' },
        take: DIRECT_FETCH_WINDOW,
        select: {
          id: true,
          senderId: true,
          recipientId: true,
          body: true,
          read: true,
          createdAt: true,
          sender: { select: { id: true, name: true, role: true, avatarUrl: true } },
          recipient: { select: { id: true, name: true, role: true, avatarUrl: true } },
        },
      }),
      db.message.groupBy({
        by: ['senderId'],
        where: { schoolId: ctx.schoolId, recipientId: me, read: false },
        _count: { _all: true },
      }),
      db.directThreadState.findMany({ where: { schoolId: ctx.schoolId, userId: me } }),
    ])

    const unreadBySender = new Map<string, number>()
    for (const g of unreadGroups) {
      if (g.senderId) unreadBySender.set(g.senderId, g._count._all)
    }
    const stateByCounterpart = new Map(states.map((s) => [s.counterpartId, s]))

    // Group by counterpart — one summary per person, newest row first.
    const byCounterpart = new Map<string, DirectThreadSummary>()
    for (const m of rows) {
      const fromMe = m.senderId === me
      const counterpart = fromMe ? m.recipient : m.sender
      if (!counterpart) continue // deleted account (SetNull) — no thread face
      const existing = byCounterpart.get(counterpart.id)
      if (existing) {
        // Unread counting is exact via the groupBy above; nothing to add.
        continue
      }
      const state = stateByCounterpart.get(counterpart.id)
      byCounterpart.set(counterpart.id, {
        counterpartId: counterpart.id,
        counterpart: {
          id: counterpart.id,
          name: counterpart.name ?? 'User',
          role: counterpart.role,
          avatarUrl: counterpart.avatarUrl,
        },
        lastMessage: {
          body: m.body.replace(/\s+/g, ' ').trim().slice(0, EXCERPT_MAX),
          createdAt: m.createdAt.toISOString(),
          fromMe,
        },
        unreadCount: unreadBySender.get(counterpart.id) ?? 0,
        threadState: {
          pinned: state?.pinned ?? false,
          archived: state?.archived ?? false,
          needsReply: state?.needsReply ?? false,
        },
      })
    }

    const threads = [...byCounterpart.values()]
      .sort((a, b) => {
        const at = a.lastMessage ? Date.parse(a.lastMessage.createdAt) : 0
        const bt = b.lastMessage ? Date.parse(b.lastMessage.createdAt) : 0
        return bt - at
      })
      .slice(0, THREAD_CAP)

    const payload: DirectThreadsPayload = { threads }
    return payload
  })
}
