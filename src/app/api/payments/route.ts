import { z } from "zod";
import { db } from "@/lib/db";
import { requireRole, requireSession, ok, fail, route, isoToday } from "@/lib/api";
import { allocateForPayment, nextReceiptNo } from "./_settle";

const MODES = ["CASH", "UPI", "BANK_TRANSFER", "CHEQUE"] as const;

const postSchema = z.object({
  studentId: z.string().min(1),
  amount: z.number().int().min(1).max(10000000),
  mode: z.enum(MODES),
  note: z.string().trim().max(240).optional(),
});

export const GET = route(async (req: Request) => {
  const user = await requireSession();
  const url = new URL(req.url);

  if (user.role === "PRINCIPAL") {
    const status = url.searchParams.get("status"); // SUCCESS | UNDER_VERIFICATION | REJECTED | null (all)
    const payments = await db.payment.findMany({
      where: { schoolId: user.schoolId, ...(status ? { status } : {}) },
      orderBy: [{ paidOn: "desc" }, { receiptNo: "desc" }],
      take: 200,
      select: {
        id: true, receiptNo: true, amount: true, mode: true, status: true, note: true,
        paidOn: true, verifiedAt: true,
        student: { select: { name: true, admissionNo: true, class: { select: { name: true } } } },
        collector: { select: { user: { select: { name: true } } } },
      },
    });
    return ok({
      role: "PRINCIPAL" as const,
      payments: payments.map((p) => ({
        id: p.id, receiptNo: p.receiptNo, amount: p.amount, mode: p.mode, status: p.status,
        note: p.note, paidOn: p.paidOn, verifiedAt: p.verifiedAt,
        studentName: p.student.name, className: p.student.class.name,
        collector: p.collector?.user.name ?? null,
      })),
    });
  }

  if (user.role === "TEACHER") {
    const teacherId = user.teacherId;
    if (!teacherId) throw fail(400, "No teacher profile is linked to this account.");

    const monthStart = isoToday().slice(0, 8) + "01";
    const [payments, monthAgg, pendingCount, myClasses] = await Promise.all([
      db.payment.findMany({
        where: { schoolId: user.schoolId, collectedById: teacherId },
        orderBy: [{ paidOn: "desc" }, { receiptNo: "desc" }],
        select: {
          id: true, receiptNo: true, amount: true, mode: true, status: true, note: true,
          paidOn: true, verifiedAt: true,
          student: { select: { name: true, admissionNo: true, class: { select: { name: true } } } },
        },
      }),
      db.payment.aggregate({
        where: { schoolId: user.schoolId, collectedById: teacherId, paidOn: { gte: new Date(monthStart) } },
        _sum: { amount: true }, _count: true,
      }),
      db.payment.count({ where: { schoolId: user.schoolId, collectedById: teacherId, status: "UNDER_VERIFICATION" } }),
      db.class.findMany({
        where: { schoolId: user.schoolId, OR: [{ classTeacherId: teacherId }, { subjects: { some: { teacherId } } }] },
        select: { id: true, name: true },
        orderBy: { gradeLevel: "asc" },
      }),
    ]);
    const classIds = myClasses.map((c) => c.id);
    const myStudents = classIds.length
      ? await db.student.findMany({
          where: { schoolId: user.schoolId, status: "ACTIVE", classId: { in: classIds } },
          orderBy: [{ class: { name: "asc" } }, { name: "asc" }],
          select: { id: true, name: true, admissionNo: true, class: { select: { name: true } } },
        })
      : [];

    return ok({
      role: "TEACHER" as const,
      month: {
        total: monthAgg._sum.amount ?? 0,
        count: monthAgg._count,
        pending: pendingCount,
      },
      myStudents: myStudents.map((s) => ({ id: s.id, name: s.name, admissionNo: s.admissionNo, className: s.class.name })),
      payments: payments.map((p) => ({
        id: p.id, receiptNo: p.receiptNo, amount: p.amount, mode: p.mode, status: p.status,
        note: p.note, paidOn: p.paidOn, verifiedAt: p.verifiedAt,
        studentName: p.student.name, className: p.student.class.name,
      })),
    });
  }

  throw fail(403, "Fee collections are recorded by teachers and the principal.");
});

export const POST = route(async (req: Request) => {
  const user = await requireRole("TEACHER", "PRINCIPAL");
  const body = postSchema.parse(await req.json().catch(() => ({})));

  const student = await db.student.findUnique({
    where: { id: body.studentId },
    include: { class: { select: { id: true, name: true } } },
  });
  if (!student || student.schoolId !== user.schoolId) throw fail(404, "Student not found in this school.");

  if (user.role === "TEACHER") {
    if (!user.teacherId) throw fail(400, "No teacher profile is linked to this account.");
    const teaches = await db.classSubject.findFirst({
      where: { classId: student.class.id, teacherId: user.teacherId },
      select: { id: true },
    });
    const isClassTeacher = await db.class.findFirst({
      where: { id: student.class.id, classTeacherId: user.teacherId },
      select: { id: true },
    });
    if (!teaches && !isClassTeacher) {
      throw fail(403, `You can only collect fees for students of classes you teach — ${student.name} is in ${student.class.name}.`);
    }
  }

  const receiptNo = await nextReceiptNo(user.schoolId);
  const dues = await db.feeAssessment.findMany({
    where: { studentId: student.id, status: "DUE" },
    orderBy: [{ dueOn: "asc" }, { id: "asc" }],
    select: { id: true, amount: true, concession: true },
  });
  const allocated = allocateForPayment(dues, body.amount);

  const byPrincipal = user.role === "PRINCIPAL";
  const payment = await db.$transaction(async (tx) => {
    const created = await tx.payment.create({
      data: {
        schoolId: user.schoolId, studentId: student.id, amount: body.amount, mode: body.mode,
        receiptNo,
        collectedById: byPrincipal ? null : user.teacherId,
        verifiedById: byPrincipal ? user.id : null,
        verifiedAt: byPrincipal ? new Date() : null,
        status: byPrincipal ? "SUCCESS" : "UNDER_VERIFICATION",
        note: body.note ?? null,
      },
    });
    if (allocated.length) {
      await tx.feeAssessment.updateMany({ where: { id: { in: allocated } }, data: { status: "PAID" } });
    }
    await tx.activityLog.create({
      data: {
        schoolId: user.schoolId, actorName: user.name, actorRole: user.role,
        action: "Fee collected",
        detail: `₹${body.amount.toLocaleString("en-IN")} collected via ${body.mode.replace("_", " ").toLowerCase()} — ${student.name}, ${student.class.name}${byPrincipal ? "" : " (awaiting principal verification)"}`,
      },
    });
    return created;
  });

  return ok({
    receiptNo: payment.receiptNo,
    status: payment.status,
    allocated: allocated.length,
    studentName: student.name,
    className: student.class.name,
  });
});
