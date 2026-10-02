/**
 * PHASE 8B (Task 8B-7-d) — Direct-messaging contract types.
 *
 * Pure TYPES ONLY (no server imports) so the API routes and the client
 * stores share ONE wire contract without dragging the Prisma client into
 * client bundles. The shapes mirror what /api/messaging/* actually
 * serializes — see src/app/api/messaging/** for the producers and
 * src/lib/store/{student-messaging-store,messaging-store} for consumers.
 *
 * All threads live in the shared Message table (the SAME engine the
 * teacher Communication Hub reads), so a thread created here is visible
 * in the teacher hub and vice versa — one canonical store per school.
 */

/** One conversation row in GET /api/messaging/threads. */
export interface DirectThreadSummary {
  /** The OTHER participant's User id (the thread key for the viewer). */
  counterpartId: string
  counterpart: {
    id: string
    name: string
    role: string
    /** Serve path for <img src> when the user has an avatar, else null. */
    avatarUrl: string | null
  }
  lastMessage: {
    /** ≤120-char excerpt of the newest message body. */
    body: string
    createdAt: string
    fromMe: boolean
  } | null
  /** Messages addressed to the viewer from this counterpart, unread. */
  unreadCount: number
  /** Viewer-owned per-thread flags (DirectThreadState row, defaults false). */
  threadState: {
    pinned: boolean
    archived: boolean
    needsReply: boolean
  }
}

/** GET /api/messaging/threads payload. */
export interface DirectThreadsPayload {
  threads: DirectThreadSummary[]
}

/** One message row in GET /api/messaging/threads/[userId]. */
export interface DirectThreadMessage {
  id: string
  senderId: string
  body: string
  read: boolean
  createdAt: string
}

/** GET /api/messaging/threads/[userId] payload (oldest → newest). */
export interface DirectThreadDetail {
  counterpart: {
    id: string
    name: string
    role: string
    avatarUrl: string | null
  }
  threadState: {
    pinned: boolean
    archived: boolean
    needsReply: boolean
  }
  messages: DirectThreadMessage[]
}

/** POST /api/messaging/threads/[userId] payload — the created row. */
export interface DirectMessageCreated {
  message: {
    id: string
    senderId: string
    recipientId: string
    subject: string
    body: string
    read: boolean
    createdAt: string
  }
}
