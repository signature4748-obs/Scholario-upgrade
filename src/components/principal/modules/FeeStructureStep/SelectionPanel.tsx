import {
  BookOpen, Tag, ShieldCheck, FileText,
  Bus, Home, Palette, Shirt,
} from 'lucide-react'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select'
import { formatINR } from '@/lib/format'
import type { SchoolSettings } from '@/lib/school-settings'
import type { AdmissionFeatureFlags } from '@/lib/store/school-settings-store'
import type { UniformItem } from '@/lib/store/school-settings-store'
import { ACTIVITY_KIT_ITEMS } from './constants'
import { CartRow, ExamToggle, FeeHeadRow, FlatToggle } from './primitives'
import type { FeeDataState, SelectionCategory } from './types'

export interface SelectionPanelProps {
  feeState: FeeDataState
  onChangeFeeState: (next: FeeDataState) => void
  flags?: AdmissionFeatureFlags
  schoolSettings: SchoolSettings
  classBooks: Array<{ id: string; title: string; publisher: string; category: string; price: number; isMandatory: boolean; className: string }>
  uniforms: UniformItem[]
  examConfig: { unitTestFee: number; termExamFee: number; customGroupsFee: number }
  examTotal: number
  booksTotal: number
  booksCount: number
  uniformTotal: number
  uniformCount: number
  activityKitTotal: number
  activityKitCount: number
  transportCost: number
  hostelCost: number
  registrationFee: number
  admissionFee: number
  tuitionFee: number
  otherHeadsTotal: number
  updateSelection: (cat: SelectionCategory, itemId: string, qty: number) => void
  toggleSelection: (cat: SelectionCategory, itemId: string) => void
  handleApplyWaiver: () => void
}

