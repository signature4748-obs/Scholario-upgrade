import { db } from '@/lib/db'
import type { AuthUser } from '@/lib/auth'
import type { Prisma } from '@prisma/client'
import { classLabelOf } from '@/lib/teacher-hub'
import { num, dec, minDec, outstandingDec, type MoneyInput } from '@/lib/money'

/**
 * fee-workflow — THE canonical two-stage fee collection workflow.
 *
 *   CLASS TEACHER COLLECTS          PRINCIPAL VERIFIES
 *   ──────────────────────          ───────────────────
 *   FeeTransaction created          same row transitions
 *   status UNDER_VERIFICATION  →    status SUCCESS
 *   source CLASS_TEACHER            receiptNo SCH-YYYY-NNNN
 *   ledger NOT touched yet          Fee.paid += amount (ledger applied)
 *   principal notified              collector notified
 *
 * Core invariants (MASTER TASK §7–§19, §37, §47):
 *   · ONE payment = ONE canonical FeeTransaction row — every screen
 *     (teacher collection table, principal queue, student profile,
 *     receipts) reads the SAME row. No duplicate per-role records.
 *   · A class-teacher collection is NEVER a final verified payment —
 *     the student ledger (Fee.paid) only moves on verification.
 *   · Receipt numbers are database-backed, sequential and unique per
 *     school-year (SCH-2026-000001) — never UI-timestamp based.
 *   · Outstanding = billed − verified paid. Pending collections are
 *     reported SEPARATELY ("awaiting verification"), never as paid.
 */

// ── Vocabulary ────────────────────────────────────────────────────────

export const COLLECTION_SOURCES = [
  'CLASS_TEACHER',
  'PRINCIPAL',
  'SCHOOL_OFFICE',
  'ONLINE',
  'BANK_TRANSFER',
] as const
export type CollectionSource = (typeof COLLECTION_SOURCES)[number]

export const SOURCE_LABEL: Record<string, string> = {
  CLASS_TEACHER: 'Class Teacher',
  PRINCIPAL: 'Principal',
  SCHOOL_OFFICE: 'School Office',
  ONLINE: 'Online',
  BANK_TRANSFER: 'Bank Transfer',
}

/** Payment methods accepted for in-person collection (matches the
 * existing method vocabulary + ReceiptMethod naming of the fee module). */
export const COLLECTION_METHODS = ['CASH', 'UPI', 'CARD', 'NET_BANKING', 'BANK_TRANSFER'] as const
export type CollectionMethod = (typeof COLLECTION_METHODS)[number]

export const METHOD_LABEL: Record<string, string> = {
  CASH: 'Cash',
  UPI: 'UPI',
  CARD: 'Card',
  NET_BANKING: 'Net Banking',
  BANK_TRANSFER: 'Bank Transfer',
}

/** Terminal-ish statuses in the collection workflow. PENDING/FAILED stay
 * gateway-only; the collection workflow uses the rest. */
export const TXN_STATUS = {
  PENDING_VERIFICATION: 'UNDER_VERIFICATION',
  VERIFIED: 'SUCCESS',
  REJECTED: 'REJECTED',
  REFUNDED: 'REFUNDED',
} as const

// ── Receipt numbers ───────────────────────────────────────────────────

/**
 * Mint the next sequential receipt number for this school + calendar
 * year: SCH-2026-000001. Sequential and unique by construction (max+1
 * inside the caller's transaction).
 *
 * BATCH2-B4 — concurrency: the max+1 scan is serialised per school with a
 * PostgreSQL transaction-scoped advisory lock (`pg_advisory_xact_lock`),
 * so concurrent settlement writers (webhook / checkout verify / sandbox
 * confirm / manual transaction) mint DIFFERENT numbers instead of racing
 * to the same one and surfacing P2002 as a 500. The lock lives for the
 * caller's transaction only — it cannot leak or deadlock across mints;
 * the (schoolId, receiptNo) DB unique remains the backstop. (SQLite-era
 * comment retained for history: SQLite serialises writers by itself —
 * the advisory lock is a no-op-equivalent there.)
 */
