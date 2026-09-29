'use client'

/**
 * movement-panels — Stock movement log, low-stock alerts, category value
 * distribution.
 *
 * Three exports:
 *   - StockMovementLog  — recent stock movements table (item, qty, type,
 *                         date, user, reason, reference)
 *   - LowStockAlerts    — low + out of stock list with current/min/
 *                         suggested reorder
 *   - CategoryValueDistribution — horizontal bars from analytics.valueByCategory
 *
 * All state from inventory-store + useInventoryData analytics.
 */

import { motion } from 'framer-motion'
import {
  AlertTriangle, TrendingUp, RefreshCw, Package,
  ArrowDownRight, ArrowUpRight, ArrowRightLeft,
  History,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from '@/components/ui/table'
import { useInventoryStore, useInventoryData } from '@/lib/store/inventory-store'
import type { InventoryItem, MovementType } from '@/lib/store/inventory-store'
import { formatINR, formatDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import { InvPanel, InvEmptyState, ItemStatusBadge, MovementTypeBadge } from './inventory-shared'
import { EnterpriseDonut } from '@/components/shared/enterprise-donut'

// ─── Movement icon + sign helper ────────────────────────────────────

const MOVEMENT_SIGN: Record<MovementType, '+' | '−' | '·'> = {
  'Stock In': '+',
  'Returned': '+',
  'Stock Out': '−',
  'Issued': '−',
  'Damaged': '−',
  'Lost': '−',
  'Adjustment': '·',
}

const MOVEMENT_ICON: Record<MovementType, React.ReactNode> = {
  'Stock In': <ArrowDownRight className="h-3.5 w-3.5" />,
  'Returned': <RefreshCw className="h-3.5 w-3.5" />,
  'Issued': <ArrowUpRight className="h-3.5 w-3.5" />,
  'Stock Out': <ArrowUpRight className="h-3.5 w-3.5" />,
  'Damaged': <AlertTriangle className="h-3.5 w-3.5" />,
  'Lost': <AlertTriangle className="h-3.5 w-3.5" />,
  'Adjustment': <ArrowRightLeft className="h-3.5 w-3.5" />,
}

// Neutral icon chip — the movement SEMANTICS (in/out sign + colour) already
// live in the badge and the qty column, so the chip stays quiet.
const MOVEMENT_CHIP = 'bg-muted/50 text-muted-foreground ring-1 ring-border/60'

// ─── StockMovementLog ───────────────────────────────────────────────

export function StockMovementLog({ limit }: { limit?: number }) {
  const movements = useInventoryStore((s) => s.movements)
  const rows = limit ? movements.slice(0, limit) : movements

  return (
    <InvPanel
      title="Stock Movement Log"
      subtitle={`${movements.length} recorded movements`}
      bodyClassName="p-0"
    >
      {rows.length === 0 ? (
        <InvEmptyState
          icon={<History className="h-5 w-5" />}
          title="No movements yet"
          description="Stock in, issue, damage and return actions will appear here."
        />
      ) : (
        <div className="overflow-x-auto">
          <Table className="[&_td]:py-3">
            <TableHeader>
              <TableRow className="bg-muted/40">
                <TableHead className="font-semibold text-[10px] uppercase tracking-wider">Type</TableHead>
                <TableHead className="font-semibold text-[10px] uppercase tracking-wider">Item</TableHead>
                <TableHead className="font-semibold text-[10px] uppercase tracking-wider text-center">Qty</TableHead>
                <TableHead className="font-semibold text-[10px] uppercase tracking-wider hidden md:table-cell">User</TableHead>
                <TableHead className="font-semibold text-[10px] uppercase tracking-wider hidden sm:table-cell">Date</TableHead>
                <TableHead className="font-semibold text-[10px] uppercase tracking-wider hidden lg:table-cell">Reason</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((m, i) => {
                const sign = MOVEMENT_SIGN[m.type]
                return (
                  <motion.tr
                    key={m.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: i * 0.02 }}
                    className="hover:bg-accent/30 transition-colors"
                  >
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded-md', MOVEMENT_CHIP)}>
                          {MOVEMENT_ICON[m.type]}
                        </div>
                        <MovementTypeBadge type={m.type} />
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="min-w-0 max-w-[220px]">
                        <p className="font-medium text-sm truncate">{m.itemName}</p>
                        {m.reference && (
                          <p className="text-[11px] text-muted-foreground truncate">→ {m.reference}</p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-center">
                      <span className={cn(
                        'font-bold text-sm tabular-nums',
                        sign === '+' ? 'text-emerald-600' : sign === '−' ? 'text-rose-600' : 'text-muted-foreground',
                      )}>
                        {sign}{m.quantity}
                      </span>
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-xs text-muted-foreground">{m.user}</TableCell>
                    <TableCell className="hidden sm:table-cell text-xs text-muted-foreground tabular-nums">{formatDate(m.date)}</TableCell>
                    <TableCell className="hidden lg:table-cell text-xs text-muted-foreground max-w-[260px] truncate">{m.reason}</TableCell>
                  </motion.tr>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </InvPanel>
  )
}

// ─── LowStockAlerts ─────────────────────────────────────────────────

interface LowStockAlertsProps {
  onAddStock: (item: InventoryItem) => void
}

export function LowStockAlerts({ onAddStock }: LowStockAlertsProps) {
  const data = useInventoryData()
  const lowStock = data.analytics.lowStock
  const outOfStock = data.analytics.outOfStock
  const all = [...outOfStock, ...lowStock]

  // Suggested reorder = min(2 × minStock, 50) — practical heuristic.
  const suggested = (it: InventoryItem) => Math.max(it.minStock * 2, 10)

  return (
    <InvPanel
      title="Low Stock Alerts"
      subtitle={`${lowStock.length} low stock · ${outOfStock.length} out of stock`}
      action={<ItemStatusBadge status="Out of Stock" />}
      bodyClassName="p-0"
    >
      {all.length === 0 ? (
        <InvEmptyState
          icon={<Package className="h-5 w-5" />}
          title="All items well stocked"
          description="No items are below their minimum stock threshold."
        />
      ) : (
        <div className="max-h-96 overflow-y-auto p-1">
          <div className="space-y-2 px-1 py-1">
            {all.map((it, i) => {
              const out = it.status === 'Out of Stock'
              const ratio = it.minStock > 0 ? Math.min(100, Math.round((it.quantity / it.minStock) * 100)) : 0
              return (
                <motion.div
                  key={it.id}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.05 }}
                  className={cn(
                    'rounded-xl border bg-card p-3.5',
                    out ? 'border-rose-500/30' : 'border-amber-500/30',
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-sm truncate">{it.name}</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                        {it.category} · {it.location}
                      </p>
                    </div>
                    <ItemStatusBadge status={it.status} />
                  </div>
                  <div className="grid grid-cols-3 gap-2 mt-2.5">
                    <div>
                      <p className="text-[9px] uppercase font-semibold text-muted-foreground tracking-wider">Current</p>
                      <p className={cn('text-sm font-bold tabular-nums', out ? 'text-rose-600' : 'text-amber-600')}>
                        {it.quantity} <span className="text-[10px] font-normal text-muted-foreground">{it.unit}</span>
                      </p>
                    </div>
                    <div>
                      <p className="text-[9px] uppercase font-semibold text-muted-foreground tracking-wider">Min Stock</p>
                      <p className="text-sm font-bold tabular-nums text-muted-foreground">
                        {it.minStock} <span className="text-[10px] font-normal text-muted-foreground">{it.unit}</span>
                      </p>
                    </div>
                    <div>
                      <p className="text-[9px] uppercase font-semibold text-muted-foreground tracking-wider">Suggested</p>
                      <p className="text-sm font-bold tabular-nums text-emerald-700 dark:text-emerald-300">
                        {suggested(it)} <span className="text-[10px] font-normal text-muted-foreground">{it.unit}</span>
                      </p>
                    </div>
                  </div>
                  <div className="mt-2.5 flex items-center gap-2">
                    <div className="flex-1 h-1.5 rounded-full bg-muted/60 overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${ratio}%` }}
                        transition={{ duration: 0.5, delay: i * 0.05 }}
                        className={cn('h-full rounded-full', out ? 'bg-rose-500' : 'bg-amber-500')}
                      />
                    </div>
                    <span className="text-[10px] font-semibold tabular-nums text-muted-foreground w-9 text-right">{ratio}%</span>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full mt-2.5 text-xs h-7 gap-1.5 bg-card hover:bg-emerald-500/5 hover:border-emerald-500/40 hover:text-emerald-700"
                    onClick={() => onAddStock(it)}
                  >
                    <RefreshCw className="h-3 w-3" /> Add Stock ({suggested(it)} {it.unit})
                  </Button>
                </motion.div>
              )
            })}
          </div>
        </div>
      )}
    </InvPanel>
  )
}

// ─── CategoryValueDistribution ──────────────────────────────────────

export function CategoryValueDistribution() {
  const data = useInventoryData()
  const cats = data.analytics.valueByCategory
  const total = cats.reduce((s, c) => s + c.value, 0)
  const _max = Math.max(1, ...cats.map((c) => c.value))
  const sorted = [...cats].sort((a, b) => b.value - a.value)

  return (
    <InvPanel
      title="Category Value Distribution"
      subtitle={`${cats.length} categories · ${formatINR(total, true)} total`}
      bodyClassName="p-4"
    >
      <EnterpriseDonut
        data={sorted.map((c) => ({ name: c.name, value: c.value }))}
        centerValue={formatINR(total, true)}
        centerLabel="Total Value"
        formatValue={(n) => formatINR(n, true)}
      />
    </InvPanel>
  )
}

// ─── InventoryReports (combined for the Reports tab) ────────────────

export function InventoryReports() {
  const movements = useInventoryStore((s) => s.movements)

  // Movement type breakdown
  const byType: Array<{ type: MovementType; count: number; qty: number }> = []
  movements.forEach((m) => {
    const found = byType.find((b) => b.type === m.type)
    if (found) {
      found.count += 1
      found.qty += m.quantity
    } else {
      byType.push({ type: m.type, count: 1, qty: m.quantity })
    }
  })
  byType.sort((a, b) => b.count - a.count)

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <CategoryValueDistribution />
        <InvPanel
          title="Movements by Type"
          subtitle={`${movements.length} movements recorded`}
          bodyClassName="p-0"
        >
          {byType.length === 0 ? (
            <InvEmptyState icon={<TrendingUp className="h-5 w-5" />} title="No movement data yet" />
          ) : (
            <div className="overflow-x-auto">
              <Table className="[&_td]:py-2.5">
                <TableHeader>
                  <TableRow className="bg-muted/40">
                    <TableHead className="font-semibold text-[10px] uppercase tracking-wider">Type</TableHead>
                    <TableHead className="font-semibold text-[10px] uppercase tracking-wider text-center">Count</TableHead>
                    <TableHead className="font-semibold text-[10px] uppercase tracking-wider text-right">Total Qty</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {byType.map((b) => (
                    <TableRow key={b.type} className="hover:bg-accent/30 transition-colors">
                      <TableCell><MovementTypeBadge type={b.type} /></TableCell>
                      <TableCell className="text-center font-semibold tabular-nums">{b.count}</TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">{b.qty}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </InvPanel>
      </div>
    </div>
  )
}
