'use client'

// PAYMENTS & GATEWAYS REDESIGN — /platform/audit keeps working for
// existing deep links and muscle memory: it renders the Reports & Audit
// module with the audit tab active (the canonical route is
// /platform/reports?tab=audit; the sidebar no longer carries a separate
// "Audit Log" item).

import { useSearchParams } from 'next/navigation'
import { ReportsAuditModule } from '@/components/platform/modules/reports'

export default function Page() {
  const searchParams = useSearchParams()
  const tabParam = searchParams.get('tab')
  const initialTab = tabParam === 'reconcile' || tabParam === 'renewals' ? tabParam : 'audit'
  return <ReportsAuditModule initialTab={initialTab} />
}
