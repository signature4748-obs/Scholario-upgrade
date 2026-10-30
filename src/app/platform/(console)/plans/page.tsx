'use client'

// PAYMENTS & GATEWAYS REDESIGN — thin route wrapper; the module
// component owns the surface (console convention).
import { PlansModule } from '@/components/platform/modules/plans'

export default function Page() {
  return <PlansModule />
}
