import { getSessionUser } from "@/lib/auth";
import { ok, route } from "@/lib/api";

export const GET = route(async () => {
  const user = await getSessionUser();
  if (!user) return ok({ user: null });
  return ok({ user });
});
