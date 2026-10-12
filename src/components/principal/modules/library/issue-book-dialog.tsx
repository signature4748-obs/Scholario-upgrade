'use client'

/**
 * issue-book-dialog — Issue Book dialog.
 *
 * Workflow:
 *   1. Select borrower (searchable — students + teachers from
 *      getBorrowerOptions)
 *   2. Select book (searchable — only books with available > 0)
 *   3. Issue Date (today) and Due Date (today + 14 days) shown as
 *      informational display — store enforces 14-day default loan period.
 *   4. Confirm → issueBook(bookId, borrowerId, borrowerType)
 *
 * State from library-store. NO fake success — the store's return value
 * drives the toast.
 */

import { useState, useMemo, useEffect } from 'react'
import { BookMarked, Calendar, CalendarClock, GraduationCap, BookUser } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogFooter, DialogDescription,
} from '@/components/ui/dialog'
import { SearchableSelect } from '@/components/principal/modules/shared/searchable-select'
import { useLibraryStore, useLibraryServerMode, useEffectiveLibraryBooks } from '@/lib/store/library-store'
import type { Book } from '@/lib/store/library-store'
import { formatDate } from '@/lib/format'
import { toast } from 'sonner'
import { BorrowerTypePill, LibPill } from './library-shared'

interface IssueBookDialogProps {
  open: boolean
  onOpenChange: (o: boolean) => void
  preselectBook?: Book | null
}

