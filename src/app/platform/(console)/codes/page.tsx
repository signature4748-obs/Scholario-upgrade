'use client'

// PAYMENTS & GATEWAYS REDESIGN — thin route wrapper; the module
// component owns the surface (console convention).
import { AccessCodesModule } from '@/components/platform/modules/codes'

export default function Page() {
  return <AccessCodesModule />
}
