'use client'

import { useState } from 'react'
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
