import { z } from "zod";
import { db } from "@/lib/db";
import { requireRole, requireSession, ok, fail, route } from "@/lib/api";

const AUDIENCES = ["ALL", "TEACHERS", "STUDENTS"] as const;

const postSchema = z.object({
  title: z.string().trim().min(3).max(140),
  body: z.string().trim().min(3).max(4000),
  audience: z.enum(AUDIENCES),
  pinned: z.boolean().default(false),
});

const patchSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().trim().min(3).max(140).optional(),
    body: z.string().trim().min(3).max(4000).optional(),
    audience: z.enum(AUDIENCES).optional(),
    pinned: z.boolean().optional(),
  })
  .refine((x) => x.title !== undefined || x.body !== undefined || x.audience !== undefined || x.pinned !== undefined, {
    message: "Nothing to update.",
  });

async function withPosters(rows: { id: string; title: string; body: string; audience: string; pinned: boolean; postedById: string | null; publishedAt: Date }[]) {
  const ids = [...new Set(rows.map((r) => r.postedById).filter((x): x is string => !!x))];
  const users = ids.length ? await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : [];
  const nameById = new Map(users.map((u) => [u.id, u.name]));
  return rows.map((r) => ({ ...r, postedBy: r.postedById ? nameById.get(r.postedById) ?? null : null }));
}

export const GET = route(async () => {
  const user = await requireSession();
  const audiences = user.role === "PRINCIPAL" ? ["ALL", "TEACHERS", "STUDENTS"] : user.role === "TEACHER" ? ["ALL", "TEACHERS"] : ["ALL", "STUDENTS"];

  const notices = await db.notice.findMany({
    where: { schoolId: user.schoolId, audience: { in: audiences } },
    orderBy: [{ pinned: "desc" }, { publishedAt: "desc" }],
  });

  return ok({ role: user.role, notices: await withPosters(notices) });
});

export const POST = route(async (req: Request) => {
  const user = await requireRole("PRINCIPAL");
  const parsed = postSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) throw fail(400, parsed.error.issues[0]?.message ?? "Check the notice details.");
  const body = parsed.data;

  const notice = await db.$transaction(async (tx) => {
    const created = await tx.notice.create({
      data: {
        schoolId: user.schoolId, title: body.title, body: body.body,
        audience: body.audience, pinned: body.pinned, postedById: user.id,
      },
    });
    await tx.activityLog.create({
      data: {
        schoolId: user.schoolId, actorName: user.name, actorRole: user.role,
        action: "Notice",
        detail: `Notice published — ${body.title}`,
      },
    });
    return created;
  });

  return ok(notice);
});

export const PATCH = route(async (req: Request) => {
  const user = await requireRole("PRINCIPAL");
  const parsed = patchSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) throw fail(400, parsed.error.issues[0]?.message ?? "Check the notice details.");
  const body = parsed.data;

  const notice = await db.notice.findUnique({ where: { id: body.id } });
  if (!notice || notice.schoolId !== user.schoolId) throw fail(404, "Notice not found in this school.");

  const updated = await db.notice.update({
    where: { id: notice.id },
    data: {
      ...(body.title !== undefined ? { title: body.title } : {}),
      ...(body.body !== undefined ? { body: body.body } : {}),
      ...(body.audience !== undefined ? { audience: body.audience } : {}),
      ...(body.pinned !== undefined ? { pinned: body.pinned } : {}),
    },
  });
  return ok(updated);
});

export const DELETE = route(async (req: Request) => {
  const user = await requireRole("PRINCIPAL");
  const id = new URL(req.url).searchParams.get("id");
  if (!id) throw fail(400, "Which notice should be deleted?");

  const notice = await db.notice.findUnique({ where: { id } });
  if (!notice || notice.schoolId !== user.schoolId) throw fail(404, "Notice not found in this school.");

  await db.$transaction([
    db.notice.delete({ where: { id: notice.id } }),
    db.activityLog.create({
      data: {
        schoolId: user.schoolId, actorName: user.name, actorRole: user.role,
        action: "Notice",
        detail: `Notice deleted — ${notice.title}`,
      },
    }),
  ]);

  return ok({ id: notice.id });
});
