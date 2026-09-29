'use client'

/**
 * items-table — Inventory items table with search + filters + per-row actions.
 *
 * Filters: search (name/code), category, location, status — all backed by the
 * inventory-store selectors so the filter state is shared with the rest of
 * the workspace.
 *
 * Per-row action menu: Add Stock · Issue / Assign · Damaged · Return — all
 * wired to store mutations via callbacks passed from the parent (so the
 * parent owns the dialog state and toasts).
 */

import { motion } from 'framer-motion'
import { Package, Search, MapPin, MoreVertical, Plus, ArrowUpCircle, AlertTriangle, RotateCcw, Pen, Trophy, Armchair, FlaskConical, Monitor } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from '@/components/ui/table'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import { useInventoryStore } from '@/lib/store/inventory-store'
import type { InventoryItem, ItemCategory, StockLocation } from '@/lib/store/inventory-store'
import { formatINR } from '@/lib/format'
import { cn } from '@/lib/utils'
import { InvPanel, InvEmptyState, ItemStatusBadge } from './inventory-shared'

const CATEGORIES: Array<ItemCategory | 'all'> = ['all', 'Furniture', 'Stationery', 'Lab Equipment', 'Sports', 'Electronics', 'Cleaning', 'IT Equipment']
const LOCATIONS: Array<StockLocation | 'all'> = ['all', 'Store Room A', 'Store Room B', 'Science Lab', 'Computer Lab', 'Sports Room', 'Library', 'Office']
const STATUSES: Array<{ value: string; label: string }> = [
  { value: 'all', label: 'All Status' },
  { value: 'In Stock', label: 'In Stock' },
  { value: 'Low Stock', label: 'Low Stock' },
  { value: 'Out of Stock', label: 'Out of Stock' },
]

type ActionKind = 'add' | 'issue' | 'damaged' | 'return'

// Distinct icon per category — monochrome outline glyphs in a neutral
// chip. The glyph aids scanning; the STATUS colour lives in the badge and
// the qty number, so the icon never double-codes state.
function categoryIcon(category: string, className: string) {
  switch (category) {
    case 'Stationery': return <Pen className={className} />
    case 'Sports': return <Trophy className={className} />
    case 'Furniture': return <Armchair className={className} />
    case 'Lab Equipment': return <FlaskConical className={className} />
    case 'Electronics': return <Monitor className={className} />
    case 'IT Equipment': return <Monitor className={className} />
    case 'Cleaning': return <Package className={className} />
    default: return <Package className={className} />
  }
}

interface ItemsTableProps {
  onAction: (kind: ActionKind, item: InventoryItem) => void
}

