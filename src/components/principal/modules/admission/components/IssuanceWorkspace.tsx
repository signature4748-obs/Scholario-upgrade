'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { useAdmissionStore } from '@/lib/store/admission-store'
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
    const _newStudent = store.completeAdmission(app.id, {
      admissionNo: artifacts.admissionNo,
      studentId: artifacts.studentId,
      rollNo: artifacts.rollNo,
      regNo: artifacts.regNo,
    })

    toast.success(
      `Admission Issued! ${formData.firstName} ${formData.lastName} enrolled into ${formData.className} (${artifacts.rollNo}).`
    )
    onCompleted()
  }

  const handleCopyCredentials = () => {
    navigator.clipboard.writeText(`Portal URL: https://portal.scholario.app\nLogin ID: ${artifacts.loginId}\nTemp Password: ${artifacts.tempPassword}`)
    toast.success('Credentials copied to clipboard!')
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
        <CredentialsTab artifacts={artifacts} onCopy={handleCopyCredentials} />
      )}

      {/* Tab 4: Welcome Letter */}
      {activeTab === 'welcome' && (
        <WelcomeLetterTab app={app} />
      )}

      {/* Tab 5: Multi-channel Dispatches */}
      {activeTab === 'dispatches' && (
        <DispatchesTab app={app} />
      )}
    </div>
  )
}
