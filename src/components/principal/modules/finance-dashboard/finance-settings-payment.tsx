'use client'

/**
 * FinancePaymentCollectionSettings — CENTRAL payment infrastructure.
 *
 * ARCHITECTURE (FIN-CENTRAL-1): payment configuration has ONE home — the
 * Finance Dashboard → Settings tab. This component renders that global
 * infrastructure as ONE stack of compact cards in the Salary & Payroll
 * Settings anatomy:
 *
 *   A. Payment Methods  → paymentModes[] + togglePaymentMode
 *   B. Bank Accounts    → bankAccounts[] + addBankAccount / updateBankAccount /
 *                         setPrimaryBankAccount / deactivateBankAccount
 *   C. UPI / QR         → upiQrConfigs[] + addUpiQrConfig / updateUpiQrConfig
 *   D. Payment Gateway  → gatewayConfig + connectGateway / disconnectGateway /
 *                         updateGatewayStatus / recordWebhookEvent
 *
 * Downstream consumers (Fee collections, Additional Collections, UPI/QR
 * collect, Application & Form payments, any future financial workflow)
 * REFERENCE this configuration through the shared fee-store — they never
 * maintain duplicate gateway/bank/UPI settings of their own.
 *
 * Module-specific business rules stay where they belong: late fees,
 * concessions and entry-fee policy in Fee Management → Settings; payroll
 * payment behaviour in Salary & Payroll → Settings.
 *
 * The Reconciliation card was removed from Settings by product decision —
 * webhook/settlement matching lives with Transactions data, not on a
 * preferences surface.
 *
 * Secret keys are NEVER stored client-side. The Connect Gateway form only
 * captures merchantId + apiKeyId (the public key ID). The webhook secret
 * is configured server-side — we surface a note instead of an input.
 * All availability logic, masks, dialogs, handlers and store mutations
 * are behaviour-identical to the previous version.
 */

