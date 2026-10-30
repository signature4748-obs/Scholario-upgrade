'use client'

// PAYMENTS & GATEWAYS REDESIGN — thin route wrapper; the module
// component owns the surface (console convention).
import { useSearchParams } from 'next/navigation'
import { ReportsAuditModule } from '@/components/platform/modules/reports'

export default function Page() {
  const searchParams = useSearchParams()
  const tabParam = searchParams.get('tab')
  const initialTab = tabParam === 'reconcile' || tabParam === 'audit' ? tabParam : 'renewals'
  return <ReportsAuditModule initialTab={initialTab} />
}
