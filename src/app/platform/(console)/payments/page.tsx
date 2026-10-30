'use client'

// PAYMENTS & GATEWAYS REDESIGN — thin route wrapper; the module
// component owns the surface (console convention).
import { PaymentsGatewaysModule } from '@/components/platform/modules/payments'

export default function Page() {
  return <PaymentsGatewaysModule />
}
