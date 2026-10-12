'use client'

/**
 * add-book-dialog — QA-FIX-B "Add Book" dialog.
 *
 * The library-store already had an `addBook` mutation but NO UI called it —
 * this dialog closes that gap. Follows the issue-book-dialog design language
 * exactly (Dialog + shadcn inputs + primary emerald confirm button).
 *
 *   1. Title / Author / ISBN (required text inputs)
 *   2. Category (Select — BookCategory union)
 *   3. Publisher (optional)
 *   4. Copies (number, min 1)
 *   5. Confirm → addBook({ title, author, isbn, category, publisher?, copies })
 *      — the store derives issued/available/status, so a new book shows up
 *      in the Books Catalogue immediately (and survives reload via the
 *      tenant-scoped persist middleware).
 *
 * Required-only validation — no over-engineered field rules.
 */

import { useState, useEffect } from 'react'
import { BookPlus, BookMarked, User, Hash, Layers, Building2, Copy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogFooter, DialogDescription,
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { useLibraryStore } from '@/lib/store/library-store'
import type { BookCategory } from '@/lib/store/library-store'
import { toast } from 'sonner'

const CATEGORIES: BookCategory[] = [
  'Fiction', 'Reference', 'Textbooks', 'Story Books', 'Biography', 'Magazines', 'Science',
]

interface AddBookDialogProps {
  open: boolean
  onOpenChange: (o: boolean) => void
}

export function AddBookDialog({ open, onOpenChange }: AddBookDialogProps) {
  const addBook = useLibraryStore((s) => s.addBook)

  const [title, setTitle] = useState('')
  const [author, setAuthor] = useState('')
  const [isbn, setIsbn] = useState('')
  const [category, setCategory] = useState<BookCategory | ''>('')
  const [publisher, setPublisher] = useState('')
  const [copies, setCopies] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  // Reset state every time the dialog opens.
  useEffect(() => {
    if (open) {
      setTitle('')
      setAuthor('')
      setIsbn('')
      setCategory('')
      setPublisher('')
      setCopies('')
      setSubmitting(false)
      setSubmitError(null)
    }
  }, [open])

  const copiesNum = Math.max(0, parseInt(copies || '0', 10))
  const canSave = Boolean(
    title.trim() && author.trim() && isbn.trim() && category && copiesNum >= 1 && !submitting
  )

  const handleSave = async () => {
    if (!canSave) {
      toast.error('Please fill the title, author, ISBN, category and at least 1 copy')
      return
    }
    setSubmitting(true)
    setSubmitError(null)
    const result = await addBook({
      title: title.trim(),
      author: author.trim(),
      isbn: isbn.trim(),
      category: category as BookCategory,
      publisher: publisher.trim() || undefined,
      copies: copiesNum,
    })
    setSubmitting(false)
    if (!result.success) {
      setSubmitError(result.error || 'The book could not be added')
      toast.error(result.error || 'The book could not be added')
      return
    }
    toast.success('Book added to catalogue', {
      description: `"${title.trim()}" · ${copiesNum} cop${copiesNum === 1 ? 'y' : 'ies'} · ${category}`,
    })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BookPlus className="h-4 w-4 text-primary" />
            Add Book
          </DialogTitle>
          <DialogDescription>
            Add a new title to the library catalogue. Copies start fully available.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {submitError && (
            <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/[0.06] px-3 py-2 text-xs text-destructive">
              {submitError}
            </p>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Title */}
            <div className="space-y-1.5 sm:col-span-2">
              <Label className="text-xs flex items-center gap-1.5">
                <BookMarked className="h-3 w-3" /> Title
              </Label>
              <Input
                className="h-9 text-xs"
                placeholder="e.g. The Blue Umbrella"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                autoFocus
              />
            </div>

            {/* Author */}
            <div className="space-y-1.5">
              <Label className="text-xs flex items-center gap-1.5">
                <User className="h-3 w-3" /> Author
              </Label>
              <Input
                className="h-9 text-xs"
                placeholder="e.g. Ruskin Bond"
                value={author}
                onChange={(e) => setAuthor(e.target.value)}
              />
            </div>

            {/* ISBN */}
            <div className="space-y-1.5">
              <Label className="text-xs flex items-center gap-1.5">
                <Hash className="h-3 w-3" /> ISBN
              </Label>
              <Input
                className="h-9 text-xs font-mono"
                placeholder="e.g. 978-0143332463"
                value={isbn}
                onChange={(e) => setIsbn(e.target.value)}
              />
            </div>

            {/* Category */}
            <div className="space-y-1.5">
              <Label className="text-xs flex items-center gap-1.5">
                <Layers className="h-3 w-3" /> Category
              </Label>
              <Select
                value={category}
                onValueChange={(v) => setCategory(v as BookCategory)}
              >
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c} className="text-xs">{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Copies */}
            <div className="space-y-1.5">
              <Label className="text-xs flex items-center gap-1.5">
                <Copy className="h-3 w-3" /> Copies
              </Label>
              <Input
                className="h-9 text-xs"
                type="number"
                min={1}
                step={1}
                placeholder="e.g. 10"
                value={copies}
                onChange={(e) => setCopies(e.target.value)}
              />
            </div>

            {/* Publisher — optional */}
            <div className="space-y-1.5 sm:col-span-2">
              <Label className="text-xs flex items-center gap-1.5">
                <Building2 className="h-3 w-3" /> Publisher{' '}
                <span className="text-muted-foreground/70 font-normal">(optional)</span>
              </Label>
              <Input
                className="h-9 text-xs"
                placeholder="e.g. Penguin India"
                value={publisher}
                onChange={(e) => setPublisher(e.target.value)}
              />
            </div>
          </div>

          {/* Loan policy info — matches the issue dialog's fine policy note */}
          <div className="rounded-md bg-emerald-500/[0.04] dark:bg-emerald-500/[0.06] border border-emerald-500/20 px-3 py-2 text-[11px] text-muted-foreground">
            <span className="font-semibold text-emerald-700 dark:text-emerald-300">Loan policy:</span>{' '}
            14-day loan period · ₹5/day fine after due date.
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={handleSave}
            disabled={!canSave}
            className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            <BookPlus className="h-3.5 w-3.5" /> {submitting ? 'Adding…' : 'Add Book'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
