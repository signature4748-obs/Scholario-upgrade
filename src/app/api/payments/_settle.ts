import { db } from "@/lib/db";

/**
 * Fee settlement engine.
 *
 * The Payment model has no direct link to FeeAssessment rows, so settlement is
 * derived, not stored:
 *
 *  · Recording a payment allocates it oldest-DUE-first — whole heads only,
 *    heads it cannot fully clear stay open — and marks them PAID.
 *
 *  · Rejecting a payment re-derives which heads that receipt was paying for
 *    by re-attributing the ledger without it, and reverts the difference.
 *    Attribution mirrors how the office actually issues receipts:
 *      pass 1 — a receipt settles PAID heads that fall due in the same
 *                calendar month it was paid (largest head first); seeded
 *                receipts are exact month sums, so this reproduces them.
 *      pass 2 — leftover receipt money absorbs remaining PAID heads
 *                oldest-first (receipts recorded at the counter often settle
 *                older dues across months).
 *
 *    Only currently-PAID heads are ever attributed, so the engine never
 *    fabricates coverage; rejecting a receipt reopens at most the heads its
 *    money was carrying.
 */

interface HeadRow {
  id: string;
  amount: number;
  concession: number;
  status: string;
  dueOn: string;
}

const costOf = (h: HeadRow) => h.amount - h.concession;
const monthOf = (iso: string) => iso.slice(0, 7);
const paidOnMonth = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;

/** Assessments covered by a new payment, oldest-DUE-first, whole heads only. */
export function allocateForPayment(
  dues: HeadRow[],
  amount: number,
): string[] {
  const paid: string[] = [];
  let remaining = amount;
  for (const a of dues) {
    const cost = costOf(a);
    if (cost <= 0) continue;
    if (cost > remaining) continue; // head stays open; keep allocating below
    paid.push(a.id);
    remaining -= cost;
  }
  return paid;
}

async function loadLedger(studentId: string, opts: { excludePaymentId?: string } = {}) {
  const [assessments, payments] = await Promise.all([
    db.feeAssessment.findMany({
      where: { studentId },
      orderBy: [{ dueOn: "asc" }, { id: "asc" }],
      select: { id: true, amount: true, concession: true, status: true, dueOn: true },
    }),
    db.payment.findMany({
      where: {
        studentId,
        status: { in: ["SUCCESS", "UNDER_VERIFICATION"] },
        ...(opts.excludePaymentId ? { id: { not: opts.excludePaymentId } } : {}),
      },
      orderBy: [{ paidOn: "asc" }, { createdAt: "asc" }, { receiptNo: "asc" }],
      select: { id: true, amount: true, paidOn: true },
    }),
  ]);
  return { assessments, payments };
}

/** Two-pass attribution of currently-PAID heads to live receipts. */
async function attribution(studentId: string, opts: { excludePaymentId?: string } = {}) {
  const { assessments, payments } = await loadLedger(studentId, opts);
  const heads = assessments.filter((a) => a.status === "PAID" && costOf(a) > 0);

  const attributed = new Set<string>();
  const byPayment = new Map<string, Set<string>>(payments.map((p) => [p.id, new Set()]));
  const spent = new Map<string, number>(payments.map((p) => [p.id, 0]));

  // Pass 1 — same-calendar-month heads, largest cost first.
  for (const p of payments) {
    const m = paidOnMonth(p.paidOn);
    let remaining = p.amount;
    const pool = heads.filter((h) => !attributed.has(h.id) && monthOf(h.dueOn) === m);
    pool.sort((a, b) => costOf(b) - costOf(a) || a.dueOn.localeCompare(b.dueOn) || a.id.localeCompare(b.id));
    for (const h of pool) {
      const cost = costOf(h);
      if (cost > remaining) continue;
      byPayment.get(p.id)!.add(h.id);
      attributed.add(h.id);
      remaining -= cost;
    }
    spent.set(p.id, p.amount - remaining);
  }

  // Pass 2 — leftovers absorb remaining PAID heads oldest-first.
  for (const p of payments) {
    let remaining = p.amount - spent.get(p.id)!;
    if (remaining <= 0) continue;
    for (const h of heads) {
      if (attributed.has(h.id)) continue;
      const cost = costOf(h);
      if (cost > remaining) continue;
      byPayment.get(p.id)!.add(h.id);
      attributed.add(h.id);
      remaining -= cost;
    }
  }

  return { byPayment, attributed };
}

/**
 * Assessments to reopen when `paymentId` is rejected: heads attributed to
 * that receipt that no other live receipt carries without it.
 */
export async function revertSetFor(
  studentId: string,
  paymentId: string,
): Promise<string[]> {
  const [withIt, withoutIt] = await Promise.all([
    attribution(studentId),
    attribution(studentId, { excludePaymentId: paymentId }),
  ]);
  const mine = withIt.byPayment.get(paymentId) ?? new Set<string>();
  return [...mine].filter((id) => !withoutIt.attributed.has(id));
}

/** Next receipt number for a tenant: RCPT-2026-<next 4>. */
export async function nextReceiptNo(schoolId: string): Promise<string> {
  const last = await db.payment.findFirst({
    where: { schoolId, receiptNo: { startsWith: "RCPT-2026-" } },
    orderBy: { receiptNo: "desc" },
    select: { receiptNo: true },
  });
  const n = last ? parseInt(last.receiptNo.slice("RCPT-2026-".length), 10) + 1 : 1;
  return `RCPT-2026-${String(n).padStart(4, "0")}`;
}
