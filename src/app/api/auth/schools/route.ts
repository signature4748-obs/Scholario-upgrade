import { db } from "@/lib/db";
import { ok, route } from "@/lib/api";

/** Public login-door list — no credentials, no tenant internals. */
export const GET = route(async () => {
  const schools = await db.school.findMany({
    where: { status: "ACTIVE" },
    select: {
      slug: true, name: true, code: true, shortName: true, tagline: true,
      city: true, established: true, board: true, isDemo: true, academicYear: true,
    },
    orderBy: { isDemo: "desc" },
  });
  return ok({ schools });
});