export async function mintReceiptNo(
  schoolId: string,
  client: Prisma.TransactionClient = db,
): Promise<string> {
  // Serialize same-school mint racing inside THIS transaction. hashtext()
  // maps the school id into the lock's int4 key space; the xact-scoped
  // lock is released automatically at commit/rollback. $executeRaw (not
  // $queryRaw): the lock statement returns void, which $queryRaw's column
  // deserializer rejects.
  await client.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${schoolId}))`
  const year = new Date().getFullYear()
  const prefix = `SCH-${year}-`
  const rows = await client.feeTransaction.findMany({
    where: { schoolId, receiptNo: { startsWith: prefix } },
    select: { receiptNo: true },
  })
  let max = 0
  for (const r of rows) {
    const seq = Number((r.receiptNo ?? '').slice(prefix.length))
    if (Number.isFinite(seq) && seq > max) max = seq
  }
  return `${prefix}${String(max + 1).padStart(6, '0')}`
}

// ── Notifications + audit (best-effort, never fail the money action) ──

export async function pushMessage(
  schoolId: string,
  senderId: string,
  recipientId: string,
  subject: string,
  body: string,
): Promise<void> {
  try {
    await db.message.create({ data: { schoolId, senderId, recipientId, subject, body } })
  } catch {
    /* notification failures never break the payment workflow */
  }
}

/** All Principal / Management users of the school — the verification
 * audience for "collection recorded" pings. */
export async function principalUserIds(schoolId: string): Promise<string[]> {
  const rows = await db.user.findMany({
    where: { schoolId, role: { in: ['PRINCIPAL', 'MANAGEMENT'] }, status: 'ACTIVE' },
    select: { id: true },
  })
  return rows.map((r) => r.id)
}

export async function audit(
  schoolId: string,
  userId: string,
  action: string,
  detail: string,
): Promise<void> {
  try {
    await db.activityLog.create({ data: { schoolId, userId, action, detail } })
  } catch {
    /* audit failures never break the payment workflow */
  }
}

// ── Permission guards (server-side, the ONLY authority) ───────────────

/**
 * The classes this user is currently appointed class teacher of.
 * THE appointment record: Class.classTeacherId stores the User id.
 */
export async function classTeacherClassesOf(user: AuthUser, schoolId: string) {
  return db.class.findMany({ where: { schoolId, classTeacherId: user.id } })
}

/**
 * Assert the signed-in teacher is the class teacher of the student's
 * class — the gate for every fee-collection read/write (MASTER TASK
 * §21–§22: never trust client ids, never frontend-filter).
 * Throws FORBIDDEN when out of scope.
 */
export async function assertClassTeacherOfStudent(user: AuthUser, schoolId: string, studentId: string) {
  const student = await db.student.findFirst({
    where: { id: studentId, schoolId },
    select: { id: true, classId: true, class: true, user: { select: { name: true } } },
  })
  if (!student) throw new Error('NOT_FOUND')
  if (!student.classId) throw new Error('FORBIDDEN')
  const cls = student.class
  if (!cls || cls.classTeacherId !== user.id) throw new Error('FORBIDDEN')
  return { student, cls }
}

// ── Duplicate reference detection (MASTER TASK §29-8) ─────────────────

export async function assertReferenceUnique(
  schoolId: string,
  referenceNumber: string,
  client: Prisma.TransactionClient = db,
) {
  const ref = referenceNumber.trim()
  if (!ref) return
  const dup = await client.feeTransaction.findFirst({
    where: { schoolId, referenceNumber: ref },
    select: { id: true, receiptNo: true, studentName: true },
  })
  if (dup) {
    throw new Error(
      `Reference number ${ref} is already recorded${dup.studentName ? ` for ${dup.studentName}` : ''}${dup.receiptNo ? ` (receipt ${dup.receiptNo})` : ''}. A payment cannot be recorded twice with the same reference.`,
    )
  }
}

// ── Ledger application (verification time — the ONLY ledger writer) ───

export interface LedgerApplyInput {
  /** Idempotency key — the Payment.transactionId of the mirror row. */
  txnId: string
  schoolId: string
  feeId: string | null
  /** Decimal (DB-sourced txn row) or number (validated request body). */
  amount: MoneyInput
  method: string
}

export interface LedgerApplyResult {
  feeId: string
  paid: number
  outstanding: number
  status: string
  /** Amount actually credited (clamped to the outstanding balance). */
  applied: number
  /** True when a Payment row for this txnId already existed (replay). */
  alreadyApplied: boolean
}

/**
 * THE canonical ledger writer (Phase 3): apply a VERIFIED payment to the
 * student's fee ledger.
 *
 *   · `tx` (optional, defaults to `db`) — pass the caller's interactive
 *     transaction client so the ledger apply is atomic with the status
 *     transition that authorises it (verification / webhook / confirm).
 *   · IDEMPOTENT: Payment.transactionId is the idempotency key — when a
 *     mirror row for `txnId` already exists the ledger is NOT re-applied
 *     (a replayed webhook / retried verify returns the current totals).
 *     The DB-level @unique on Payment.transactionId backstops this.
 *   · CLAMPED: the fee is re-read INSIDE this transaction, the applied
 *     amount is clamped to the outstanding balance and written with
 *     `{ increment }` — a concurrent double-apply can never overshoot
 *     Fee.amount (the Fee.paid DB bound-guard backstops this in depth).
 *   · Every Payment mirror row carries `schoolId` (derived from the fee).
 *
 * Returns the (possibly unchanged) Fee totals for the response payload;
 * null when the fee is missing/foreign (same as before).
 */
export async function applyPaymentToLedger(
  input: LedgerApplyInput,
  tx: Prisma.TransactionClient = db,
): Promise<LedgerApplyResult | null> {
  if (!input.feeId) return null
  const fee = await tx.fee.findUnique({ where: { id: input.feeId } })
  if (!fee || fee.schoolId !== input.schoolId) return null

  // Idempotency: a Payment mirror for this txnId means the money already
  // landed — report the current totals, write nothing.
  const existing = await tx.payment.findUnique({
    where: { transactionId: input.txnId },
    select: { id: true },
  })
  if (existing) {
    return {
      feeId: fee.id,
      paid: num(fee.paid),
      outstanding: num(outstandingDec(fee.amount, fee.paid)),
      status: fee.status,
      applied: 0,
      alreadyApplied: true,
    }
  }

  // Clamp: never credit beyond the billed amount. All arithmetic is
  // paise-exact Prisma.Decimal math on DB-sourced NUMERIC values.
  const outstanding = outstandingDec(fee.amount, fee.paid)
  const applied = minDec(input.amount, outstanding)
  if (applied.lessThanOrEqualTo(0)) {
    // Fee already fully paid — nothing to apply (Payment.amount must be
    // > 0 per the DB guard; a zero mirror row would be rejected anyway).
    return { feeId: fee.id, paid: num(fee.paid), outstanding: num(outstanding), status: fee.status, applied: 0, alreadyApplied: false }
  }

  const newPaid = dec(fee.paid).plus(applied)
  const status = newPaid.greaterThanOrEqualTo(fee.amount) ? 'PAID' : 'PARTIAL'
  await tx.fee.update({
    where: { id: fee.id },
    data: { paid: { increment: applied }, status, method: input.method, paidDate: new Date() },
  })
  await tx.payment.create({
    data: {
      schoolId: fee.schoolId,
      feeId: fee.id,
      amount: applied,
      method: input.method,
      status: 'SUCCESS',
      transactionId: input.txnId,
      note: `Canonical payment ${input.txnId} — applied on verification`,
    },
  })
  return {
    feeId: fee.id,
    paid: num(newPaid),
    outstanding: num(outstandingDec(fee.amount, newPaid)),
    status,
    applied: num(applied),
    alreadyApplied: false,
  }
}

// ── Server-side obligation check for order creation (BATCH2-B2) ────────

/**
 * Compute what a student actually owes, SERVER-SIDE, for order-amount
 * validation — the amount a client may request an order for is bounded by
 * this number, never by the client's own claim. NEVER creates rows: an
 * obligation exists or it does not.
 *
 *   · explicit feeId (optional): the fee must belong to (schoolId,
 *     studentId); its outstanding is the single obligation in scope.
 *   · otherwise: the SUM of outstanding across the student's OPEN fees
 *     (UNPAID / PARTIAL / PENDING — the same open-status vocabulary the
 *     settlement-time resolver uses).
 *
 * Returns the resolved feeId (when the explicit fee validated — persist it
 * on the order row so settlement credits the intended obligation) plus the
 * outstanding total. A caller receiving feeId: null with outstanding 0 and
 * a non-null requestedFeeId must treat the fee reference as invalid
 * (foreign tenant / another student's fee / unknown id).
 */
export async function outstandingForOrder(
  client: Prisma.TransactionClient | typeof db,
  input: { schoolId: string; studentId: string; feeId?: string | null },
): Promise<{ feeId: string | null; outstanding: number; feeTitle: string | null }> {
  if (input.feeId) {
    const fee = await client.fee.findFirst({
      where: { id: input.feeId, schoolId: input.schoolId, studentId: input.studentId },
      select: { id: true, title: true, amount: true, paid: true },
    })
    if (!fee) return { feeId: null, outstanding: 0, feeTitle: null }
    return {
      feeId: fee.id,
      outstanding: num(outstandingDec(fee.amount, fee.paid)),
      feeTitle: fee.title,
    }
  }
  const fees = await client.fee.findMany({
    where: { studentId: input.studentId, schoolId: input.schoolId, status: { in: ['UNPAID', 'PARTIAL', 'PENDING'] } },
    select: { amount: true, paid: true },
  })
  let total = dec(0)
  for (const f of fees) total = total.plus(outstandingDec(f.amount, f.paid))
  return { feeId: null, outstanding: num(total), feeTitle: null }
}

// ── Fee targeting for gateway transactions (Phase 3) ─────────────────

/**
 * Resolve (or create) the Fee row a gateway transaction should credit,
 * INSIDE the caller's transaction:
 *   1. the txn's own feeId when present;
 *   2. else an exact feeHeadName title match (oldest first);
 *   3. else the student's OLDEST unsettled fee (UNPAID/PARTIAL/PENDING) —
 *      never a random paid row silently absorbing the money;
 *   4. else a minimal Fee row so the ledger linkage always exists.
 */
export async function resolveFeeIdForTxn(
  tx: Prisma.TransactionClient,
  input: {
    schoolId: string
    studentId: string
    feeId: string | null
    feeHeadName: string | null
    amount: MoneyInput
    method: string
    paidAt?: Date
  },
): Promise<string> {
  if (input.feeId) return input.feeId
  const byTitle = input.feeHeadName
    ? await tx.fee.findFirst({
        where: { studentId: input.studentId, title: input.feeHeadName },
        orderBy: { createdAt: 'asc' },
      })
    : null
  const openFee =
    byTitle ??
    (await tx.fee.findFirst({
      where: { studentId: input.studentId, status: { in: ['UNPAID', 'PARTIAL', 'PENDING'] } },
      orderBy: { createdAt: 'asc' },
    }))
  if (openFee) return openFee.id
  const created = await tx.fee.create({
    data: {
      schoolId: input.schoolId,
      studentId: input.studentId,
      title: input.feeHeadName ?? 'Student Fee Payment',
      amount: input.amount,
      paid: 0,
      status: 'UNPAID',
      method: input.method,
      paidDate: input.paidAt ?? new Date(),
    },
  })
  return created.id
}

// ── Shared DTO shape (teacher + principal + receipt views) ────────────

export interface FeeTxnDto {
  id: string
  studentId: string | null
  studentName: string | null
  className: string | null
  feeId: string | null
  feeHeadName: string | null
  amount: number
  method: string
  status: string
  source: string | null
  referenceNumber: string | null
  note: string | null
  receiptNo: string | null
  collectedBy: string | null
  collectedAt: string | null
  verifiedBy: string | null
  verifiedAt: string | null
  rejectedBy: string | null
  rejectedAt: string | null
  rejectionReason: string | null
  createdAt: string
}

type TxnRow = {
  id: string
  studentId: string | null
  studentName: string | null
  className: string | null
  feeId: string | null
  feeHeadName: string | null
  amount: MoneyInput
  method: string
  status: string
  source: string | null
  referenceNumber: string | null
  note: string | null
  receiptNo: string | null
  collectedByName: string | null
  collectedAt: Date | null
  verifiedByName: string | null
  verifiedAt: Date | null
  rejectedByName: string | null
  rejectedAt: Date | null
  rejectionReason: string | null
  createdAt: Date
}

/** The one DTO every surface renders — teacher collection table,
 * principal queue, student profile history, receipt modal. */
export function toFeeTxnDto(t: TxnRow): FeeTxnDto {
  return {
    id: t.id,
    studentId: t.studentId,
    studentName: t.studentName,
    className: t.className,
    feeId: t.feeId,
    feeHeadName: t.feeHeadName,
    amount: num(t.amount),
    method: t.method,
    status: t.status,
    source: t.source,
    referenceNumber: t.referenceNumber,
    note: t.note,
    receiptNo: t.receiptNo,
    collectedBy: t.collectedByName,
    collectedAt: t.collectedAt ? t.collectedAt.toISOString() : null,
    verifiedBy: t.verifiedByName,
    verifiedAt: t.verifiedAt ? t.verifiedAt.toISOString() : null,
    rejectedBy: t.rejectedByName,
    rejectedAt: t.rejectedAt ? t.rejectedAt.toISOString() : null,
    rejectionReason: t.rejectionReason,
    createdAt: t.createdAt.toISOString(),
  }
}

/** Fee rows the collection workflow considers (in-person money), i.e.
 * FeeTransactions that carry a collection source. Gateway orders
 * (gatewayOrderId set, source ONLINE) are excluded from the class
 * teacher's table but keep flowing through the gateway module. */
export function isCollectionTxn(t: { source: string | null }) {
  return !!t.source
}

export { classLabelOf }
