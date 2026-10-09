import { z } from "zod";
import { db } from "@/lib/db";
import { requireRole, ok, fail, route } from "@/lib/api";

const patchSchema = z.object({
  name: z.string().trim().min(3).max(140).optional(),
  shortName: z.string().trim().max(30).nullable().optional(),
  tagline: z.string().trim().max(120).nullable().optional(),
  address: z.string().trim().max(200).nullable().optional(),
  city: z.string().trim().max(80).nullable().optional(),
  phone: z.string().trim().max(20).nullable().optional(),
  email: z.string().trim().email().max(120).nullable().optional(),
  principalName: z.string().trim().max(80).nullable().optional(),
  established: z.string().trim().max(10).nullable().optional(),
  academicYear: z.string().trim().min(4).max(12).optional(),
});

export const GET = route(async () => {
  const user = await requireRole("PRINCIPAL");
  const school = await db.school.findUnique({
    where: { id: user.schoolId },
    select: {
      id: true, name: true, slug: true, code: true, shortName: true, tagline: true,
      address: true, city: true, phone: true, email: true, board: true,
      principalName: true, established: true, academicYear: true, isDemo: true, plan: true, status: true,
    },
  });
  if (!school) throw fail(404, "School not found.");
  return ok(school);
});

export const PATCH = route(async (req: Request) => {
  const user = await requireRole("PRINCIPAL");
  const parsed = patchSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) throw fail(400, parsed.error.issues[0]?.message ?? "Check the school profile details.");
  const body = parsed.data;

  const changes = Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined));
  if (!Object.keys(changes).length) throw fail(400, "Nothing to update.");

  const school = await db.$transaction(async (tx) => {
    const updated = await tx.school.update({ where: { id: user.schoolId }, data: changes });
    await tx.activityLog.create({
      data: {
        schoolId: user.schoolId, actorName: user.name, actorRole: user.role,
        action: "Settings",
        detail: `School profile updated by ${user.name}`,
      },
    });
    return updated;
  });

  return ok({
    name: school.name, shortName: school.shortName, tagline: school.tagline,
    address: school.address, city: school.city, phone: school.phone, email: school.email,
    principalName: school.principalName, established: school.established, academicYear: school.academicYear,
  });
});
