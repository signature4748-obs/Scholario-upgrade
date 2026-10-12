import type React from 'react'
import { Checkbox } from '@/components/ui/checkbox'
import { Plus, Minus } from 'lucide-react'
import { formatINR } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { CartRowProps } from './types'

/* ---------- Helper components ---------- */

/** THREE-STATE (PR-3): value UNDEFINED = not configured. */
export function FeeHeadRow({ label, value }: { label: string; value: number | undefined }) {
  return (
    <div className="p-2.5 rounded-xl border border-border bg-muted/30 flex justify-between items-center">
      <span>{label}</span>
      <span className={cn('font-mono font-bold tabular-nums', value === undefined && 'font-sans font-medium italic text-muted-foreground/70')}>
        {value === undefined ? 'Not configured' : formatINR(value)}
      </span>
    </div>
  )
}

/** THREE-STATE (PR-3): value UNDEFINED = not configured. */
export function LedgerRow({ label, value }: { label: string; value: number | undefined }) {
  return (
    <div className="flex justify-between text-muted-foreground">
      <span>{label}</span>
      <span className={cn('tabular-nums', value === undefined && 'font-sans italic text-muted-foreground/70')}>
        {value === undefined ? 'Not configured' : formatINR(value)}
      </span>
    </div>
  )
}

/** THREE-STATE (PR-3): amount UNDEFINED = not configured — rendered as
 *  "Not configured", never a fabricated ₹0. */
export function ExamToggle({ label, amount, checked, onChange }: { label: string; amount: number | undefined; checked: boolean; onChange: (c: boolean) => void }) {
  return (
    <label className={cn('p-3 rounded-xl border text-xs cursor-pointer transition-all flex flex-col justify-between', checked ? 'border-primary bg-primary/10 text-foreground font-semibold' : 'border-border bg-muted/20 text-muted-foreground')}>
      <div className="flex items-center justify-between mb-1">
        <span>{label}</span>
        <Checkbox checked={checked} onCheckedChange={(c) => onChange(!!c)} />
      </div>
      <span className={cn('font-mono font-bold tabular-nums', amount === undefined && 'font-sans font-medium italic text-muted-foreground/70')}>
        {amount === undefined ? 'Not configured' : formatINR(amount)}
      </span>
    </label>
  )
}

export function FlatToggle({ icon: Icon, label, desc, amount, checked, onChange }: { icon: React.ElementType; label: string; desc: string; amount: number; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className={cn('p-3 rounded-xl border text-xs cursor-pointer transition-all flex items-center justify-between gap-2', checked ? 'border-emerald-500/40 bg-emerald-500/10' : 'border-border bg-muted/20 hover:border-primary/40')}>
      <div className="flex items-center gap-2 min-w-0">
        <div className={cn('flex h-8 w-8 items-center justify-center rounded-lg shrink-0', checked ? 'bg-emerald-500/15 text-emerald-600' : 'bg-muted text-muted-foreground')}>
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <p className="font-semibold truncate">{label}</p>
          <p className="text-[10px] text-muted-foreground truncate">{desc} · {formatINR(amount)}</p>
        </div>
      </div>
      <Checkbox checked={checked} onCheckedChange={(c) => onChange(!!c)} />
    </label>
  )
}

/* Cart row — checkbox + title + price + quantity stepper */
export function CartRow({
  title, subtitle, price, qty, selected, onToggle, onQtyChange,
}: CartRowProps) {
  return (
    <div className={cn(
      'flex items-center gap-3 rounded-xl border p-2.5 transition-all',
      selected ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-border bg-muted/20 hover:border-primary/30'
    )}>
      <Checkbox checked={selected} onCheckedChange={onToggle} />
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium truncate">{title}</p>
        <p className="text-[10px] text-muted-foreground truncate">{subtitle}</p>
      </div>
      <span className="font-mono text-xs font-bold tabular-nums shrink-0">{formatINR(price)}</span>
      {selected && (
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => onQtyChange(Math.max(1, qty - 1))}
            className="flex h-6 w-6 items-center justify-center rounded-md border border-border bg-background hover:bg-accent transition-colors"
          >
            <Minus className="h-3 w-3" />
          </button>
          <span className="font-mono text-xs font-bold tabular-nums w-6 text-center">{qty}</span>
          <button
            type="button"
            onClick={() => onQtyChange(qty + 1)}
            className="flex h-6 w-6 items-center justify-center rounded-md border border-border bg-background hover:bg-accent transition-colors"
          >
            <Plus className="h-3 w-3" />
          </button>
        </div>
      )}
    </div>
  )
}
