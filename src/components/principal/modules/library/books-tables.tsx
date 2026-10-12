'use client'

/**
 * books-tables — Book catalogue + Issued/Overdue tables.
 *
 * Catalogue:
 *   - SearchFilterBar above the panel (3 facets: search + Category +
 *     Availability — the shared pattern for 2-3 facet surfaces, same as the
 *     Students directory; stacks vertically below sm).
 *   - Availability column: primary available count + muted "of N" copies +
 *     a thin h-1.5 utilization bar (emerald >30% free, amber low, rose 0).
 *   - Filters combine: search (title/author/ISBN) + category + availability.
 *   - Empty state distinguishes an empty catalogue from filters that match
 *     nothing, with a "Clear filters" action.
 *
 * IssuedBooksTable: shows currently issued (status !== Returned) with
 * Return action (+ Remind for overdue rows). Doubles as Overdue table
 * when filter='overdue'.
 *
 * Tables carry a min-width so on narrow screens they scroll INSIDE the
 * panel (same recipe as the fees module tables) — the page itself never
 * overflows horizontally. Row action buttons grow to h-9 on touch
 * screens (≥36px targets) and stay compact (h-7) from md up.
 *
 * Remind + Return actions render for every overdue row (both the Issued
 * tab, where overdue loans sit alongside on-schedule ones, and the
 * Overdue tab).
 *
 * State from library-store (no mock data here).
 */

