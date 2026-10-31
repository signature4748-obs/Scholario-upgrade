import { redirect } from 'next/navigation'

/**
 * Phase 1 (Super Admin Control Center) — stable route handle for the
 * Overview dashboard: /platform/schools/[id]/overview.
 *
 * Overview is the workspace's default destination (no ?tab= value);
 * this route simply normalizes the explicit handle onto it.
 */
export default async function SchoolOverviewRoute({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  redirect(`/platform/schools/${encodeURIComponent(id)}`)
}
