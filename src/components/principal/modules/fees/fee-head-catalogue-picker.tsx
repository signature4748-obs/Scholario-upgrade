'use client'

/**
 * FeeHeadCataloguePicker — Phase 6 feature.
 *
 * A Popover-based combobox that lists every NON-archived master fee-head
 * catalogue entry (from school-settings-store.fees.feeHeads) and lets the
 * principal pick one to prefill a per-structure FeeHead draft.
 *
 * Why this exists (brief sections 9 + 24):
 *   - Before: the Add-Head form in fees-structures-detail.tsx had a plain
 *     text input with placeholder "Fee head name". A principal could type
 *     "Tuition Fee" or "Tuition fee" or "tution" and create three different
 *     per-structure heads, none linked to the master catalogue — which
 *     breaks the catalogue's "X structures use this head" count and
 *     prevents the school-wide defaults from propagating.
 *   - After: the picker lists every catalogue entry with its category
 *     icon, frequency badge, default amount, and GST indicator. Picking
 *     one prefills name + amount + frequency + category + isTaxable +
 *     taxRate fields. The principal can still opt out and type a custom
 *     name (a visible "Custom head (not in catalogue)" indicator makes
 *     the cost of opting out obvious).
 *
 * UX:
 *   - Trigger button: chip-style when a catalogue entry is selected
 *     (category icon + name + "From catalogue" pill), placeholder when
 *     vacant.
 *   - PopoverContent: search input + filter-by-category chip row +
 *     scrollable list of catalogue entries + footer with "+ Add new to
 *     catalogue" shortcut + "Type custom name instead" toggle.
 *
 * All mutations go through the parent (onPick callback). The picker is
 * fully controlled — it holds no state beyond the open/search UI state.
 */