export function IssueBookDialog({ open, onOpenChange, preselectBook }: IssueBookDialogProps) {
  const books = useEffectiveLibraryBooks()
  const issueBook = useLibraryStore((s) => s.issueBook)
  const getBorrowerOptions = useLibraryStore((s) => s.getBorrowerOptions)
  const serverPending = useLibraryStore((s) => s.serverPending)
  const serverMode = useLibraryServerMode()

  const [borrowerId, setBorrowerId] = useState('')
  const [borrowerType, setBorrowerType] = useState<'student' | 'teacher'>('student')
  const [bookId, setBookId] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  // Reset state when dialog opens; preselect book if provided.
  useEffect(() => {
    if (open) {
      setBookId(preselectBook?.id ?? '')
      setBorrowerId('')
      setBorrowerType('student')
      setSubmitting(false)
      setSubmitError(null)
    }
  }, [open, preselectBook])

  // Build borrower options (server mode: students only — the register
  // supports student borrowers; demo mode: students + REAL teacher roster).
  const borrowerOptions = useMemo(() => {
    const opts = getBorrowerOptions()
    return opts.map((o) => ({
      id: o.id,
      label: o.name,
      avatar: o.name.split(' ').map((n) => n[0]).slice(0, 2).join('').toUpperCase(),
      meta: o.type === 'teacher' ? `${o.detail} · demo lending` : o.detail,
    }))
  }, [getBorrowerOptions])

  // Track the selected option's declared type (real teacher ids are not
  // 'T-' prefixed — the old prefix heuristic broke with real rosters).
  const handleSelectBorrower = (id: string) => {
    setBorrowerId(id)
    const opt = getBorrowerOptions().find((o) => o.id === id)
    setBorrowerType(opt?.type ?? 'student')
  }

  // Book options: only books with available > 0.
  const bookOptions = useMemo(() => {
    return books
      .filter((b) => b.available > 0)
      .map((b) => ({
        id: b.id,
        label: b.title,
        avatar: '📖',
        meta: `${b.author} · ${b.available} available`,
      }))
  }, [books])

  const selectedBook = useMemo(() => books.find((b) => b.id === bookId), [books, bookId])

  // Auto-computed issue + due dates (store enforces today + 14 days).
  const issueDate = new Date()
  const dueDate = useMemo(() => {
    const d = new Date()
    d.setDate(d.getDate() + 14)
    return d
  }, [])

  const canIssue = !!borrowerId && !!bookId && selectedBook && selectedBook.available > 0 && !submitting

  const handleIssue = async () => {
    if (!bookId || !borrowerId || submitting) {
      toast.error('Please select a borrower and a book')
      return
    }
    setSubmitting(true)
    setSubmitError(null)
    const result = await issueBook(bookId, borrowerId, borrowerType)
    setSubmitting(false)
    if (!result.success) {
      setSubmitError(result.error || 'Failed to issue book')
      toast.error(result.error || 'Failed to issue book')
      return
    }
    toast.success('Book issued', {
      description: `${selectedBook?.title} issued to ${
        borrowerOptions.find((o) => o.id === borrowerId)?.label
      } · Due ${formatDate(dueDate)}`,
    })
    setBookId('')
    setBorrowerId('')
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BookMarked className="h-4 w-4 text-primary" />
            Issue Book
          </DialogTitle>
          <DialogDescription>
            Select a borrower and a book to issue. Default loan period is 14 days.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {submitError && (
            <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/[0.06] px-3 py-2 text-xs text-destructive">
              {submitError}
            </p>
          )}
          {serverMode && (
            <p className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
              Issues are saved to the school's library register. Student borrowers only — teacher lending requires a register extension (coming).
            </p>
          )}

          {/* Borrower */}
          <div className="space-y-1.5">
            <Label className="text-xs flex items-center gap-1.5">
              <GraduationCap className="h-3 w-3" /> Borrower
            </Label>
            <SearchableSelect
              selectedId={borrowerId}
              onSelect={handleSelectBorrower}
              placeholder={serverMode ? 'Search student' : 'Search student or teacher'}
              options={borrowerOptions}
              pickerId="lib-borrower"
            />
            {borrowerId && (
              <div className="flex items-center gap-1.5 mt-1">
                <BorrowerTypePill type={borrowerType === 'teacher' ? 'teacher' : 'student'} />
                <span className="text-[10px] text-muted-foreground">
                  {borrowerOptions.find((o) => o.id === borrowerId)?.meta}
                </span>
              </div>
            )}
          </div>

          {/* Book */}
          <div className="space-y-1.5">
            <Label className="text-xs flex items-center gap-1.5">
              <BookUser className="h-3 w-3" /> Book
            </Label>
            <SearchableSelect
              selectedId={bookId}
              onSelect={setBookId}
              placeholder="Search available book"
              options={bookOptions}
              pickerId="lib-book"
            />
            {selectedBook && (
              <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                <LibPill accent="bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
                  {selectedBook.available} available
                </LibPill>
                <LibPill accent="bg-muted text-muted-foreground">
                  {selectedBook.category}
                </LibPill>
                <span className="text-[10px] text-muted-foreground truncate">{selectedBook.author}</span>
              </div>
            )}
          </div>

          {/* Issue / Due dates — auto-computed by store, shown as info */}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-border bg-muted/20 px-3 py-2">
              <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase text-muted-foreground tracking-wider">
                <Calendar className="h-3 w-3" /> Issue Date
              </div>
              <p className="text-sm font-bold mt-1">{formatDate(issueDate)}</p>
              <p className="text-[10px] text-muted-foreground">Today</p>
            </div>
            <div className="rounded-lg border border-border bg-emerald-500/[0.04] dark:bg-emerald-500/[0.06] border-emerald-500/20 px-3 py-2">
              <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase text-muted-foreground tracking-wider">
                <CalendarClock className="h-3 w-3" /> Due Date
              </div>
              <p className="text-sm font-bold mt-1 text-emerald-700 dark:text-emerald-300">{formatDate(dueDate)}</p>
              <p className="text-[10px] text-muted-foreground">14-day loan</p>
            </div>
          </div>

          {/* Fine policy */}
          <div className="rounded-md bg-amber-500/[0.04] dark:bg-amber-500/[0.06] border border-amber-500/20 px-3 py-2 text-[11px] text-muted-foreground">
            <span className="font-semibold text-amber-700 dark:text-amber-300">Fine policy:</span>{' '}
            ₹5 per day after the due date.
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>Cancel</Button>
          <Button
            onClick={handleIssue}
            disabled={!canIssue}
            className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            <BookMarked className="h-3.5 w-3.5" /> {submitting || serverPending ? 'Issuing…' : 'Issue Book'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
