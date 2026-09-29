import { db } from '@/lib/db'
import { withAuthz } from '@/lib/security/authz'

export const runtime = 'nodejs'

/// GET /api/transport — vehicles, routes and drivers for the school.
///
/// 3-c fix: gated to 'school.transport.read' (PRINCIPAL / MANAGEMENT).
/// Before, ANY authenticated role could read the transport register,
/// including DRIVER email + phone PII. (Client-grep: the principal
/// Transport module renders client-store data with no fetch; the STUDENT
/// bus-tracking module reads @/lib/mock/bus-tracking, NOT this route — so
/// no student/parent surface consumes it and the slim-projection
/// alternative was unnecessary; the full P/M gate breaks no legit flow.)
export async function GET() {
  return withAuthz({ permission: 'school.transport.read' }, async (ctx) => {
    const schoolId = ctx.schoolId
    const [vehicles, routes, drivers] = await Promise.all([
      db.vehicle.findMany({
        where: { schoolId },
        include: { driver: { include: { user: { select: { name: true, phone: true } } } }, route: true },
        orderBy: { number: 'asc' },
      }),
      db.route.findMany({
        where: { schoolId },
        include: { _count: { select: { students: true } } },
        orderBy: { name: 'asc' },
      }),
      db.driver.findMany({
        where: { schoolId },
        include: { user: { select: { name: true, email: true, phone: true } }, vehicles: true },
      }),
    ])
    return { vehicles, routes, drivers }
  })
}