export function ItemsTable({ onAction }: ItemsTableProps) {
  const items = useInventoryStore((s) => s.items)
  const search = useInventoryStore((s) => s.search)
  const categoryFilter = useInventoryStore((s) => s.categoryFilter)
  const locationFilter = useInventoryStore((s) => s.locationFilter)
  const statusFilter = useInventoryStore((s) => s.statusFilter)
  const setSearch = useInventoryStore((s) => s.setSearch)
  const setCategoryFilter = useInventoryStore((s) => s.setCategoryFilter)
  const setLocationFilter = useInventoryStore((s) => s.setLocationFilter)
  const setStatusFilter = useInventoryStore((s) => s.setStatusFilter)

  const filtered = items.filter((it) => {
    const q = search.trim().toLowerCase()
    const matchSearch = !q
      || it.name.toLowerCase().includes(q)
      || it.code.toLowerCase().includes(q)
    const matchCat = categoryFilter === 'all' || it.category === categoryFilter
    const matchLoc = locationFilter === 'all' || it.location === locationFilter
    const matchStatus = statusFilter === 'all' || it.status === statusFilter
    return matchSearch && matchCat && matchLoc && matchStatus
  })

  return (
    <InvPanel
      title="Inventory Items"
      subtitle={`${filtered.length} of ${items.length} items`}
      action={
        <div className="flex items-center gap-1.5 flex-wrap w-full sm:w-auto sm:justify-end">
          <div className="relative min-w-0 flex-1 sm:flex-none sm:w-48">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Name or code"
              className="pl-8 h-8 w-full sm:w-48 text-xs"
            />
          </div>
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="flex-1 sm:flex-none sm:w-32 h-8 text-xs" aria-label="Filter by category"><SelectValue /></SelectTrigger>
            <SelectContent>
              {CATEGORIES.map((c) => (
                <SelectItem key={c} value={c}>{c === 'all' ? 'All Categories' : c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={locationFilter} onValueChange={setLocationFilter}>
            <SelectTrigger className="w-32 h-8 text-xs hidden sm:flex" aria-label="Filter by location"><SelectValue /></SelectTrigger>
            <SelectContent>
              {LOCATIONS.map((l) => (
                <SelectItem key={l} value={l}>{l === 'all' ? 'All Locations' : l}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-28 h-8 text-xs hidden md:flex" aria-label="Filter by status"><SelectValue /></SelectTrigger>
            <SelectContent>
              {STATUSES.map((s) => (
                <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      }
      bodyClassName="p-0"
    >
      {filtered.length === 0 ? (
        <InvEmptyState
          icon={<Package className="h-5 w-5" />}
          title="No items found"
          description="Try adjusting your search or filters."
        />
      ) : (
        <div className="overflow-x-auto">
          <Table className="[&_td]:py-3">
            <TableHeader>
              <TableRow className="bg-muted/40">
                <TableHead className="font-semibold text-[10px] uppercase tracking-wider">Item</TableHead>
                <TableHead className="font-semibold text-[10px] uppercase tracking-wider hidden sm:table-cell">Category</TableHead>
                <TableHead className="font-semibold text-[10px] uppercase tracking-wider text-center">Stock</TableHead>
                <TableHead className="font-semibold text-[10px] uppercase tracking-wider text-right hidden lg:table-cell">Min</TableHead>
                <TableHead className="font-semibold text-[10px] uppercase tracking-wider text-right">Value</TableHead>
                <TableHead className="font-semibold text-[10px] uppercase tracking-wider hidden md:table-cell">Location</TableHead>
                <TableHead className="font-semibold text-[10px] uppercase tracking-wider">Status</TableHead>
                <TableHead className="font-semibold text-[10px] uppercase tracking-wider text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((it, i) => {
                const outOfStock = it.status === 'Out of Stock'
                const lowStock = it.status === 'Low Stock'
                return (
                  <motion.tr
                    key={it.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: i * 0.02 }}
                    className="hover:bg-accent/30 transition-colors"
                  >
                    <TableCell>
                      <div className="flex items-center gap-2.5">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/40 text-muted-foreground">
                          {categoryIcon(it.category, 'h-4 w-4')}
                        </div>
                        <div className="min-w-0 max-w-[260px]">
                          <p className="font-medium text-sm truncate">{it.name}</p>
                          <p className="text-[11px] text-muted-foreground truncate font-mono">{it.code}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      <Badge variant="outline" className="text-[10px] font-medium">{it.category}</Badge>
                    </TableCell>
                    <TableCell className="text-center">
                      <div className="inline-flex flex-col items-center leading-tight">
                        <span className={cn(
                          'font-semibold text-sm tabular-nums',
                          outOfStock ? 'text-rose-600' : lowStock ? 'text-amber-600' : 'text-foreground',
                        )}>{it.quantity}</span>
                        <span className="text-[10px] text-muted-foreground">{it.unit}</span>
                      </div>
                    </TableCell>
                    <TableCell className="hidden lg:table-cell text-right text-xs text-muted-foreground tabular-nums">
                      {it.minStock}
                    </TableCell>
                    <TableCell className="text-right text-sm font-medium tabular-nums whitespace-nowrap">
                      {formatINR(it.totalValue, true)}
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-xs text-muted-foreground">
                      <span className="flex items-center gap-1"><MapPin className="h-3 w-3" /> {it.location}</span>
                    </TableCell>
                    <TableCell><ItemStatusBadge status={it.status} /></TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button size="sm" variant="ghost" className="h-7 w-7 p-0">
                              <MoreVertical className="h-3.5 w-3.5" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-44">
                            <DropdownMenuItem onClick={() => onAction('add', it)}>
                              <Plus className="h-3.5 w-3.5 mr-2" /> Add Stock
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => onAction('issue', it)}
                              disabled={outOfStock}
                            >
                              <ArrowUpCircle className="h-3.5 w-3.5 mr-2" /> Issue / Assign
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => onAction('damaged', it)}
                              disabled={outOfStock}
                            >
                              <AlertTriangle className="h-3.5 w-3.5 mr-2" /> Mark Damaged
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => onAction('return', it)}>
                              <RotateCcw className="h-3.5 w-3.5 mr-2" /> Return Stock
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </TableCell>
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
