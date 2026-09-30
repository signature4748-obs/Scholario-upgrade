import { Edit3, RefreshCw, Search, Sparkles, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import { type AdmissionStoreState, type AdmissionApplication } from '@/lib/store/admission-store'
import { StatusBadge } from './StatusBadge'

interface ApplicationRowProps {
  app: AdmissionApplication
  store: AdmissionStoreState
  onOpenWizard: (appId?: string) => void
  onOpenVerificationWorkspace: (appId: string) => void
  onOpenIssuanceWorkspace: (appId: string) => void
}

export function ApplicationRow({
  app,
  store,
  onOpenWizard,
  onOpenVerificationWorkspace,
  onOpenIssuanceWorkspace,
}: ApplicationRowProps) {
  const flaggedCount = Object.values(app.sectionReviews || {}).filter(
    (s) => s.status === 'Needs Review' || s.status === 'Incomplete'
  ).length

  return (
    <div key={app.id} className="grid grid-cols-12 gap-3 p-3 items-center hover:bg-muted/20 transition-colors text-xs min-w-[760px]">
      {/* Applicant */}
      <div className="col-span-3 space-y-0.5">
        <div className="flex items-center gap-2">
          <span className="font-bold text-sm text-foreground">{app.applicantName}</span>
          {flaggedCount > 0 && app.status === 'Need Correction' && (
            <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-300 text-[9px] px-1.5 py-0 font-bold">
              {flaggedCount} flagged
            </Badge>
          )}
        </div>
        <span className="text-[11px] font-mono text-muted-foreground">{app.admissionNo}</span>
      </div>

      {/* Class */}
      <div className="col-span-2">
        <span className="font-semibold text-foreground block">{app.className} — {app.section}</span>
        <span className="text-[11px] text-muted-foreground font-mono">{app.academicSession}</span>
      </div>

      {/* Parent */}
      <div className="col-span-2 space-y-0.5">
        <span className="font-medium text-foreground block truncate">{app.formData.fatherName || app.formData.motherName}</span>
        <span className="text-[11px] text-muted-foreground font-mono">{app.formData.fatherPhone || app.formData.motherPhone}</span>
      </div>

      {/* Status */}
      <div className="col-span-2 space-y-1">
        <StatusBadge status={app.status} />
        {app.status === 'Rejected' && (
          <span className="text-[9px] text-rose-600 dark:text-rose-400 block">
            {app.rejectionRetentionDays || 60}d retention
          </span>
        )}
        {app.status === 'Completed' && app.admissionNo && !app.admissionNo.startsWith('DRAFT-') && (
          <span className="text-[9px] text-teal-600 dark:text-teal-400 block font-mono">
            {app.admissionNo}
          </span>
        )}
      </div>

      {/* Actions */}
      <div className="col-span-3 flex items-center justify-end gap-2">
        {app.status === 'Draft' && (
          <>
            <Button size="sm" variant="outline" onClick={() => { store.selectApplication(app.id); onOpenWizard(app.id) }} className="text-xs h-8">
              <Edit3 className="h-3.5 w-3.5 mr-1" /> Resume
            </Button>
            <Button size="sm" onClick={() => { store.submitApplication(app.id); toast.success('Application submitted') }} className="text-xs h-8 bg-primary text-primary-foreground">
              Submit
            </Button>
          </>
        )}

        {(app.status === 'Submitted' || app.status === 'Under Review' || app.status === 'Need Correction') && (
          <Button size="sm" onClick={() => { store.selectApplication(app.id); onOpenVerificationWorkspace(app.id) }} className="text-xs h-8 bg-teal-600 hover:bg-teal-700 text-white font-semibold gap-1">
            <Search className="h-3.5 w-3.5" /> Review
          </Button>
        )}

        {app.status === 'Approved' && (
          <Button size="sm" onClick={() => { store.selectApplication(app.id); onOpenIssuanceWorkspace(app.id) }} className="text-xs h-8 bg-emerald-600 hover:bg-emerald-700 text-white font-bold gap-1">
            <Sparkles className="h-3.5 w-3.5" /> Issue Admission
          </Button>
        )}

        {app.status === 'Rejected' && (
          <div className="flex items-center gap-1">
            <Button size="sm" variant="outline" onClick={() => { store.restoreRejectedApplication(app.id); toast.success('Application restored') }} className="text-xs h-8 text-teal-600 border-teal-300">
              <RefreshCw className="h-3.5 w-3.5 mr-1" /> Restore
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { store.deleteArchivedApplication(app.id); toast.success('Record deleted') }} className="text-xs h-8 text-rose-600 hover:bg-rose-50">
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}

        {app.status === 'Completed' && (
          <Button size="sm" variant="outline" onClick={() => { store.selectApplication(app.id); onOpenIssuanceWorkspace(app.id) }} className="text-xs h-8 border-teal-300 text-teal-800 dark:text-teal-300">
            View Admission
          </Button>
        )}
      </div>
    </div>
  )
}