import { motion } from 'framer-motion'
import { BookMarked, RotateCcw, Send, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from '@/components/ui/table'
import { useLibraryStore, useEffectiveLibraryBooks, useEffectiveLibraryIssues } from '@/lib/store/library-store'
import type { Book, IssueRecord, BookCategory } from '@/lib/store/library-store'
import { formatDate, formatINR, initials } from '@/lib/format'
import { cn } from '@/lib/utils'
import { GradientAvatar } from '@/components/shared/ui'
import { SearchFilterBar } from '../shared/search-filter-bar'
import { LibPanel, LibEmptyState, BookStatusBadge, IssueStatusBadge, BorrowerTypePill } from './library-shared'

const CATEGORIES: Array<BookCategory | 'all'> = ['all', 'Fiction', 'Reference', 'Textbooks', 'Story Books', 'Biography', 'Magazines', 'Science']
const AVAILABILITY: Array<{ value: string; label: string }> = [
  { value: 'all', label: 'All Availability' },
  { value: 'available', label: 'Available' },
  { value: 'low', label: 'Low Stock' },
  { value: 'out', label: 'Out of Stock' },
]

/** Utilization bar tone: emerald when >30% of copies are free, amber when
 *  running low, rose when nothing is available. */
function availabilityBar(available: number, copies: number): string {
  if (available <= 0) return 'bg-rose-500'
  if (copies > 0 && available / copies > 0.3) return 'bg-emerald-500/80'
  return 'bg-amber-500/80'
}

// ─── BooksCatalogue ─────────────────────────────────────────────────

export function BooksCatalogue({ onIssueBook }: { onIssueBook: (book: Book) => void }) {
  const books = useEffectiveLibraryBooks()
  const search = useLibraryStore((s) => s.search)
  const categoryFilter = useLibraryStore((s) => s.categoryFilter)
  const availabilityFilter = useLibraryStore((s) => s.availabilityFilter)
  const setSearch = useLibraryStore((s) => s.setSearch)
  const setCategoryFilter = useLibraryStore((s) => s.setCategoryFilter)
  const setAvailabilityFilter = useLibraryStore((s) => s.setAvailabilityFilter)

  const filtered = books.filter((b) => {
    const q = search.trim().toLowerCase()
    const matchSearch = !q
      || b.title.toLowerCase().includes(q)
      || b.author.toLowerCase().includes(q)
      || b.isbn.toLowerCase().includes(q)
    const matchCat = categoryFilter === 'all' || b.category === categoryFilter
    const matchAvail = availabilityFilter === 'all'
      || (availabilityFilter === 'available' && b.status === 'Available')
      || (availabilityFilter === 'low' && b.status === 'Low Stock')
      || (availabilityFilter === 'out' && b.status === 'Out of Stock')
    return matchSearch && matchCat && matchAvail
  })

  const activeFilterCount = (categoryFilter !== 'all' ? 1 : 0) + (availabilityFilter !== 'all' ? 1 : 0)
  const hasAnyFilter = search.trim() !== '' || activeFilterCount > 0
  const resetFilters = () => {
    setSearch('')
    setCategoryFilter('all')
    setAvailabilityFilter('all')
  }

  return (
    <div className="space-y-3">
      {/* Filter bar — search + category + availability, combined above.
          3 facets → shared SearchFilterBar (Students-directory pattern):
          one row on sm+, stacked full-width controls on mobile. */}
      <SearchFilterBar
        search={search}
        onSearchChange={setSearch}
        placeholder="Title, author, ISBN…"
        filters={[
          {
            id: 'category',
            value: categoryFilter,
            onChange: setCategoryFilter,
            placeholder: 'All Categories',
            options: CATEGORIES.map((c) => ({ value: c, label: c === 'all' ? 'All Categories' : c })),
          },
          {
            id: 'availability',
            value: availabilityFilter,
            onChange: setAvailabilityFilter,
            placeholder: 'All Availability',
            options: AVAILABILITY,
          },
        ]}
      />

      <LibPanel
        title="Book Catalogue"
        subtitle={`${filtered.length} of ${books.length} books`}
        bodyClassName="p-0"
      >
        {filtered.length === 0 ? (
          <LibEmptyState
            icon={<BookMarked className="h-5 w-5" />}
            title={books.length === 0 ? 'No books in the catalogue yet' : 'No books match your filters'}
            description={books.length === 0
              ? 'Books added to the library will appear here.'
              : 'Try a different search term, or clear the filters to see the full catalogue.'}
            action={books.length > 0 && hasAnyFilter ? (
              <Button
                variant="outline"
                size="sm"
                className="h-9 text-xs gap-1.5"
                onClick={resetFilters}
              >
                <X className="h-3.5 w-3.5" /> Clear filters
              </Button>
            ) : undefined}
          />
        ) : (
          <Table className="min-w-[34rem]">
            <TableHeader>
              <TableRow className="bg-muted/40">
                <TableHead className="font-semibold text-[10px] uppercase tracking-wider">Book</TableHead>
                <TableHead className="font-semibold text-[10px] uppercase tracking-wider hidden md:table-cell">ISBN</TableHead>
                <TableHead className="font-semibold text-[10px] uppercase tracking-wider hidden sm:table-cell">Category</TableHead>
                <TableHead className="font-semibold text-[10px] uppercase tracking-wider">Availability</TableHead>
                <TableHead className="font-semibold text-[10px] uppercase tracking-wider text-center">Issued</TableHead>
                <TableHead className="font-semibold text-[10px] uppercase tracking-wider">Status</TableHead>
                <TableHead className="font-semibold text-[10px] uppercase tracking-wider text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((b, i) => {
                const availPct = b.copies > 0 ? Math.round((b.available / b.copies) * 100) : 0
                return (
                  <motion.tr
                    key={b.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: Math.min(i * 0.02, 0.3) }}
                    className="hover:bg-accent/30 transition-colors"
                  >
                    <TableCell>
                      <div className="flex items-center gap-2.5">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                          <BookMarked className="h-4 w-4" />
                        </div>
                        <div className="min-w-0 max-w-[260px]">
                          <p className="font-medium text-sm truncate">{b.title}</p>
                          <p className="text-[11px] text-muted-foreground truncate">{b.author}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell font-mono text-[11px] text-muted-foreground">{b.isbn}</TableCell>
                    <TableCell className="hidden sm:table-cell">
                      <Badge variant="outline" className="text-[10px] font-medium">{b.category}</Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <div className="flex items-baseline gap-1">
                          <span className={cn(
                            'font-semibold tabular-nums',
                            b.available === 0 ? 'text-rose-600' : b.available <= 3 ? 'text-amber-600' : 'text-emerald-600',
                          )}>{b.available}</span>
                          <span className="text-[10px] text-muted-foreground">of {b.copies}</span>
                        </div>
                        {/* Thin utilization hint — free share of total copies */}
                        <div className="h-1.5 w-20 rounded-full bg-muted overflow-hidden" aria-hidden>
                          <div
                            className={cn('h-full rounded-full transition-all', availabilityBar(b.available, b.copies))}
                            style={{ width: `${availPct}%` }}
                          />
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-center"><span className="font-semibold text-amber-600 tabular-nums">{b.issued}</span></TableCell>
                    <TableCell><BookStatusBadge status={b.status} /></TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={b.available <= 0}
                        onClick={() => onIssueBook(b)}
                        className="gap-1.5 text-[11px] h-9 md:h-7 border-emerald-500/30 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/10"
                      >
                        Issue
                      </Button>
                    </TableCell>
                  </motion.tr>
                )
              })}
            </TableBody>
          </Table>
        )}
      </LibPanel>
    </div>
  )
}

// ─── IssuedBooksTable (also handles 'overdue' filter) ───────────────

interface IssuedBooksTableProps {
  filter: 'all' | 'overdue'
  onReturn: (issueId: string) => void
  onSendReminder?: (issue: IssueRecord) => void
}

