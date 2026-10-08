'use client'

import { useState } from 'react'
import { Info } from 'lucide-react'
import { useAdmissionStore } from '@/lib/store/admission-store'
import { useAdmissionFeatureFlags } from '../lib/admission-utils'
import { DashboardHeader } from './dashboard/DashboardHeader'
import { KpiStrip } from './dashboard/KpiStrip'
import { StatusTabs } from './dashboard/StatusTabs'
import { FilterBar } from './dashboard/FilterBar'
import { ApplicationsTable } from './dashboard/ApplicationsTable'
import {
  type AdmissionsDashboardProps,
  type ActiveTab,
  computeStatusCounts,
  filterApplications,
} from './dashboard/types'

/**
 * PHASE 7-H (admissions honesty) — module status banner. One glance
 * tells the principal exactly what is live and what is not:
 *   · inquiry capture is live (server-recorded, listed on the home
 *     dashboard),
 *   · application processing (this workspace: forms, verification,
 *     issuance) is local browser state until server-backed processing
 *     ships — nothing here claims server persistence,
 *   · enrollment is REAL: completing an admission creates the student
 *     record on the school server (POST /api/students).
 * Non-intrusive by design: a single slim info bar above the header.
 */
function HonestyBanner() {
  return (
    <div
      role="note"
      className="flex items-start gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/[0.06] px-3.5 py-2.5"
    >
      <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
      <p className="text-[11px] leading-relaxed text-amber-800 dark:text-amber-300">
        <span className="font-semibold">Inquiry capture is live</span> — public website inquiries are
        recorded on the server (home dashboard → Recent inquiries).{' '}
        <span className="font-semibold">Application processing here is workspace state in this
        browser</span> — server-backed processing is coming soon; documents are collected on paper
        (digital uploads coming soon).{' '}
        <span className="font-semibold">Enrollment is real</span> — “Complete Admission &amp; Enroll”
        creates the student record on the school server with a one-time password.
      </p>
    </div>
  )
}

export function AdmissionsDashboard({
  onOpenWizard,
  onOpenVerificationWorkspace,
  onOpenIssuanceWorkspace,
  onOpenSettingsModal,
  onOpenOcrModal,
  onOpenBlankFormModal: _onOpenBlankFormModal,
}: AdmissionsDashboardProps) {
  const store = useAdmissionStore()
  const applications = store.applications || []
  // Subscribe to admission feature flags for reactivity (kept for parity with original).
  useAdmissionFeatureFlags()

  const [activeTab, setActiveTab] = useState<ActiveTab>('All')
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedClass, setSelectedClass] = useState<string>('All')
  const [selectedSession, setSelectedSession] = useState<string>('All')
  const [selectedAdmissionType, setSelectedAdmissionType] = useState<string>('All')

  const { inReview, needCorrection, approved, enrolled, statusCounts } = computeStatusCounts(applications)

  const filteredApps = filterApplications(applications, {
    activeTab,
    searchQuery,
    selectedClass,
    selectedSession,
    selectedAdmissionType,
  })

  return (
    <div className="space-y-5">
      <HonestyBanner />

      <DashboardHeader
        total={applications.length}
        inReview={inReview}
        approved={approved}
        onOpenSettingsModal={onOpenSettingsModal}
        onOpenOcrModal={onOpenOcrModal}
        onOpenWizard={() => onOpenWizard()}
      />

      <KpiStrip
        inReview={inReview}
        needCorrection={needCorrection}
        approved={approved}
        enrolled={enrolled}
      />

      <StatusTabs
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        statusCounts={statusCounts}
      />

      <FilterBar
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        selectedClass={selectedClass}
        setSelectedClass={setSelectedClass}
        selectedSession={selectedSession}
        setSelectedSession={setSelectedSession}
        selectedAdmissionType={selectedAdmissionType}
        setSelectedAdmissionType={setSelectedAdmissionType}
      />

      <ApplicationsTable
        filteredApps={filteredApps}
        store={store}
        onOpenWizard={onOpenWizard}
        onOpenVerificationWorkspace={onOpenVerificationWorkspace}
        onOpenIssuanceWorkspace={onOpenIssuanceWorkspace}
        setActiveTab={setActiveTab}
        setSearchQuery={setSearchQuery}
        setSelectedClass={setSelectedClass}
      />
    </div>
  )
}
