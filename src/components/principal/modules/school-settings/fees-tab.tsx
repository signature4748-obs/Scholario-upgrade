'use client'

// Fees Structure tab — manages fee heads/templates. Owns the local state for
// the "Add Fee Head" dialog and wires the create handler to store.addFeeHead.
//
// PHASE 7.5: honest-scope banner added — the FEE CATALOGUE used for actual
// billing lives in Fee Management → Catalogue (DB MasterFeeHead rows via
// /api/fees/catalogue); this editor is the school's local template list.

import { useState } from 'react'
import { IndianRupee, Plus, Info } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { useSchoolSettingsStore } from '@/lib/store/school-settings-store'
import { toast } from 'sonner'
import { SettingsTab } from './shared'

const DEFAULT_FEE_HEAD = {
  name: '',
  type: 'Tuition' as const,
  defaultAmount: 2000,
  frequency: 'Monthly' as const,
}

export function FeesTab() {
  const store = useSchoolSettingsStore()
  const [addFeeHeadOpen, setAddFeeHeadOpen] = useState(false)
  const [newFeeHead, setNewFeeHead] = useState({ ...DEFAULT_FEE_HEAD })

  const handleCreateFeeHead = () => {
    if (!newFeeHead.name.trim()) {
      toast.error('Please enter fee head name.')
      return
    }
    store.addFeeHead({
      name: newFeeHead.name,
      type: newFeeHead.type,
      defaultAmount: Number(newFeeHead.defaultAmount) || 0,
      frequency: newFeeHead.frequency,
    })
    toast.success(`Fee Head "${newFeeHead.name}" added to master fee structure!`)
    setAddFeeHeadOpen(false)
    setNewFeeHead({ ...DEFAULT_FEE_HEAD })
  }

  return (
    <>
      <SettingsTab
        icon={IndianRupee}
        title="Fee Heads & Templates"
        description="Manage fee categories, concessions, and installment deadlines."
        action={
          <Button size="sm" onClick={() => setAddFeeHeadOpen(true)} className="gap-1 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold">
            <Plus className="h-3.5 w-3.5" /> Add Fee Head
          </Button>
        }
      >
        <div
          role="note"
          className="flex items-start gap-2.5 rounded-xl border border-sky-500/25 bg-sky-500/[0.05] px-3 py-2.5 text-[11px] leading-relaxed text-sky-700 dark:text-sky-300"
        >
          <Info className="h-3.5 w-3.5 shrink-0 mt-px" aria-hidden />
          <span className="min-w-0 flex-1">
            The fee catalogue used for billing lives in <strong>Fee Management → Catalogue</strong>.
            This editor maintains the school&apos;s local template list only.
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
          {store.fees.feeHeads.map((fh) => (
            <div key={fh.id} className="p-3.5 rounded-xl border border-border bg-card space-y-1.5 shadow-2xs">
              <div className="flex items-center justify-between">
                <p className="font-bold text-foreground text-xs">{fh.name}</p>
                <Badge variant="secondary" className="text-[10px] bg-emerald-50 text-emerald-700 border-emerald-200">
                  ₹{fh.defaultAmount} · {fh.frequency}
                </Badge>
              </div>
              <p className="text-[11px] text-muted-foreground">Type: {fh.type}</p>
            </div>
          ))}
        </div>
      </SettingsTab>

      {/* DIALOG: ADD FEE HEAD */}
      <Dialog open={addFeeHeadOpen} onOpenChange={setAddFeeHeadOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base font-bold">
              <IndianRupee className="h-5 w-5 text-emerald-600" /> Add Fee Head
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3 py-2 text-xs">
            <div>
              <Label className="text-xs font-semibold mb-1 block">Fee Head Name</Label>
              <Input
                value={newFeeHead.name}
                onChange={(e) => setNewFeeHead({ ...newFeeHead, name: e.target.value })}
                placeholder="Smart Class & Digital Content Fee"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs font-semibold mb-1 block">Default Amount (₹)</Label>
                <Input
                  type="number"
                  value={newFeeHead.defaultAmount}
                  onChange={(e) => setNewFeeHead({ ...newFeeHead, defaultAmount: Number(e.target.value) })}
                />
              </div>
              <div>
                <Label className="text-xs font-semibold mb-1 block">Frequency</Label>
                <Select
                  value={newFeeHead.frequency}
                  onValueChange={(val: any) => setNewFeeHead({ ...newFeeHead, frequency: val })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Monthly">Monthly</SelectItem>
                    <SelectItem value="Quarterly">Quarterly</SelectItem>
                    <SelectItem value="Term">Term</SelectItem>
                    <SelectItem value="Annual">Annual</SelectItem>
                    <SelectItem value="One-Time">One-Time</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setAddFeeHeadOpen(false)}>Cancel</Button>
            <Button onClick={handleCreateFeeHead} className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold">
              Save Fee Head
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