export function IssuedBooksTable({ filter, onReturn, onSendReminder }: IssuedBooksTableProps) {
  const issues = useEffectiveLibraryIssues()

  const rows = issues
    .filter((i) => i.status !== 'Returned')
    .filter((i) => filter === 'all' ? true : i.status === 'Overdue')

  const overdueCount = issues.filter((i) => i.status === 'Overdue').length

  const title = filter === 'overdue' ? 'Overdue Books' : 'Issued Books'
  const subtitle = filter === 'overdue'
    ? `${rows.length} overdue · ${overdueCount} total`
    : `${rows.length} currently issued · ${overdueCount} overdue`

  return (
    <LibPanel
      title={title}
      subtitle={subtitle}
      bodyClassName="p-0"
    >
      {rows.length === 0 ? (
        <LibEmptyState
          icon={<BookMarked className="h-5 w-5" />}
          title={filter === 'overdue' ? 'No overdue books' : 'No books currently issued'}
          description={filter === 'overdue' ? 'All issued books are within their due dates.' : 'Issue a book from the catalogue to see it here.'}
        />
      ) : (
        <Table className="min-w-[34rem]">
          <TableHeader>
            <TableRow className="bg-muted/40">
              <TableHead className="font-semibold text-[10px] uppercase tracking-wider">Borrower & Book</TableHead>
              <TableHead className="font-semibold text-[10px] uppercase tracking-wider hidden lg:table-cell">Type</TableHead>
              <TableHead className="font-semibold text-[10px] uppercase tracking-wider hidden md:table-cell">Issue Date</TableHead>
              <TableHead className="font-semibold text-[10px] uppercase tracking-wider hidden md:table-cell">Due Date</TableHead>
              {filter === 'overdue' && (
                <TableHead className="font-semibold text-[10px] uppercase tracking-wider text-center">Days Overdue</TableHead>
              )}
              <TableHead className="font-semibold text-[10px] uppercase tracking-wider">Status</TableHead>
              <TableHead className="font-semibold text-[10px] uppercase tracking-wider text-right">Fine</TableHead>
              <TableHead className="font-semibold text-[10px] uppercase tracking-wider text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r, i) => {
              const daysOverdue = filter === 'overdue'
                ? Math.max(0, Math.ceil((Date.now() - new Date(r.dueDate).getTime()) / (1000 * 60 * 60 * 24)))
                : 0
              return (
                <motion.tr
                  key={r.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: Math.min(i * 0.02, 0.3) }}
                  className="hover:bg-accent/30 transition-colors"
                >
                  <TableCell>
                    <div className="flex items-center gap-2.5">
                      <GradientAvatar name={r.borrowerName} initials={initials(r.borrowerName)} size="sm" />
                      <div className="min-w-0 max-w-[280px]">
                        <p className="font-medium text-sm truncate">{r.bookTitle}</p>
                        <p className="text-[11px] text-muted-foreground truncate">
                          {r.borrowerName}
                          {r.admissionNo && <span className="font-mono"> · {r.admissionNo}</span>}
                          {r.class && <span> · {r.class}</span>}
                        </p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="hidden lg:table-cell"><BorrowerTypePill type={r.borrowerType} /></TableCell>
                  <TableCell className="hidden md:table-cell text-xs">{formatDate(r.issueDate)}</TableCell>
                  <TableCell className="hidden md:table-cell text-xs">
                    <span className={cn(r.status === 'Overdue' && 'text-rose-600 font-semibold')}>
                      {formatDate(r.dueDate)}
                    </span>
                  </TableCell>
                  {filter === 'overdue' && (
                    <TableCell className="text-center">
                      <span className="inline-flex items-center justify-center min-w-7 h-6 px-1.5 rounded-md bg-rose-500/10 text-rose-700 dark:text-rose-300 text-xs font-bold tabular-nums">
                        {daysOverdue}d
                      </span>
                    </TableCell>
                  )}
                  <TableCell><IssueStatusBadge status={r.status} /></TableCell>
                  <TableCell className="text-right">
                    {r.fine > 0 ? (
                      <span className="font-semibold text-rose-600 text-sm tabular-nums">{formatINR(r.fine)}</span>
                    ) : (
                      <span className="text-muted-foreground text-xs">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      {r.status === 'Overdue' && onSendReminder && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1 text-[10px] h-9 md:h-7"
                          onClick={() => onSendReminder(r)}
                        >
                          <Send className="h-3 w-3" /> Remind
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1.5 text-[10px] h-9 md:h-7"
                        onClick={() => onReturn(r.id)}
                      >
                        <RotateCcw className="h-3 w-3" /> Return
                      </Button>
                    </div>
                  </TableCell>
                </motion.tr>
              )
            })}
          </TableBody>
        </Table>
      )}
    </LibPanel>
  )
}
