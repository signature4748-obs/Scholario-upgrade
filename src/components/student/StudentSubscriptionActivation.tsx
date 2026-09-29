'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'
import { QrCode, CheckCircle2, ArrowRight, IndianRupee, Lock, Smartphone, RefreshCw,  } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { getPlatformConfig, activateStudentSubscription, StudentSubscriptionRecord } from '@/lib/platform-subscription'
import { formatINR, formatDate } from '@/lib/format'
import { toast } from 'sonner'

interface Props {
  studentId: string
  studentName: string
  onActivated: () => void
}

export function StudentSubscriptionActivation({ studentId, studentName, onActivated }: Props) {
  const platformConfig = getPlatformConfig()
  const [paymentMethod, setPaymentMethod] = useState<'qr' | 'upi' | 'card'>('qr')
  const [utr, setUtr] = useState('')
  const [upiId, setUpiId] = useState('')
  const [isProcessing, setIsProcessing] = useState(false)
  const [receiptRecord, setReceiptRecord] = useState<StudentSubscriptionRecord | null>(null)

  const handlePayAndActivate = () => {
    setIsProcessing(true)
    setTimeout(() => {
      const record = activateStudentSubscription(
        studentId,
        studentName,
        paymentMethod === 'qr' ? 'UPI QR Code' : paymentMethod === 'upi' ? 'Direct UPI ID' : 'Credit / Debit Card',
        utr || `UTR-${Math.floor(100000000000 + Math.random() * 900000000000)}`
      )
      setReceiptRecord(record)
      setIsProcessing(false)
      toast.success('Scholario Platform License Activated!', {
        description: `Receipt #${record.receiptNo} generated for ${studentName}.`,
      })
    }, 1200)
  }

  if (receiptRecord) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-4 font-sans">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="max-w-md w-full bg-slate-900 border border-emerald-500/30 rounded-3xl p-6 sm:p-8 shadow-2xl space-y-6 relative overflow-hidden"
        >
          {/* Top glow decoration */}
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-48 h-1 bg-gradient-to-r from-emerald-500 via-teal-400 to-cyan-500 rounded-full blur-xs" />

          <div className="text-center space-y-2">
            <div className="mx-auto h-16 w-16 rounded-2xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center justify-center font-bold shadow-lg">
              <CheckCircle2 className="h-9 w-9" />
            </div>
            <h2 className="text-xl font-black font-display tracking-tight text-white">
              Platform Subscription Active!
            </h2>
            <p className="text-xs text-slate-400">
              Your annual Scholario Student License is now fully active for Academic Session 2025–2026.
            </p>
          </div>

          {/* Receipt Summary Card */}
          <div className="bg-slate-950/80 rounded-2xl p-4 border border-slate-800 space-y-3 font-mono text-xs">
            <div className="flex justify-between text-slate-400">
              <span>Receipt No</span>
              <span className="text-emerald-400 font-bold">{receiptRecord.receiptNo}</span>
            </div>
            <div className="flex justify-between text-slate-400">
              <span>Student Account</span>
              <span className="text-white font-bold">{studentName} ({studentId})</span>
            </div>
            <div className="flex justify-between text-slate-400">
              <span>Plan Type</span>
              <span className="text-white font-bold">{receiptRecord.planName}</span>
            </div>
            <div className="flex justify-between text-slate-400">
              <span>Amount Paid</span>
              <span className="text-emerald-400 font-extrabold text-sm">{formatINR(receiptRecord.amountPaid)}</span>
            </div>
            <div className="flex justify-between text-slate-400">
              <span>Valid Until</span>
              <span className="text-cyan-400 font-bold">{formatDate(receiptRecord.expiresAt!)}</span>
            </div>
            <div className="flex justify-between text-slate-400">
              <span>Transaction Ref</span>
              <span className="text-slate-300 text-[10px] truncate max-w-[180px]">{receiptRecord.transactionRef}</span>
            </div>
          </div>

          <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-xs text-center font-medium">
            ✓ Student Portal unlocked. You can now view homework, report cards, learning resources, and timetable.
          </div>

          <Button
            onClick={onActivated}
            className="w-full bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black h-12 rounded-xl text-sm gap-2 shadow-lg shadow-emerald-500/20"
          >
            Go to Student Dashboard
            <ArrowRight className="h-4 w-4" />
          </Button>
        </motion.div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-4 font-sans">
      <motion.div
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-lg w-full bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl space-y-6 relative overflow-hidden"
      >
        {/* Decorative Top Accent */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div className="flex items-center gap-2.5">
            <div className="h-10 w-10 rounded-xl bg-indigo-600/20 text-indigo-400 border border-indigo-500/30 flex items-center justify-center font-black font-display text-lg">
              S
            </div>
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-400 block">Scholario SaaS Platform</span>
              <h2 className="text-base font-black font-display text-white">Student Platform License Activation</h2>
            </div>
          </div>
          <Badge variant="outline" className="border-amber-500/30 text-amber-400 bg-amber-500/10 text-[10px] font-bold">
            First Login Action Required
          </Badge>
        </div>

        {/* Pricing Offer Banner */}
        <div className="bg-gradient-to-r from-indigo-950 via-slate-900 to-slate-950 p-5 rounded-2xl border border-indigo-500/30 space-y-3 relative overflow-hidden">
          <div className="flex items-start justify-between">
            <div>
              <span className="text-xs text-indigo-300 font-bold block">Annual Student Platform License</span>
              <h3 className="text-2xl font-black text-white font-display mt-0.5">
                {formatINR(platformConfig.payableAmount)}
                <span className="text-xs text-slate-400 font-normal line-through ml-2">
                  {formatINR(platformConfig.annualFee)}
                </span>
              </h3>
            </div>
            <Badge className="bg-emerald-500 text-slate-950 font-black text-xs px-2.5 py-1">
              {platformConfig.offerDiscountPercentage}% OFF OFFER
            </Badge>
          </div>

          <p className="text-xs text-slate-300 leading-relaxed">
            Unlocks complete student portal features: homework submissions, live timetable, exam progress analytics, learning hub materials & digital report cards.
          </p>

          <div className="pt-2 border-t border-indigo-900/50 flex items-center justify-between text-[11px] text-slate-400">
            <span>Student: <strong className="text-white">{studentName}</strong></span>
            <span>Validity: <strong className="text-emerald-400">1 Full Academic Year</strong></span>
          </div>
        </div>

        {/* Note on Separation */}
        <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-[11px] text-slate-400 flex items-center gap-2">
          <Lock className="h-4 w-4 text-indigo-400 shrink-0" />
          <span>Note: Platform Subscription is for Scholario digital tools. School Admission Fees are managed separately by your school.</span>
        </div>

        {/* Payment Methods Selector */}
        <div className="space-y-3">
          <Label className="text-xs font-bold uppercase tracking-wider text-slate-400">
            Select Preferred Payment Method
          </Label>

          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={() => setPaymentMethod('qr')}
              className={`p-3 rounded-xl border text-center transition-all ${
                paymentMethod === 'qr'
                  ? 'border-indigo-500 bg-indigo-600/10 text-white font-bold'
                  : 'border-slate-800 bg-slate-950/50 text-slate-400 hover:text-slate-200'
              }`}
            >
              <QrCode className="h-5 w-5 mx-auto mb-1 text-indigo-400" />
              <span className="text-xs block">UPI QR Code</span>
            </button>

            <button
              type="button"
              onClick={() => setPaymentMethod('upi')}
              className={`p-3 rounded-xl border text-center transition-all ${
                paymentMethod === 'upi'
                  ? 'border-indigo-500 bg-indigo-600/10 text-white font-bold'
                  : 'border-slate-800 bg-slate-950/50 text-slate-400 hover:text-slate-200'
              }`}
            >
              <Smartphone className="h-5 w-5 mx-auto mb-1 text-indigo-400" />
              <span className="text-xs block">UPI VPA / ID</span>
            </button>

            <button
              type="button"
              onClick={() => setPaymentMethod('card')}
              className={`p-3 rounded-xl border text-center transition-all ${
                paymentMethod === 'card'
                  ? 'border-indigo-500 bg-indigo-600/10 text-white font-bold'
                  : 'border-slate-800 bg-slate-950/50 text-slate-400 hover:text-slate-200'
              }`}
            >
              <IndianRupee className="h-5 w-5 mx-auto mb-1 text-indigo-400" />
              <span className="text-xs block">Gateway / Cards</span>
            </button>
          </div>

          {/* Payment Method Details */}
          {paymentMethod === 'qr' && (
            <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 text-center space-y-3">
              <div className="mx-auto h-40 w-40 bg-white p-2 rounded-xl flex flex-col items-center justify-center border-2 border-indigo-500/30 shadow-md">
                {/* SVG Mock QR Code */}
                <div className="w-full h-full border border-slate-300 p-2 flex flex-col justify-between items-center bg-slate-50 font-mono text-[9px] text-slate-800">
                  <div className="flex justify-between w-full">
                    <div className="w-8 h-8 bg-slate-900 rounded-sm" />
                    <div className="w-8 h-8 bg-slate-900 rounded-sm" />
                  </div>
                  <div className="my-1 font-extrabold text-indigo-700 text-center">
                    SCHOLARIO UPI QR<br />₹{platformConfig.payableAmount}
                  </div>
                  <div className="flex justify-between w-full">
                    <div className="w-8 h-8 bg-slate-900 rounded-sm" />
                    <div className="w-2 h-2 bg-slate-900 rounded-xs" />
                  </div>
                </div>
              </div>

              <p className="text-xs text-slate-400">
                Scan with Google Pay, PhonePe, Paytm, or BHIM UPI.<br />
                VPA: <strong className="text-white font-mono">{platformConfig.upiId}</strong>
              </p>
            </div>
          )}

          {paymentMethod === 'upi' && (
            <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-3">
              <div>
                <Label className="text-xs text-slate-400 block mb-1">Enter your UPI ID (VPA)</Label>
                <Input
                  value={upiId}
                  onChange={(e) => setUpiId(e.target.value)}
                  placeholder="e.g. mobile@upi or username@okicici"
                  className="bg-slate-900 border-slate-800 text-white h-10 text-xs"
                />
              </div>
              <p className="text-[11px] text-slate-500">
                A payment request for {formatINR(platformConfig.payableAmount)} will be sent to your UPI app.
              </p>
            </div>
          )}

          {/* Reference Number input */}
          <div className="pt-2">
            <Label className="text-xs text-slate-400 block mb-1">Payment Reference / UTR Number (Optional)</Label>
            <Input
              value={utr}
              onChange={(e) => setUtr(e.target.value)}
              placeholder="e.g. 504912903481 (Leave empty for auto-generation)"
              className="bg-slate-950 border-slate-800 text-white h-10 text-xs font-mono"
            />
          </div>
        </div>

        {/* Action Button */}
        <Button
          onClick={handlePayAndActivate}
          disabled={isProcessing}
          className="w-full bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-slate-950 font-black h-12 rounded-xl text-sm gap-2 shadow-xl shadow-emerald-500/10"
        >
          {isProcessing ? (
            <>
              <RefreshCw className="h-4 w-4 animate-spin" />
              Verifying Payment & Activating License...
            </>
          ) : (
            <>
              Pay {formatINR(platformConfig.payableAmount)} & Activate License
              <ArrowRight className="h-4 w-4" />
            </>
          )}
        </Button>
      </motion.div>
    </div>
  )
}
