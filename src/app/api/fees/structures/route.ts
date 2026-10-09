import { z } from "zod";
import { db } from "@/lib/db";
import { requireRole, ok, fail, route } from "@/lib/api";

const patchSchema = z.object({
  id: z.string().min(1),
  amount: z.number().int().min(1).max(1000000),
});

const postSchema = z.object({
  classId: z.string().min(1),
  head: z.string().trim().min(2).max(60),
  amount: z.number().int().min(1).max(1000000),
  frequency: z.enum(["MONTHLY", "QUARTERLY", "ANNUAL", "ONE_TIME"]),
  mandatory: z.boolean().default(true),
});

export const PATCH = route(async (req: Request) => {
  const user = await requireRole("PRINCIPAL");
  const body = patchSchema.parse(await req.json().catch(() => ({})));

  const head = await db.feeStructure.findUnique({
    where: { id: body.id },
    include: { class: { select: { name: true, schoolId: true } } },
  });
  if (!head || head.class.schoolId !== user.schoolId) throw fail(404, "Fee head not found in this school.");
  if (head.amount === body.amount) return ok({ id: head.id, amount: head.amount, unchanged: true });

  const [updated] = await db.$transaction([
    db.feeStructure.update({ where: { id: head.id }, data: { amount: body.amount } }),
    db.activityLog.create({
      data: {
        schoolId: user.schoolId, actorName: user.name, actorRole: user.role,
        action: "Fee structure",
        detail: `${head.head} for ${head.class.name} revised from ₹${head.amount.toLocaleString("en-IN")} to ₹${body.amount.toLocaleString("en-IN")}`,
      },
    }),
  ]);

  return ok({ id: updated.id, head: updated.head, amount: updated.amount, className: head.class.name });
});

export const POST = route(async (req: Request) => {
  const user = await requireRole("PRINCIPAL");
  const body = postSchema.parse(await req.json().catch(() => ({})));

  const cls = await db.class.findUnique({ where: { id: body.classId } });
  if (!cls || cls.schoolId !== user.schoolId) throw fail(404, "Class not found in this school.");

  const clash = await db.feeStructure.findFirst({ where: { schoolId: user.schoolId, classId: cls.id, head: body.head } });
  if (clash) throw fail(409, `${body.head} already exists for ${cls.name}.`);

  const [created] = await db.$transaction([
    db.feeStructure.create({
      data: {
        schoolId: user.schoolId, classId: cls.id, head: body.head,
        amount: body.amount, frequency: body.frequency, mandatory: body.mandatory,
        sort: 90,
      },
    }),
    db.activityLog.create({
      data: {
        schoolId: user.schoolId, actorName: user.name, actorRole: user.role,
        action: "Fee structure",
        detail: `${body.head} (₹${body.amount.toLocaleString("en-IN")}, ${body.frequency.toLowerCase()}) added for ${cls.name}`,
      },
    }),
  ]);

  return ok({ id: created.id, head: created.head, amount: created.amount, className: cls.name });
});