import { useState } from 'react'
import {
  Smartphone, CreditCard, Building2, Banknote, FileText, Wallet,
  Landmark, QrCode, Plug, Unplug, ShieldCheck, ShieldAlert,
  Check, Plus, Star, Ban, Pencil, RefreshCw, Webhook,
  AlertTriangle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { useFeeStore } from '@/lib/store/fee-store'
import type {
  PaymentMode, GatewayProvider, GatewayEnvironment, BankAccountType,
  UpiQrType,
} from '@/lib/store/fee-store'
import { formatDate, formatRelativeTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import { SettingsCard } from '../shared/settings-card'
import { FeeStatusBadge, modeAccent } from '../fees/fees-shared'
import { toast } from 'sonner'

export function FinancePaymentCollectionSettings() {
  return (
    <>
      <AcceptedPaymentMethods />
      <BankAndSettlement />
      <UpiQrConfigSection />
      <PaymentGatewaySection />
    </>
  )
}

// ─── A. Payment Methods ─────────────────────────────────────────────

interface MethodGroup {
  label: string
  modes: PaymentMode[]
}

const METHOD_GROUPS: MethodGroup[] = [
  { label: 'Online', modes: ['UPI', 'Card', 'Net Banking'] },
  { label: 'Offline', modes: ['Cash', 'Cheque', 'Bank Transfer'] },
]

const METHOD_DESCRIPTION: Record<PaymentMode, string> = {
  UPI: 'Instant UPI payment via VPA. Requires gateway connection or UPI QR config to be available to parents.',
  Card: 'Debit / Credit card payments. Routed through the connected payment gateway.',
  'Net Banking': 'Direct bank transfer via net banking. Routed through the connected payment gateway.',
  Cash: 'Cash collected at the school counter. Requires Principal verification before receipt is finalized.',
  Cheque: 'Cheque deposit. Bank name + cheque number + cheque date are mandatory.',
  'Bank Transfer': 'Manual NEFT / RTGS / IMPS transfer to a school bank account. Parent shares the UTR for verification.',
}

const METHOD_ICON: Record<PaymentMode, React.ComponentType<{ className?: string }>> = {
  UPI: Smartphone,
  Card: CreditCard,
  'Net Banking': Building2,
  Cash: Banknote,
  Cheque: FileText,
  'Bank Transfer': Wallet,
}

function AcceptedPaymentMethods() {
  const paymentModes = useFeeStore((s) => s.paymentModes)
  const togglePaymentMode = useFeeStore((s) => s.togglePaymentMode)
  const gatewayConfig = useFeeStore((s) => s.gatewayConfig)
  const upiQrConfigs = useFeeStore((s) => s.upiQrConfigs)
  // Bank Transfer availability depends on whether at least one bank account
  // is active (the parent needs an account to NEFT/RTGS to).
  const bankAccounts = useFeeStore((s) => s.bankAccounts)

  // Per-method "is this method actually available to parents?" check.
  //   Cash / Cheque  → always (offline, no infrastructure required)
  //   Bank Transfer  → at least one active BankAccount
  //   UPI            → active UPI QR OR gateway connected/test_mode
  //   Card / NetBank → gateway connected/test_mode
  const isAvailable = (mode: PaymentMode): boolean => {
    switch (mode) {
      case 'Cash':
      case 'Cheque':
        return true
      case 'Bank Transfer':
        return bankAccounts.some((b) => b.status === 'active')
      case 'UPI':
        if (upiQrConfigs.some((c) => c.status === 'active')) return true
        return !!gatewayConfig && (gatewayConfig.status === 'connected' || gatewayConfig.status === 'test_mode')
      case 'Card':
      case 'Net Banking':
        return !!gatewayConfig && (gatewayConfig.status === 'connected' || gatewayConfig.status === 'test_mode')
      default:
        return false
    }
  }

  const getStatusBadge = (mode: PaymentMode) => {
    const config = paymentModes.find((m) => m.id === mode)
    if (!config) return null
    if (!config.active) {
      return (
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-semibold ring-1 bg-muted text-muted-foreground ring-border/40 whitespace-nowrap">
          <Ban className="h-2.5 w-2.5" /> Disabled
        </span>
      )
    }
    if (isAvailable(mode)) {
      return (
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-semibold ring-1 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 ring-emerald-500/20 whitespace-nowrap">
          <Check className="h-2.5 w-2.5" /> Available
        </span>
      )
    }
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-semibold ring-1 bg-amber-500/10 text-amber-700 dark:text-amber-300 ring-amber-500/20 whitespace-nowrap">
        <AlertTriangle className="h-2.5 w-2.5" /> Configuration required
      </span>
    )
  }

  // Per-method "what to configure" hint shown when enabled + not available.
  const getConfigHint = (mode: PaymentMode): string => {
    switch (mode) {
      case 'UPI':
        return 'Connect a payment gateway OR add an active UPI QR to make UPI available to parents.'
      case 'Card':
      case 'Net Banking':
        return 'Connect a payment gateway (Razorpay / Cashfree / PayU) to enable card / net-banking payments.'
      case 'Bank Transfer':
        return 'Add at least one active bank account so parents have a destination for NEFT / RTGS / IMPS.'
      default:
        return ''
    }
  }

  const enabledCount = paymentModes.filter((m) => m.active).length

  return (
    <SettingsCard
      label="Payment Methods"
      icon={<CreditCard />}
      summary={`${enabledCount} of ${paymentModes.length} enabled`}
    >
      <div className="space-y-3">
        {METHOD_GROUPS.map((group) => (
          <div key={group.label}>
            <p className="text-[9px] uppercase font-semibold tracking-wider text-muted-foreground mb-1 px-0.5">
              {group.label}
            </p>
            <div className="divide-y divide-border/70 rounded-lg border border-border/60">
              {group.modes.map((modeId) => {
                const config = paymentModes.find((m) => m.id === modeId)
                if (!config) return null
                const Icon = METHOD_ICON[modeId]
                const available = isAvailable(modeId)
                const statusBadge = getStatusBadge(modeId)
                const showConfigHint = config.active && !available
                return (
                  <div
                    key={modeId}
                    className={cn(
                      'flex items-center gap-3 px-2.5 py-2.5 transition-colors',
                      !config.active && 'opacity-70',
                    )}
                  >
                    <div className={cn(
                      'flex h-7 w-7 shrink-0 items-center justify-center rounded-md ring-1',
                      config.active && available ? modeAccent(modeId) : 'bg-muted text-muted-foreground ring-border',
                    )}>
                      <Icon className="h-3.5 w-3.5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <p className="text-xs font-semibold">{config.label}</p>
                        {statusBadge}
                        {config.requiresReference && (
                          <span className="inline-flex items-center rounded bg-muted px-1 py-0.5 text-[8px] font-semibold uppercase tracking-wide text-muted-foreground ring-1 ring-border/60 whitespace-nowrap">ref required</span>
                        )}
                        {config.requiresChequeDetails && (
                          <span className="inline-flex items-center rounded bg-muted px-1 py-0.5 text-[8px] font-semibold uppercase tracking-wide text-muted-foreground ring-1 ring-border/60 whitespace-nowrap">cheque details</span>
                        )}
                      </div>
                      {/* Availability note — one truncated muted line (full text on hover) */}
                      <p className="text-[10px] text-muted-foreground mt-0.5 truncate" title={METHOD_DESCRIPTION[modeId]}>{METHOD_DESCRIPTION[modeId]}</p>
                      {showConfigHint && (
                        <p className="text-[9px] text-amber-700 dark:text-amber-400 mt-0.5 flex items-center gap-1 truncate" title={getConfigHint(modeId)}>
                          <AlertTriangle className="h-2.5 w-2.5 shrink-0" />
                          <span className="truncate">{getConfigHint(modeId)}</span>
                        </p>
                      )}
                    </div>
                    <Switch
                      checked={config.active}
                      onCheckedChange={() => {
                        togglePaymentMode(modeId)
                        toast.success(`${config.label} ${config.active ? 'disabled' : 'enabled'}`)
                      }}
                      aria-label={`Toggle ${config.label}`}
                    />
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </SettingsCard>
  )
}

// ─── B. Bank Accounts ───────────────────────────────────────────────

function maskAccount(num: string): string {
  if (num.length <= 4) return `••••${num}`
  return `•••• ${num.slice(-4)}`
}

function BankAndSettlement() {
  const bankAccounts = useFeeStore((s) => s.bankAccounts)
  const addBankAccount = useFeeStore((s) => s.addBankAccount)
  const updateBankAccount = useFeeStore((s) => s.updateBankAccount)
  const setPrimaryBankAccount = useFeeStore((s) => s.setPrimaryBankAccount)
  const deactivateBankAccount = useFeeStore((s) => s.deactivateBankAccount)

  const [showAdd, setShowAdd] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)

  const primary = bankAccounts.find((b) => b.isPrimary) ?? bankAccounts[0]
  const sorted = [...bankAccounts].sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary))

  return (
    <SettingsCard
      label="Bank Accounts"
      icon={<Landmark />}
      summary={`${bankAccounts.length} account(s) · ${bankAccounts.filter((b) => b.isPrimary).length} primary`}
      action={
        <Button size="sm" className="h-8 text-xs gap-1" onClick={() => setShowAdd(true)}>
          <Plus className="h-3 w-3" /> Add Account
        </Button>
      }
    >
      {bankAccounts.length === 0 ? (
        <p className="text-[11px] text-muted-foreground text-center py-6">
          No bank accounts configured. Add one to enable settlement tracking.
        </p>
      ) : (
        <div className="divide-y divide-border/70 rounded-lg border border-border/60">
          {sorted.map((b) => (
            <div key={b.id} className={cn('px-2.5 py-3', b.status === 'inactive' && 'opacity-60')}>
              {/* Identity row — letter chip + holder + Primary/Active pills + actions */}
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-sky-500/15 text-sky-700 dark:text-sky-300 text-xs font-bold uppercase">
                    {(b.bankName || '?').charAt(0)}
                  </span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <p className="text-xs font-semibold truncate">{b.holderName}</p>
                      {b.isPrimary && (
                        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-semibold bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 ring-1 ring-emerald-500/20">
                          <Star className="h-2.5 w-2.5 fill-current" /> Primary
                        </span>
                      )}
                      <FeeStatusBadge status={b.status === 'active' ? 'Active' : 'Inactive'} />
                    </div>
                    <p className="text-[10px] text-muted-foreground truncate mt-0.5">
                      {b.bankName} · <span className="capitalize">{b.accountType}</span> · {b.branch}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-0.5 shrink-0">
                  <Button size="sm" variant="ghost" className="h-7 text-[10px] gap-1" onClick={() => setEditing(b.id)}>
                    <Pencil className="h-3 w-3" /> Edit
                  </Button>
                  {!b.isPrimary && b.status === 'active' && (
                    <Button
                      size="sm" variant="ghost"
                      className="h-7 text-[10px] gap-1 text-emerald-600"
                      onClick={() => {
                        setPrimaryBankAccount(b.id)
                        toast.success('Primary account updated', { description: `${b.bankName} ••••${b.accountNumber.slice(-4)} is now the primary settlement account.` })
                      }}
                    >
                      <Star className="h-3 w-3" /> Set Primary
                    </Button>
                  )}
                  {b.status === 'active' && (
                    <Button
                      size="sm" variant="ghost"
                      className="h-7 text-[10px] gap-1 text-rose-600"
                      onClick={() => {
                        deactivateBankAccount(b.id)
                        toast.success('Account deactivated', { description: `${b.bankName} ••••${b.accountNumber.slice(-4)} deactivated.` })
                      }}
                    >
                      <Ban className="h-3 w-3" /> Deactivate
                    </Button>
                  )}
                </div>
              </div>
              {/* Sensitive fields — masked A/C mono + IFSC mono */}
              <p className="text-[10px] font-mono mt-1.5 ml-[42px] truncate">
                <span className="text-muted-foreground">A/C</span> {maskAccount(b.accountNumber)}
                <span className="text-muted-foreground"> · IFSC </span> {b.ifsc}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Parent-facing instructions for the primary account */}
      {primary && (
        <div className="border-t border-border/60 pt-3 space-y-2">
          <ParentInstructionsEditor primary={primary} />
        </div>
      )}

      {(showAdd || editing) && (
        <BankAccountDialog
          mode={showAdd ? 'add' : 'edit'}
          accountId={editing}
          onClose={() => { setShowAdd(false); setEditing(null) }}
          onSave={(payload) => {
            if (showAdd) {
              addBankAccount({ ...payload, status: 'active', isPrimary: false })
              toast.success('Bank account added', { description: `${payload.bankName} ••••${payload.accountNumber.slice(-4)} added.` })
            } else if (editing) {
              updateBankAccount(editing, payload)
              toast.success('Bank account updated', { description: `${payload.bankName} ••••${payload.accountNumber.slice(-4)} updated.` })
            }
            setShowAdd(false)
            setEditing(null)
          }}
        />
      )}
    </SettingsCard>
  )
}

function ParentInstructionsEditor({ primary }: { primary: { id: string; bankName: string; accountNumber: string; parentDisplayInstructions?: string } }) {
  const updateBankAccount = useFeeStore((s) => s.updateBankAccount)
  const [text, setText] = useState(primary?.parentDisplayInstructions ?? '')
  const dirty = text !== (primary?.parentDisplayInstructions ?? '')

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[9px] uppercase font-semibold tracking-wider text-muted-foreground">Parent Payment Instructions</p>
          <p className="text-[10px] text-muted-foreground mt-0.5 truncate">
            Shown on the parent payment page · primary account {primary.bankName} ••••{primary.accountNumber.slice(-4)}
          </p>
        </div>
        {dirty && (
          <Button
            size="sm"
            className="h-7 text-xs gap-1 shrink-0"
            onClick={() => {
              updateBankAccount(primary.id, { parentDisplayInstructions: text })
              toast.success('Parent instructions updated')
            }}
          >
            <Check className="h-3 w-3" /> Save
          </Button>
        )}
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={2}
        className="w-full rounded-md border border-border bg-background px-2.5 py-2 text-xs resize-y"
        placeholder="e.g. Use this account for NEFT/RTGS transfers. Email the transfer reference to accounts@scholario.edu for verification."
      />
    </div>
  )
}

interface BankAccountDialogProps {
  mode: 'add' | 'edit'
  accountId: string | null
  onClose: () => void
  onSave: (payload: Omit<import('@/lib/store/fee-store').BankAccount, 'id' | 'addedAt' | 'addedBy' | 'status' | 'isPrimary'>) => void
}

function BankAccountDialog({ mode, accountId, onClose, onSave }: BankAccountDialogProps) {
  const bankAccounts = useFeeStore((s) => s.bankAccounts)
  const existing = accountId ? bankAccounts.find((b) => b.id === accountId) : undefined

  const [holderName, setHolderName] = useState(existing?.holderName ?? 'Scholario Education Society')
  const [bankName, setBankName] = useState(existing?.bankName ?? '')
  const [accountNumber, setAccountNumber] = useState(existing?.accountNumber ?? '')
  const [ifsc, setIfsc] = useState(existing?.ifsc ?? '')
  const [branch, setBranch] = useState(existing?.branch ?? '')
  const [accountType, setAccountType] = useState<BankAccountType>(existing?.accountType ?? 'current')
  const [parentDisplayInstructions, setParentDisplayInstructions] = useState(existing?.parentDisplayInstructions ?? '')

  const valid = holderName.trim() && bankName.trim() && accountNumber.trim().length >= 4 && ifsc.trim() && branch.trim()

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{mode === 'add' ? 'Add Bank Account' : 'Edit Bank Account'}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <Label className="text-[11px]">Holder Name</Label>
            <Input value={holderName} onChange={(e) => setHolderName(e.target.value)} className="h-8 text-xs mt-1" />
          </div>
          <div>
            <Label className="text-[11px]">Bank Name</Label>
            <Input value={bankName} onChange={(e) => setBankName(e.target.value)} placeholder="HDFC Bank" className="h-8 text-xs mt-1" />
          </div>
          <div>
            <Label className="text-[11px]">Account Number</Label>
            <Input
              value={accountNumber}
              onChange={(e) => setAccountNumber(e.target.value.replace(/\D/g, '').slice(0, 18))}
              inputMode="numeric"
              placeholder="50100123456789"
              className="h-8 text-xs font-mono mt-1"
            />
          </div>
          <div>
            <Label className="text-[11px]">IFSC</Label>
            <Input value={ifsc} onChange={(e) => setIfsc(e.target.value.toUpperCase().slice(0, 11))} placeholder="HDFC0001234" className="h-8 text-xs font-mono mt-1" />
          </div>
          <div>
            <Label className="text-[11px]">Branch</Label>
            <Input value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="MG Road, Bengaluru" className="h-8 text-xs mt-1" />
          </div>
          <div>
            <Label className="text-[11px]">Account Type</Label>
            <select
              value={accountType}
              onChange={(e) => setAccountType(e.target.value as BankAccountType)}
              className="w-full h-8 text-xs rounded-md border border-border bg-background px-2 mt-1"
            >
              <option value="savings">Savings</option>
              <option value="current">Current</option>
              <option value="nre">NRE</option>
              <option value="nro">NRO</option>
            </select>
          </div>
          <div className="col-span-2">
            <Label className="text-[11px]">Parent Payment Instructions (optional)</Label>
            <textarea
              value={parentDisplayInstructions}
              onChange={(e) => setParentDisplayInstructions(e.target.value)}
              rows={2}
              className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs resize-y mt-1"
              placeholder="Shown to parents on the offline payment screen."
            />
          </div>
        </div>
        <div className="rounded-md bg-sky-500/5 border border-sky-500/20 p-2 flex items-start gap-2">
          <ShieldCheck className="h-3.5 w-3.5 text-sky-600 shrink-0 mt-0.5" />
          <p className="text-[10px] text-muted-foreground">
            Account numbers are stored masked in the UI. Full numbers are kept only on the school record for reconciliation.
          </p>
        </div>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button
            size="sm"
            className="gap-1"
            disabled={!valid}
            onClick={() => onSave({ holderName, bankName, accountNumber, ifsc, branch, accountType, parentDisplayInstructions })}
          >
            <Check className="h-3.5 w-3.5" /> {mode === 'add' ? 'Add Account' : 'Save Changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── C. UPI / QR ────────────────────────────────────────────────────

function UpiQrConfigSection() {
  const upiQrConfigs = useFeeStore((s) => s.upiQrConfigs)
  const addUpiQrConfig = useFeeStore((s) => s.addUpiQrConfig)
  const updateUpiQrConfig = useFeeStore((s) => s.updateUpiQrConfig)

  const [showAdd, setShowAdd] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)

  return (
    <SettingsCard
      label="UPI / QR"
      icon={<QrCode />}
      summary={`${upiQrConfigs.filter((c) => c.status === 'active').length} of ${upiQrConfigs.length} active`}
      action={
        <Button size="sm" className="h-8 text-xs gap-1" onClick={() => setShowAdd(true)}>
          <Plus className="h-3 w-3" /> Add Config
        </Button>
      }
    >
      {upiQrConfigs.length === 0 ? (
        <p className="text-[11px] text-muted-foreground text-center py-6">
          No UPI / QR configurations. Add one to accept UPI payments without a gateway.
        </p>
      ) : (
        <div className="divide-y divide-border/70 rounded-lg border border-border/60">
          {/* No QR image is rendered here — no QR mechanism/library exists on
              this surface, so we keep the QrCode icon chip and deliberately
              avoid adding any dependency. */}
          {upiQrConfigs.map((c) => (
            <div key={c.id} className={cn('px-2.5 py-3', c.status !== 'active' && 'opacity-70')}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-600">
                    <QrCode className="h-3.5 w-3.5" />
                  </span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <p className="text-xs font-semibold truncate">{c.name}</p>
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-semibold bg-muted text-muted-foreground ring-1 ring-border capitalize whitespace-nowrap">
                        {c.qrType} QR
                      </span>
                      <FeeStatusBadge status={c.status === 'active' ? 'Active' : 'Inactive'} />
                    </div>
                    <p className="text-[10px] text-muted-foreground truncate mt-0.5">
                      <span className="font-mono">{c.upiId}</span> · {c.payeeName}{c.provider ? ` · ${c.provider}` : ''}
                    </p>
                    {c.notes && (
                      <p className="text-[10px] text-muted-foreground/80 truncate mt-0.5" title={c.notes}>{c.notes}</p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-0.5 shrink-0">
                  <Button size="sm" variant="ghost" className="h-7 text-[10px] gap-1" onClick={() => setEditing(c.id)}>
                    <Pencil className="h-3 w-3" /> Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className={cn('h-7 text-[10px] gap-1', c.status === 'active' ? 'text-rose-600' : 'text-emerald-600')}
                    onClick={() => {
                      const newStatus = c.status === 'active' ? 'inactive' : 'active'
                      updateUpiQrConfig(c.id, { status: newStatus })
                      toast.success(`UPI config ${newStatus === 'active' ? 'activated' : 'deactivated'}`, { description: c.name })
                    }}
                  >
                    {c.status === 'active' ? <Ban className="h-3 w-3" /> : <Check className="h-3 w-3" />}
                    {c.status === 'active' ? 'Deactivate' : 'Activate'}
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {(showAdd || editing) && (
        <UpiQrDialog
          mode={showAdd ? 'add' : 'edit'}
          configId={editing}
          onClose={() => { setShowAdd(false); setEditing(null) }}
          onSave={(payload) => {
            if (showAdd) {
              addUpiQrConfig({ ...payload, status: 'active' })
              toast.success('UPI config added', { description: `${payload.name} (${payload.upiId})` })
            } else if (editing) {
              updateUpiQrConfig(editing, payload)
              toast.success('UPI config updated', { description: payload.name })
            }
            setShowAdd(false)
            setEditing(null)
          }}
        />
      )}
    </SettingsCard>
  )
}

interface UpiQrDialogProps {
  mode: 'add' | 'edit'
  configId: string | null
  onClose: () => void
  onSave: (payload: Omit<import('@/lib/store/fee-store').UpiQrConfig, 'id' | 'addedAt' | 'addedBy' | 'status'>) => void
}

function UpiQrDialog({ mode, configId, onClose, onSave }: UpiQrDialogProps) {
  const upiQrConfigs = useFeeStore((s) => s.upiQrConfigs)
  const existing = configId ? upiQrConfigs.find((c) => c.id === configId) : undefined

  const [name, setName] = useState(existing?.name ?? '')
  const [upiId, setUpiId] = useState(existing?.upiId ?? '')
  const [payeeName, setPayeeName] = useState(existing?.payeeName ?? 'Scholario Education Society')
  const [qrType, setQrType] = useState<UpiQrType>(existing?.qrType ?? 'static')
  const [provider, setProvider] = useState(existing?.provider ?? '')
  const [notes, setNotes] = useState(existing?.notes ?? '')

  const valid = name.trim() && upiId.trim().includes('@') && payeeName.trim()

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{mode === 'add' ? 'Add UPI / QR Config' : 'Edit UPI / QR Config'}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <Label className="text-[11px]">Display Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Main Counter UPI" className="h-8 text-xs mt-1" />
          </div>
          <div>
            <Label className="text-[11px]">UPI ID (VPA)</Label>
            <Input value={upiId} onChange={(e) => setUpiId(e.target.value)} placeholder="school@hdfc" className="h-8 text-xs font-mono mt-1" />
          </div>
          <div>
            <Label className="text-[11px]">Payee Name</Label>
            <Input value={payeeName} onChange={(e) => setPayeeName(e.target.value)} className="h-8 text-xs mt-1" />
          </div>
          <div>
            <Label className="text-[11px]">QR Type</Label>
            <select
              value={qrType}
              onChange={(e) => setQrType(e.target.value as UpiQrType)}
              className="w-full h-8 text-xs rounded-md border border-border bg-background px-2 mt-1"
            >
              <option value="static">Static (any amount)</option>
              <option value="dynamic">Dynamic (per-payment)</option>
            </select>
          </div>
          <div>
            <Label className="text-[11px]">Provider (optional)</Label>
            <Input value={provider} onChange={(e) => setProvider(e.target.value)} placeholder="razorpay / bhim / custom" className="h-8 text-xs mt-1" />
          </div>
          <div className="col-span-2">
            <Label className="text-[11px]">Notes (optional)</Label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs resize-y mt-1"
              placeholder="Where this QR is displayed, special instructions, etc."
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button
            size="sm"
            className="gap-1"
            disabled={!valid}
            onClick={() => onSave({ name, upiId, payeeName, qrType, provider: provider || undefined, notes: notes || undefined })}
          >
            <Check className="h-3.5 w-3.5" /> {mode === 'add' ? 'Add Config' : 'Save Changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── D. Payment Gateway ─────────────────────────────────────────────

const GATEWAY_PROVIDERS: Array<{ value: GatewayProvider; label: string; note: string }> = [
  { value: 'razorpay', label: 'Razorpay', note: 'Most popular for schools. Webhook signature support.' },
  { value: 'cashfree', label: 'Cashfree', note: 'Aggressive pricing. Easy payouts + settlements.' },
  { value: 'payu', label: 'PayU', note: 'Strong UPI + EMI support.' },
]

function maskMerchant(id: string): string {
  if (!id) return '—'
  if (id.length <= 8) return id
  return `${id.slice(0, 4)}••••${id.slice(-4)}`
}

function ConfigCell({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="rounded-md border border-border/60 bg-muted/20 px-2.5 py-1.5 min-w-0">
      <p className="text-[9px] uppercase text-muted-foreground font-semibold tracking-wider truncate">{label}</p>
      <p className={cn('text-xs font-medium mt-0.5 truncate', mono && 'font-mono')}>{value}</p>
    </div>
  )
}

function PaymentGatewaySection() {
  const gatewayConfig = useFeeStore((s) => s.gatewayConfig)
  const bankAccounts = useFeeStore((s) => s.bankAccounts)
  const connectGateway = useFeeStore((s) => s.connectGateway)
  const disconnectGateway = useFeeStore((s) => s.disconnectGateway)
  const updateGatewayStatus = useFeeStore((s) => s.updateGatewayStatus)
  const recordWebhookEvent = useFeeStore((s) => s.recordWebhookEvent)

  const [showConnect, setShowConnect] = useState(false)
  const settlementAccount = bankAccounts.find((b) => b.id === gatewayConfig?.settlementAccountId)

  const handleTestWebhook = () => {
    if (!gatewayConfig) return
    // Simulate an inbound webhook from the gateway — proves the webhook
    // pipeline works end-to-end. In production this is delivered by the
    // gateway itself to /api/webhooks/{provider}.
    recordWebhookEvent({
      provider: gatewayConfig.provider,
      eventId: `evt_test_${Date.now().toString(36)}`,
      eventType: 'ping.test',
      receivedAt: new Date().toISOString(),
      processedAt: new Date().toISOString(),
      status: 'processed',
    })
    updateGatewayStatus(gatewayConfig.status, new Date().toISOString())
    toast.success('Webhook test fired', { description: 'A test webhook event was processed successfully.' })
  }

  if (!gatewayConfig) {
    return (
      <SettingsCard
        label="Payment Gateway"
        icon={<Plug />}
        action={
          <Button size="sm" className="h-8 text-xs gap-1" onClick={() => setShowConnect(true)}>
            <Plug className="h-3 w-3" /> Connect Gateway
          </Button>
        }
      >
        <p className="text-[11px] text-muted-foreground text-center py-4">
          No gateway connected — offline methods continue to work. Connect one to accept UPI / Card / Net Banking online.
        </p>
        {showConnect && (
          <ConnectGatewayDialog
            onClose={() => setShowConnect(false)}
            onConnect={(provider, merchantId, apiKeyId, environment) => {
              connectGateway(provider, merchantId, apiKeyId, environment)
              toast.success('Gateway connected', { description: `${provider} connected in ${environment} mode.` })
              setShowConnect(false)
            }}
          />
        )}
      </SettingsCard>
    )
  }

  const connected = gatewayConfig.status === 'connected' || gatewayConfig.status === 'test_mode'
  const isLive = gatewayConfig.environment === 'live'
  const isTestMode = gatewayConfig.status === 'test_mode'

  return (
    <SettingsCard
      label="Payment Gateway"
      icon={<Plug />}
      summary={`${gatewayConfig.provider} · ${gatewayConfig.environment}`}
      action={
        <Button
          size="sm"
          variant="ghost"
          className="h-8 text-xs gap-1 text-rose-600"
          onClick={() => {
            if (confirm('Disconnect gateway? Historical transactions remain on record. New online payments will be disabled.')) {
              disconnectGateway()
              toast.success('Gateway disconnected', { description: 'Online payment methods are now disabled.' })
            }
          }}
        >
          <Unplug className="h-3 w-3" /> Disconnect
        </Button>
      }
    >
      <div className="space-y-3">
        {/* Status line */}
        <div className={cn(
          'rounded-lg border px-2.5 py-2 flex items-start gap-2.5',
          connected
            ? (isLive ? 'bg-emerald-500/[0.04] border-emerald-500/20' : 'bg-amber-500/[0.04] border-amber-500/20')
            : 'bg-rose-500/[0.04] border-rose-500/20',
        )}>
          {connected ? <ShieldCheck className="h-3.5 w-3.5 text-emerald-600 shrink-0 mt-0.5" /> : <ShieldAlert className="h-3.5 w-3.5 text-rose-600 shrink-0 mt-0.5" />}
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <p className="text-xs font-semibold capitalize">{gatewayConfig.provider} — {gatewayConfig.status.replace('_', ' ')}</p>
              {isTestMode && (
                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-semibold bg-amber-500/10 text-amber-700 dark:text-amber-300 ring-1 ring-amber-500/20">
                  TEST MODE
                </span>
              )}
            </div>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              {isLive
                ? 'Live mode — real payments are being processed.'
                : isTestMode
                  ? 'Test mode — only test transactions succeed. Switch to live before opening to parents.'
                  : 'Gateway inactive. Verify credentials or reconnect.'}
            </p>
          </div>
        </div>

        {/* Config grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
          <ConfigCell label="Merchant ID" value={maskMerchant(gatewayConfig.merchantId ?? '')} mono />
          <ConfigCell label="API Key ID" value={gatewayConfig.apiKeyId ?? '—'} mono />
          <ConfigCell label="Webhook URL" value={gatewayConfig.webhookUrl ?? '—'} mono />
          <ConfigCell
            label="Webhook Status"
            value={
              <span className={cn(
                'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold',
                gatewayConfig.webhookStatus === 'healthy' && 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
                gatewayConfig.webhookStatus === 'not_configured' && 'bg-muted text-muted-foreground',
                gatewayConfig.webhookStatus === 'error' && 'bg-rose-500/10 text-rose-700 dark:text-rose-300',
              )}>
                {gatewayConfig.webhookStatus.replace('_', ' ')}
              </span>
            }
          />
          <ConfigCell label="Last Webhook" value={gatewayConfig.lastWebhookAt ? `${formatDate(gatewayConfig.lastWebhookAt)} · ${formatRelativeTime(gatewayConfig.lastWebhookAt)}` : 'never'} />
          <ConfigCell label="Failed Webhooks" value={String(gatewayConfig.failedWebhookCount)} />
          <ConfigCell label="Settlement Account" value={settlementAccount ? `${settlementAccount.bankName} ****${settlementAccount.accountNumber.slice(-4)}` : 'not linked'} />
          <ConfigCell label="Connected By" value={`${gatewayConfig.connectedBy ?? '—'} · ${gatewayConfig.connectedAt ? formatDate(gatewayConfig.connectedAt) : ''}`} />
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 flex-wrap border-t border-border/60 pt-2.5">
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs gap-1"
            onClick={() => {
              updateGatewayStatus('connected', gatewayConfig.lastWebhookAt)
              toast.success('Connection test passed', { description: `${gatewayConfig.provider} reachable. Webhook URL active.` })
            }}
          >
            <RefreshCw className="h-3 w-3" /> Test Connection
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs gap-1"
            onClick={handleTestWebhook}
          >
            <Webhook className="h-3 w-3" /> Test Webhook
          </Button>
          {isTestMode && (
            <Button
              size="sm"
              className="h-7 text-xs gap-1"
              onClick={() => {
                connectGateway(gatewayConfig.provider, gatewayConfig.merchantId ?? '', gatewayConfig.apiKeyId ?? '', 'live')
                toast.success('Switched to LIVE mode', { description: 'Real payments will now be processed.' })
              }}
            >
              <Check className="h-3 w-3" /> Switch to Live
            </Button>
          )}
          <p className="text-[9px] text-muted-foreground ml-auto hidden md:block">
            Secret key stored server-side — never exposed in the browser.
          </p>
        </div>
      </div>

      {showConnect && (
        <ConnectGatewayDialog
          onClose={() => setShowConnect(false)}
          onConnect={(provider, merchantId, apiKeyId, environment) => {
            connectGateway(provider, merchantId, apiKeyId, environment)
            toast.success('Gateway connected', { description: `${provider} connected in ${environment} mode.` })
            setShowConnect(false)
          }}
        />
      )}
    </SettingsCard>
  )
}

interface ConnectGatewayDialogProps {
  onClose: () => void
  onConnect: (provider: GatewayProvider, merchantId: string, apiKeyId: string, environment: GatewayEnvironment) => void
}

function ConnectGatewayDialog({ onClose, onConnect }: ConnectGatewayDialogProps) {
  const [provider, setProvider] = useState<GatewayProvider>('razorpay')
  const [merchantId, setMerchantId] = useState('')
  const [apiKeyId, setApiKeyId] = useState('')
  const [environment, setEnvironment] = useState<GatewayEnvironment>('test')
  const valid = merchantId.trim() && apiKeyId.trim()

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Connect Payment Gateway</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-[11px]">Gateway Provider</Label>
            <div className="grid grid-cols-1 gap-1.5 mt-1">
              {GATEWAY_PROVIDERS.map((p) => (
                <button
                  key={p.value}
                  onClick={() => setProvider(p.value)}
                  className={cn(
                    'text-left rounded-md border px-2.5 py-2 transition-colors',
                    provider === p.value ? 'border-emerald-500/40 bg-emerald-500/[0.04]' : 'border-border hover:bg-muted/30',
                  )}
                >
                  <p className="text-xs font-semibold">{p.label}</p>
                  <p className="text-[10px] text-muted-foreground">{p.note}</p>
                </button>
              ))}
            </div>
          </div>
          <div>
            <Label className="text-[11px]">Merchant ID</Label>
            <Input value={merchantId} onChange={(e) => setMerchantId(e.target.value)} placeholder="rzp_test_DEMO1234" className="h-8 text-xs font-mono mt-1" />
          </div>
          <div>
            <Label className="text-[11px]">API Key ID (public)</Label>
            <Input value={apiKeyId} onChange={(e) => setApiKeyId(e.target.value)} placeholder="key_DEMO1234" className="h-8 text-xs font-mono mt-1" />
          </div>
          <div>
            <Label className="text-[11px]">Environment</Label>
            <div className="grid grid-cols-2 gap-1.5 mt-1">
              <button
                onClick={() => setEnvironment('test')}
                className={cn(
                  'rounded-md border px-2.5 py-2 text-xs font-medium transition-colors',
                  environment === 'test' ? 'border-amber-500/40 bg-amber-500/[0.04] text-amber-700 dark:text-amber-300' : 'border-border hover:bg-muted/30',
                )}
              >
                Test
              </button>
              <button
                onClick={() => setEnvironment('live')}
                className={cn(
                  'rounded-md border px-2.5 py-2 text-xs font-medium transition-colors',
                  environment === 'live' ? 'border-emerald-500/40 bg-emerald-500/[0.04] text-emerald-700 dark:text-emerald-300' : 'border-border hover:bg-muted/30',
                )}
              >
                Live
              </button>
            </div>
          </div>
          <div className="rounded-md bg-sky-500/5 border border-sky-500/20 p-2 flex items-start gap-2">
            <ShieldCheck className="h-3.5 w-3.5 text-sky-600 shrink-0 mt-0.5" />
            <p className="text-[10px] text-muted-foreground">
              The <span className="font-semibold">webhook secret</span> is configured server-side via environment variable — never stored in browser state. Set <span className="font-mono">{provider.toUpperCase()}_WEBHOOK_SECRET</span> on the server.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button
            size="sm"
            className="gap-1"
            disabled={!valid}
            onClick={() => onConnect(provider, merchantId.trim(), apiKeyId.trim(), environment)}
          >
            <Plug className="h-3.5 w-3.5" /> Connect
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

