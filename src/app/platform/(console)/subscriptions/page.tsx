'use client'

// SUBSCRIPTION & ENTITLEMENT SYSTEM — thin route wrapper; the module
// component owns the surface (console convention).
import { SubscriptionsModule } from '@/components/platform/modules/subscriptions'

export default function Page() {
  return <SubscriptionsModule />
}
