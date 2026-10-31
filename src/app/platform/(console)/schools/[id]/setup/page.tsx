import { redirect } from 'next/navigation'

/**
 * Phase 1 (Super Admin Control Center) — stable route handle for the
 * guided Setup experience: /platform/schools/[id]/setup.
 *
 * The workspace itself is a single ?tab=-driven surface
 * (schools/[id]/page.tsx); this route 307s to its canonical Setup
 * destination so deep links built on the new Overview | Setup |
 * Manage information architecture already resolve. When a later phase
 * promotes Setup to its own route tree, only this handle changes.
 */
export default async function SchoolSetupRoute({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  redirect(`/platform/schools/${encodeURIComponent(id)}?tab=setup`)
}
