'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { useAdmissionStore } from '@/lib/store/admission-store'
import { resetRosterSyncGuard, syncStudentsFromServer } from '@/lib/store/students-store'
import { toast } from 'sonner'

import { buildIssuanceArtifacts } from './issuance/letter-data'
import { IssuanceHeader } from './issuance/IssuanceHeader'
import { IdentifiersMatrix } from './issuance/IdentifiersMatrix'
import { IssuanceTabs, type IssuanceTabKey } from './issuance/IssuanceTabs'
import { LetterTab } from './issuance/LetterTab'
import { FeeReceiptTab } from './issuance/FeeReceiptTab'
import { CredentialsTab } from './issuance/CredentialsTab'
import { WelcomeLetterTab } from './issuance/WelcomeLetterTab'
import { DispatchesTab } from './issuance/DispatchesTab'
import { EnrollStudentDialog } from './issuance/EnrollStudentDialog'

interface IssuanceWorkspaceProps {
  appId: string
  onBack: () => void
  onCompleted: () => void
}

export function IssuanceWorkspace({
  appId,
  onBack,
  onCompleted,
}: IssuanceWorkspaceProps) {
  const store = useAdmissionStore()
  const app = store.applications.find((a) => a.id === appId)

  const [activeTab, setActiveTab] = useState<IssuanceTabKey>('letter')
  // PHASE 7-H — real enrollment: "Complete & Enrol" opens the enroll
  // dialog (POST /api/students). The workspace only leaves the issuance
  // view after the SERVER has confirmed the enrollment.
  const [enrollOpen, setEnrollOpen] = useState(false)
  const [enrolled, setEnrolled] = useState(false)

  if (!app) {
    return (
      <div className="p-8 text-center space-y-4">
        <p className="text-sm text-muted-foreground">Application record not found.</p>
        <Button onClick={onBack}>Back to Dashboard</Button>
      </div>
    )
  }

  const formData = app.formData
  const isCompleted = app.status === 'Completed'
  const artifacts = buildIssuanceArtifacts(app)

  const handleCompleteAndEnroll = () => {
    setEnrolled(false)
    setEnrollOpen(true)
  }

  // Fired ONCE by the dialog, only after the server confirms the create.
  // The local record is marked Completed WITH the server student id +
  // admission number, and the roster re-syncs from the server (the fake
  // localStorage roster insertion is gone).
  const handleEnrolled = ({
    studentId,
    admissionNo,
  }: {
    studentId: string
    admissionNo: string
  }) => {
    setEnrolled(true)
    store.completeAdmission(app.id, {
      studentId,
      admissionNo,
      rollNo: artifacts.rollNo,
      regNo: artifacts.regNo,
    })

    resetRosterSyncGuard()
    void syncStudentsFromServer().then((ok) => {
      if (!ok) {
        toast.error('Roster could not be refreshed', {
          description:
            'The student was enrolled on the server — reload the page to see the updated roster.',
        })
      }
    })
  }

  const handleEnrollDialogClose = (open: boolean) => {
    setEnrollOpen(open)
    // Leaving the dialog after a successful enrollment returns to the
    // applications dashboard (the record now shows as Enrolled there).
    if (!open && enrolled) {
      setEnrolled(false)
      onCompleted()
    }
  }

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <IssuanceHeader
        app={app}
        isCompleted={isCompleted}
        onBack={onBack}
        onCompleteAndEnroll={handleCompleteAndEnroll}
      />

      {/* Identifiers Card Matrix */}
      <IdentifiersMatrix app={app} artifacts={artifacts} />

      {/* Tabs Navigation for Issuance Artifacts */}
      <IssuanceTabs activeTab={activeTab} onTabChange={setActiveTab} />

      {/* Tab 1: Embedded Official Admission Letter */}
      {activeTab === 'letter' && (
        <LetterTab artifacts={artifacts} onBack={onBack} />
      )}

      {/* Tab 2: Fee Receipt */}
      {activeTab === 'receipt' && (
        <FeeReceiptTab app={app} artifacts={artifacts} />
      )}

      {/* Tab 3: Credentials */}
      {activeTab === 'credentials' && (
        <CredentialsTab
          artifacts={artifacts}
          guardianEmail={formData.fatherEmail || formData.motherEmail || null}
        />
      )}

      {/* Tab 4: Welcome Letter */}
      {activeTab === 'welcome' && (
        <WelcomeLetterTab app={app} />
      )}

      {/* Tab 5: Multi-channel Dispatches */}
      {activeTab === 'dispatches' && (
        <DispatchesTab app={app} />
      )}

      {/* REAL server enrollment (POST /api/students) — replaces the fake
          local roster insertion that used to run on "Complete & Enrol". */}
      <EnrollStudentDialog
        open={enrollOpen}
        onOpenChange={handleEnrollDialogClose}
        app={app}
        onEnrolled={handleEnrolled}
      />
    </div>
  )
}