/** Left column: all the fee-selection sections (institutional, exam, books, uniform, activity kit, transport, concession). */
export function SelectionPanel(props: SelectionPanelProps) {
  const {
    feeState, onChangeFeeState, flags, schoolSettings,
    classBooks, uniforms, examConfig, examTotal: _examTotal,
    booksTotal, booksCount, uniformTotal, uniformCount,
    activityKitTotal, activityKitCount, transportCost, hostelCost,
    registrationFee, admissionFee, tuitionFee, otherHeadsTotal,
    updateSelection, toggleSelection, handleApplyWaiver,
  } = props

  // Financial feature flags (Admission Settings → Financial) actually gate
  // what the concession UI offers: scholarship rules and custom waivers are
  // only selectable while their toggle is ON.
  const availableDiscountRules = schoolSettings.discountRules.filter(
    (rule) => flags?.enableScholarship !== false || rule.category !== 'Scholarship'
  )
  const waiverEnabled = flags?.enableFeeWaiver !== false

  return (
    <div className="lg:col-span-2 space-y-5">
      {/* Section 1: Institutional Fee Heads (READ-ONLY) */}
      <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-bold uppercase tracking-wider text-primary flex items-center gap-1.5">
            <FileText className="h-3.5 w-3.5" /> Institutional Fee
          </h4>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
          <FeeHeadRow label="Registration" value={registrationFee} />
          <FeeHeadRow label="Admission (One-Time)" value={admissionFee} />
          <FeeHeadRow label={`Tuition (${formatINR(Math.round(tuitionFee / 12))}/mo)`} value={tuitionFee} />
          <FeeHeadRow label="Development & Tech" value={otherHeadsTotal} />
        </div>
      </div>

      {/* Section 2: Exam Groups */}
      <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
        <h4 className="text-xs font-bold uppercase tracking-wider text-primary">Examination & Assessment</h4>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <ExamToggle label="Unit Test × 4" amount={examConfig.unitTestFee} checked={feeState.examGroups.unitTest} onChange={(c) => onChangeFeeState({ ...feeState, examGroups: { ...feeState.examGroups, unitTest: !!c } })} />
          <ExamToggle label="Term Exam × 2" amount={examConfig.termExamFee} checked={feeState.examGroups.termExam} onChange={(c) => onChangeFeeState({ ...feeState, examGroups: { ...feeState.examGroups, termExam: !!c } })} />
          <ExamToggle label="Practical & Lab" amount={examConfig.customGroupsFee} checked={feeState.examGroups.customGroups} onChange={(c) => onChangeFeeState({ ...feeState, examGroups: { ...feeState.examGroups, customGroups: !!c } })} />
        </div>
      </div>

      {/* Section 3: Books — individual selection with quantity */}
      <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-bold uppercase tracking-wider text-primary flex items-center gap-1.5">
            <BookOpen className="h-3.5 w-3.5" /> Books
          </h4>
          {booksCount > 0 && <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/30 text-[10px]">{booksCount} selected · {formatINR(booksTotal, true)}</Badge>}
        </div>
        <div className="space-y-1.5">
          {classBooks.map((book) => {
            const qty = feeState.bookSelections[book.id] || 0
            const selected = qty > 0
            return (
              <CartRow
                key={book.id}
                title={book.title}
                subtitle={`${book.publisher} · ${book.category}`}
                price={book.price}
                qty={qty}
                selected={selected}
                onToggle={() => toggleSelection('bookSelections', book.id)}
                onQtyChange={(q) => updateSelection('bookSelections', book.id, q)}
              />
            )
          })}
        </div>
      </div>

      {/* Section 4: Uniform — individual selection with quantity */}
      {uniforms.length > 0 && (
        <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-bold uppercase tracking-wider text-primary flex items-center gap-1.5">
              <Shirt className="h-3.5 w-3.5" /> Uniform
            </h4>
            {uniformCount > 0 && <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/30 text-[10px]">{uniformCount} selected · {formatINR(uniformTotal, true)}</Badge>}
          </div>
          <div className="space-y-1.5">
            {uniforms.map((item) => {
              const qty = feeState.uniformSelections[item.id] || 0
              const selected = qty > 0
              return (
                <CartRow
                  key={item.id}
                  title={item.name}
                  subtitle={`${item.category} · Sizes: ${item.sizes.join(', ')}`}
                  price={item.price}
                  qty={qty}
                  selected={selected}
                  onToggle={() => toggleSelection('uniformSelections', item.id)}
                  onQtyChange={(q) => updateSelection('uniformSelections', item.id, q)}
                />
              )
            })}
          </div>
        </div>
      )}

      {/* Section 5: Activity Kit — individual selection */}
      <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-bold uppercase tracking-wider text-primary flex items-center gap-1.5">
            <Palette className="h-3.5 w-3.5" /> Activity Kit
          </h4>
          {activityKitCount > 0 && <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/30 text-[10px]">{activityKitCount} selected · {formatINR(activityKitTotal, true)}</Badge>}
        </div>
        <div className="space-y-1.5">
          {ACTIVITY_KIT_ITEMS.map((item) => {
            const qty = feeState.activityKitSelections[item.id] || 0
            const selected = qty > 0
            return (
              <CartRow
                key={item.id}
                title={item.name}
                subtitle="Optional"
                price={item.price}
                qty={qty}
                selected={selected}
                onToggle={() => toggleSelection('activityKitSelections', item.id)}
                onQtyChange={(q) => updateSelection('activityKitSelections', item.id, q)}
              />
            )
          })}
        </div>
      </div>

      {/* Section 6: Transport & Hostel (flat-fee toggles) */}
      {(flags?.enableTransport || flags?.enableHostel) && (
        <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
          <h4 className="text-xs font-bold uppercase tracking-wider text-primary">Transport & Hostel</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {flags?.enableTransport && (
              <FlatToggle icon={Bus} label="Transport" desc="Bus route & pickup" amount={transportCost} checked={feeState.transportSelected} onChange={(v) => onChangeFeeState({ ...feeState, transportSelected: v })} />
            )}
            {flags?.enableHostel && (
              <FlatToggle icon={Home} label="Hostel" desc="Boarding & lodging" amount={hostelCost} checked={feeState.hostelSelected} onChange={(v) => onChangeFeeState({ ...feeState, hostelSelected: v })} />
            )}
          </div>
        </div>
      )}

      {/* Section 7: Concession & Waiver — scholarship rules and custom
          waivers are gated by the Financial admission settings. */}
      {availableDiscountRules.length > 0 || waiverEnabled ? (
      <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
        <h4 className="text-xs font-bold uppercase tracking-wider text-primary flex items-center gap-1.5">
          <Tag className="h-3.5 w-3.5" /> Concession & Waiver
        </h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <Label className="text-xs text-muted-foreground block mb-1">Concession Rule</Label>
            <Select value={feeState.discountCode} onValueChange={(val) => onChangeFeeState({ ...feeState, discountCode: val })}>
              <SelectTrigger className="text-xs h-9"><SelectValue placeholder="No concession" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="NONE">No Concession</SelectItem>
                {availableDiscountRules.map((rule) => (
                  <SelectItem key={rule.code} value={rule.code}>{rule.name} ({rule.type === 'percentage' ? `${rule.value}%` : formatINR(rule.value)})</SelectItem>
                ))}
                {waiverEnabled && <SelectItem value="CUSTOM">Custom Waiver</SelectItem>}
              </SelectContent>
            </Select>
          </div>
          {feeState.discountCode === 'CUSTOM' && (
            <div>
              <Label className="text-xs text-muted-foreground block mb-1">Waiver Amount</Label>
              <Input type="number" value={feeState.customDiscountValue || ''} onChange={(e) => onChangeFeeState({ ...feeState, customDiscountValue: Number(e.target.value) })} placeholder="e.g. 5000" className="text-xs h-9 font-mono" />
            </div>
          )}
        </div>
        {feeState.discountCode === 'CUSTOM' && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 space-y-2">
            <p className="text-[10px] font-bold uppercase tracking-wider text-amber-600 flex items-center gap-1"><ShieldCheck className="h-3 w-3" /> Waiver Audit Trail</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <Input placeholder="Applied By (name)" value={feeState.waiverAppliedBy || ''} onChange={(e) => onChangeFeeState({ ...feeState, waiverAppliedBy: e.target.value })} className="text-xs h-8" />
              <Input placeholder="Approval Authority" value={feeState.waiverApprovalAuthority || ''} onChange={(e) => onChangeFeeState({ ...feeState, waiverApprovalAuthority: e.target.value })} className="text-xs h-8" />
            </div>
            <Input placeholder="Reason for waiver" value={feeState.waiverReason || ''} onChange={(e) => onChangeFeeState({ ...feeState, waiverReason: e.target.value })} className="text-xs h-8" />
            <Button size="sm" variant="outline" onClick={handleApplyWaiver} className="h-7 text-[11px]">Log Waiver in Audit</Button>
          </div>
        )}
      </div>
      ) : null}
    </div>
  )
}
