import { z } from "zod";
import { db } from "@/lib/db";
import { requireRole, ok, fail, route } from "@/lib/api";
import { revertSetFor } from "../_settle";

const schema = z.object({
  paymentId: z.string().min(1),
  action: z.enum(["verify", "reject"]),
});

export const POST = route(async (req: Request) => {
  const user = await requireRole("PRINCIPAL");
  const body = schema.parse(await req.json().catch(() => ({})));

  const payment = await db.payment.findUnique({
    where: { id: body.paymentId },
    include: { student: { select: { id: true, name: true, class: { select: { name: true } } } } },
  });
  if (!payment || payment.schoolId !== user.schoolId) throw fail(404, "Receipt not found in this school.");
  if (payment.status !== "UNDER_VERIFICATION") {
    throw fail(409, `Receipt ${payment.receiptNo} is already ${payment.status.toLowerCase().replace(/_/g, " ")}.`);
  }

  if (body.action === "verify") {
    await db.$transaction([
      db.payment.update({
        where: { id: payment.id },
        data: { status: "SUCCESS", verifiedById: user.id, verifiedAt: new Date() },
      }),
      db.activityLog.create({
        data: {
          schoolId: user.schoolId, actorName: user.name, actorRole: user.role,
          action: "Fee verified",
          detail: `Receipt ${payment.receiptNo} (₹${payment.amount.toLocaleString("en-IN")}) verified — ${payment.student.name}, ${payment.student.class.name}`,
        },
      }),
    ]);
    return ok({ receiptNo: payment.receiptNo, status: "SUCCESS", reverted: 0 });
  }

  // Reject: mark REJECTED and revert this payment's allocations by replaying
  // the ledger without it (oldest-DUE-first settlement, no stored link).
  const markDue = await revertSetFor(payment.studentId, payment.id);
  await db.$transaction([
    db.payment.update({ where: { id: payment.id }, data: { status: "REJECTED", verifiedById: user.id, verifiedAt: new Date() } }),
    ...(markDue.length ? [db.feeAssessment.updateMany({ where: { id: { in: markDue } }, data: { status: "DUE" } })] : []),
    db.activityLog.create({
      data: {
        schoolId: user.schoolId, actorName: user.name, actorRole: user.role,
        action: "Fee rejected",
        detail: `Receipt ${payment.receiptNo} (₹${payment.amount.toLocaleString("en-IN")}) rejected — ${markDue.length} dues reverted for ${payment.student.name}, ${payment.student.class.name}`,
      },
    }),
  ]);

  return ok({ receiptNo: payment.receiptNo, status: "REJECTED", reverted: markDue.length, studentName: payment.student.name });
});