import * as React from 'react'
import { motion } from 'framer-motion'
import {
  ChevronDown, Search, Check, Layers, Plus, Type, AlertCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { useSchoolSettingsStore, deriveFeeHeadKind, type FeeHeadConfig } from '@/lib/store/school-settings-store'
import {
  CATEGORY_ICONS,
  CATEGORY_CHIPS,
  CATEGORY_ORDER,
  normalizeCatalogueFrequency,
  CategoryBadge,
  FrequencyBadge,
  GstBadge,
  AmountBadge,
} from './fees-catalogue-shared'
import type { FeeHead, FeeHeadCategory } from '@/lib/store/fee-store'

export interface CataloguePickResult {
  /** The picked catalogue entry id (becomes FeeHead.catalogueId). */
  catalogueId: string
  /** Prefilled name (catalogue entry name). */
  name: string
  /** Prefilled amount (catalogue entry defaultAmount). */
  amount: number
  /** Prefilled frequency (normalized to FeeHead.frequency vocabulary). */
  frequency: FeeHead['frequency']
  /** Prefilled category (catalogue entry type). */
  category: FeeHeadCategory
  /** Prefilled isTaxable (catalogue entry isTaxable, default false). */
  isTaxable?: boolean
  /** Prefilled taxRate (catalogue entry taxRate, default 18). */
  taxRate?: number
}

export interface FeeHeadCataloguePickerProps {
  /** Currently-picked catalogue id (controlled). Empty string = no pick. */
  selectedCatalogueId: string
  /** Called when the user picks an entry from the dropdown. */
  onPick: (result: CataloguePickResult) => void
  /** Called when the user clicks the "Type custom name instead" toggle. */
  onUseCustom?: () => void
  /** Called when the user clicks "+ Add new to catalogue". */
  onAddToCatalogue?: () => void
  /** Stable id to keep the search Input stable across rerenders. */
  pickerId?: string
  /** Trigger width class. */
  className?: string
  /** Optional filter — only show entries matching this category. */
  filterCategory?: FeeHeadCategory | 'all'
  /** Optional label for the empty state. */
  emptyStateLabel?: string
}

export function FeeHeadCataloguePicker({
  selectedCatalogueId,
  onPick,
  onUseCustom,
  onAddToCatalogue,
  pickerId = 'fee-head-catalogue',
  className,
  filterCategory = 'all',
  emptyStateLabel = 'No catalogue entries match.',
}: FeeHeadCataloguePickerProps) {
  const feeHeads = useSchoolSettingsStore((s) => s.fees.feeHeads)
  const [open, setOpen] = React.useState(false)
  const [search, setSearch] = React.useState('')
  const [localFilter, setLocalFilter] = React.useState<FeeHeadCategory | 'all'>(filterCategory)

  // Sync external filter prop → local state (when parent forces a filter).
  React.useEffect(() => {
    setLocalFilter(filterCategory)
  }, [filterCategory])

  const selected = React.useMemo(
    () => feeHeads.find((h) => h.id === selectedCatalogueId),
    [feeHeads, selectedCatalogueId],
  )

  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase()
    return feeHeads.filter((h) => {
      // Hide archived entries — they shouldn't appear in the picker for
      // NEW heads (existing structures keep their snapshot — versioning
      // integrity preserved per the master catalogue's contract).
      if (h.archived) return false
      // ADDITIONAL templates never belong in a class's annual fee
      // structure — event-based collections are created as Additional
      // Charges from the Payments page instead (spec Part 9).
      if (deriveFeeHeadKind(h) === 'ADDITIONAL') return false
      if (localFilter !== 'all' && h.type !== localFilter) return false
      if (!q) return true
      if (!h.name.toLowerCase().includes(q)) {
        const desc = (h.description ?? '').toLowerCase()
        if (!desc.includes(q)) return false
      }
      return true
    })
  }, [feeHeads, localFilter, search])

  const handleSelect = (h: FeeHeadConfig) => {
    onPick({
      catalogueId: h.id,
      name: h.name,
      amount: h.defaultAmount,
      frequency: normalizeCatalogueFrequency(h.frequency),
      category: h.type,
      isTaxable: h.isTaxable ?? false,
      taxRate: h.taxRate ?? 18,
    })
    setOpen(false)
    setSearch('')
  }

  // Trigger button: chip-style when selected, placeholder when vacant.
  const trigger = selected ? (
    <div className={cn(
      'flex items-center justify-between w-full gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/5 hover:border-emerald-500/60 hover:bg-emerald-500/10 transition-colors text-left px-2.5 h-7',
      className,
    )}>
      <div className="flex items-center gap-1.5 min-w-0">
        {(() => {
          const Icon = CATEGORY_ICONS[selected.type] ?? Layers
          return <Icon className="h-3 w-3 shrink-0 text-emerald-700 dark:text-emerald-300" />
        })()}
        <p className="text-[11px] font-medium text-foreground truncate leading-tight">{selected.name}</p>
        <span className="text-[8px] text-emerald-700 dark:text-emerald-300 font-medium shrink-0">
          · from catalogue
        </span>
      </div>
      <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />
    </div>
  ) : (
    <div className={cn(
      'flex items-center justify-between w-full h-7 px-2.5 rounded-md border border-border bg-card text-[11px] text-muted-foreground hover:border-primary/40 transition-colors',
      className,
    )}>
      <span className="flex items-center gap-1.5">
        <Layers className="h-3 w-3" /> Pick from catalogue…
      </span>
      <ChevronDown className="h-3 w-3" />
    </div>
  )

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className="block w-full text-left">{trigger}</button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="start" sideOffset={4}>
        {/* Search input */}
        <div className="p-2 border-b border-border">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              key={`search-input-${pickerId}`}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search catalogue (name or description)…"
              className="pl-8 h-8 text-xs bg-card"
              autoFocus
            />
          </div>
        </div>

        {/* Category filter chip row */}
        <div className="px-2 py-1.5 border-b border-border flex items-center gap-1 overflow-x-auto">
          <button
            type="button"
            onClick={() => setLocalFilter('all')}
            className={cn(
              'shrink-0 text-[9px] px-1.5 py-0.5 rounded-full transition-colors',
              localFilter === 'all'
                ? 'bg-foreground text-background'
                : 'bg-muted text-muted-foreground hover:bg-muted/80',
            )}
          >
            All
          </button>
          {CATEGORY_ORDER.map((cat) => {
            const Icon = CATEGORY_ICONS[cat]
            const chip = CATEGORY_CHIPS[cat]
            return (
              <button
                key={cat}
                type="button"
                onClick={() => setLocalFilter(cat)}
                title={`Filter by ${cat}`}
                className={cn(
                  'shrink-0 inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded-full transition-all',
                  localFilter === cat
                    ? cn(chip, 'ring-1 font-medium')
                    : 'bg-muted text-muted-foreground hover:bg-muted/80',
                )}
              >
                <Icon className="h-2.5 w-2.5" /> {cat}
              </button>
            )
          })}
        </div>

        {/* Catalogue entries list */}
        <div className="max-h-64 overflow-y-auto divide-y divide-border/30">
          {filtered.length === 0 ? (
            <div className="px-3 py-6 text-center">
              <AlertCircle className="h-4 w-4 text-muted-foreground mx-auto mb-1.5" />
              <p className="text-[11px] text-muted-foreground">{emptyStateLabel}</p>
            </div>
          ) : (
            filtered.map((h) => {
              const Icon = CATEGORY_ICONS[h.type] ?? Layers
              const chip = CATEGORY_CHIPS[h.type] ?? CATEGORY_CHIPS.Other
              const isSelected = h.id === selectedCatalogueId
              return (
                <motion.button
                  key={h.id}
                  type="button"
                  whileHover={{ x: 2 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                  onClick={() => handleSelect(h)}
                  className={cn(
                    'w-full px-2.5 py-2 flex items-start gap-2 text-left hover:bg-muted/40 transition-colors',
                    isSelected && 'bg-emerald-500/5',
                  )}
                >
                  <div className={cn(
                    'flex h-7 w-7 shrink-0 items-center justify-center rounded-md ring-1 mt-0.5',
                    chip,
                  )}>
                    <Icon className="h-3.5 w-3.5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1 flex-wrap">
                      <p className="text-xs font-medium text-foreground truncate leading-tight">{h.name}</p>
                      {isSelected && (
                        <span className="text-[9px] text-emerald-600 font-medium shrink-0 inline-flex items-center gap-0.5">
                          <Check className="h-2.5 w-2.5" /> Selected
                        </span>
                      )}
                    </div>
                    {h.description && (
                      <p className="text-[10px] text-muted-foreground leading-tight mt-0.5 line-clamp-2 italic border-l-2 border-muted-foreground/20 pl-1.5">
                        {h.description}
                      </p>
                    )}
                    <div className="flex items-center gap-1 flex-wrap mt-1">
                      <CategoryBadge category={h.type} withIcon={false} />
                      <FrequencyBadge frequency={h.frequency} />
                      {h.isTaxable && <GstBadge isTaxable taxRate={h.taxRate} />}
                      <AmountBadge amount={h.defaultAmount} />
                    </div>
                  </div>
                </motion.button>
              )
            })
          )}
        </div>

        {/* Footer: custom head + add to catalogue */}
        <div className="border-t border-border bg-muted/30 p-1.5 flex items-center gap-1">
          {onUseCustom && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 text-[10px] gap-1 flex-1 justify-start text-amber-700 dark:text-amber-300 hover:bg-amber-500/10"
              onClick={() => {
                onUseCustom()
                setOpen(false)
              }}
            >
              <Type className="h-3 w-3" /> Type custom name instead
            </Button>
          )}
          {onAddToCatalogue && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 text-[10px] gap-1 flex-1 justify-start text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/10"
              onClick={() => {
                onAddToCatalogue()
                setOpen(false)
              }}
            >
              <Plus className="h-3 w-3" /> Add new to catalogue
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
