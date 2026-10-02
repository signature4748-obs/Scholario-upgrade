'use client'

/**
 * PrincipalDashboard — composition root.
 *
 * Redesigned (DASH-1) to match the Academics (Examinations + Attendance)
 * visual language:
 *   - PageTransition wrapper with `space-y-4` (matches every other module)
 *   - 4 SummaryCards (was 8) wired to navigation
 *   - Compact "Principal Attention" panel (was a giant red Live Alerts container)
 *   - 2 charts in flat Panels (was boxed ChartCards)
 *   - Flat Quick Actions + Notice Board (was 6 colorful gradient tiles)
 *   - shadcn Table + shared Avatar for Recent Admissions (was a plain HTML table)
 *   - 2-card events row (was 3 — dropped the duplicate Top Performers card)
 *
 * `onNavigate(moduleKey)` is passed down so every clickable element on the
 * dashboard can route the user to the relevant module. The prop is wired
 * in `principal-panel.tsx` from its `setActive` state.
 */

import { PageTransition } from '@/components/shared/ui'
import { WelcomeBanner } from './shared'
import { SetupGuide } from './setup-guide'
import { KpiRow } from './kpi-row'
import { LiveAlerts } from './live-alerts'
import { ChartsRow1 } from './charts-row'
import { LiveActivityTicker } from './live-activity-ticker'
import { QuickActionsRow } from './quick-actions'
import { RecentAdmissions } from './recent-admissions'
import { EventsRow } from './events-row'

export interface PrincipalDashboardProps {
  /** Navigate to a different module by key (e.g. 'fees', 'exams'). */
  onNavigate?: (module: string) => void
}

export function PrincipalDashboard({ onNavigate }: PrincipalDashboardProps) {
  const handleNavigate = onNavigate ?? (() => {})

  return (
    <PageTransition className="space-y-4">
      <WelcomeBanner onNavigate={handleNavigate} />
      {/* PHASE 8C-F — guided setup (§12): appears only while required
          setup is incomplete; self-removes when the school is built. */}
      <SetupGuide onNavigate={handleNavigate} />
      <KpiRow onNavigate={handleNavigate} />
      <LiveAlerts onNavigate={handleNavigate} />
      <ChartsRow1 onNavigate={handleNavigate} />
      <LiveActivityTicker />
      <QuickActionsRow onNavigate={handleNavigate} />
      <RecentAdmissions onNavigate={handleNavigate} />
      <EventsRow onNavigate={handleNavigate} />
    </PageTransition>
  )
}

export const DashboardModule = PrincipalDashboard
export default PrincipalDashboard
