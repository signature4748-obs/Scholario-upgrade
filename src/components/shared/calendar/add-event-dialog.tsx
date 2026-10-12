'use client'

/**
 * AddEventDialog — focused, polished event creation, using the
 * standard Scholario dialog surface.
 *
 * Only useful fields (spec): title, type, date, time (with an All-day
 * switch), optional location and optional notes. No technical fields.
 *
 * The type picker is a wrap-row of single-select pills carrying the
 * type dot — it doubles as a color preview and stays touch-friendly
 * on phones.
 *
 * CALENDAR DB WIRING — submission is server-authoritative: POST
 * /api/events (session tenant, `school.events.write` = PRINCIPAL/
 * MANAGEMENT). On success the feed refetches (cross-device truth) and
 * the workspace navigates to the event's month. On failure the dialog
 * stays open with the honest server error — NO local fallback event is
 * created (a silent localStorage row would pretend to be a real school
 * event on this browser only).
 */

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { DatePicker } from '@/components/ui/date-picker'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import {
  refreshCalendarServerEvents,
  UI_TO_DB_TYPE,
  type CalendarEvent,
  type SchoolEventDTO,
} from '@/lib/store/calendar-store'
import { ALL_TYPES, TYPE_TOKENS, typeColor } from './data'

export interface AddEventDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** ISO date used to prefill the form (selected day / month default). */
  defaultDate: string
  /** Called after the event is added — workspace navigates + selects. */
  onAdded: (event: CalendarEvent) => void
}

export function AddEventDialog({ open, onOpenChange, defaultDate, onAdded }: AddEventDialogProps) {
  const [title, setTitle] = useState('')
  const [type, setType] = useState<string>('Event')
  const [date, setDate] = useState(defaultDate)
  const [allDay, setAllDay] = useState(false)
  const [time, setTime] = useState('09:00')
  const [location, setLocation] = useState('')
  const [notes, setNotes] = useState('')
  const [touched, setTouched] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  // Reset to a clean form each time the dialog opens.
  useEffect(() => {
    if (open) {
      setTitle('')
      setType('Event')
      setDate(defaultDate)
      setAllDay(false)
      setTime('09:00')
      setLocation('')
      setNotes('')
      setTouched(false)
      setSubmitError(null)
    }
  }, [open, defaultDate])

  const titleMissing = touched && !title.trim()

  const handleSubmit = async () => {
    setTouched(true)
    const trimmed = title.trim()
    if (!trimmed || submitting) return

    setSubmitting(true)
    setSubmitError(null)
    try {
      const res = await fetch('/api/events', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          title: trimmed,
          type: UI_TO_DB_TYPE[type] ?? 'EVENT',
          // Plain 'YYYY-MM-DD' → the API stores it as a UTC-midnight date;
          // the display time travels separately (timezone-free string).
          startDate: date,
          time: allDay ? null : time || null,
          location: location.trim() || null,
          description: notes.trim() || null,
        }),
      })
      let json: unknown = null
      try {
        json = await res.json()
      } catch {
        /* non-JSON body — handled below */
      }
      const envelope = json as { ok?: unknown; data?: SchoolEventDTO; error?: { publicMessage?: string; message?: string } } | null
      if (!res.ok || !envelope || envelope.ok !== true) {
        const msg =
          envelope?.error?.publicMessage ??
          envelope?.error?.message ??
          (res.status === 403
            ? 'Your role cannot publish school events.'
            : 'The event could not be saved. Please try again.')
        throw new Error(msg)
      }

      const events = await refreshCalendarServerEvents()
      const created = events.find((e) => e.serverId === envelope.data?.id)
      toast.success('Event added', {
        description: `${trimmed} · ${allDay ? 'All day' : time || '—'}`,
      })
      onAdded(
        created ?? {
          id: `server-${envelope.data?.id ?? Date.now()}`,
          serverId: envelope.data?.id,
          date,
          title: trimmed,
          type,
          time: allDay ? '—' : time || '—',
          location: location.trim() || undefined,
          description: notes.trim() || undefined,
          source: 'school',
        },
      )
      onOpenChange(false)
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'The event could not be saved.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] gap-0 overflow-y-auto p-0 sm:max-w-md">
        <DialogHeader className="space-y-1.5 px-5 pt-5 text-left sm:px-6 sm:pt-6">
          <DialogTitle className="text-left">Add Event</DialogTitle>
          <DialogDescription>
            Create a school calendar event.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 px-5 py-4 sm:px-6">
          {submitError && (
            <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/[0.06] px-3 py-2 text-xs text-destructive">
              {submitError}
            </p>
          )}

          {/* Title */}
          <div className="space-y-1.5">
            <Label htmlFor="event-title" className="text-xs">
              Title <span className="text-destructive">*</span>
            </Label>
            <Input
              id="event-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Annual Day Function"
              autoFocus
              aria-invalid={titleMissing}
              className={cn(titleMissing && 'border-destructive/60 focus-visible:ring-destructive/20')}
            />
            {titleMissing && (
              <p className="text-[11px] text-destructive">Please give the event a title.</p>
            )}
          </div>

          {/* Type — single-select pills carrying the type color */}
          <div className="space-y-1.5">
            <Label className="text-xs">Type</Label>
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Event type">
              {ALL_TYPES.map((t) => {
                const selected = type === t
                const token = TYPE_TOKENS[t]
                return (
                  <button
                    key={t}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => setType(t)}
                    className={cn(
                      'flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      selected
                        ? cn('border-foreground/20 text-foreground', token.chip)
                        : 'border-border text-muted-foreground hover:border-foreground/20 hover:bg-muted/60 hover:text-foreground',
                    )}
                  >
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ background: typeColor(t) }}
                      aria-hidden
                    />
                    {t}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Date + time */}
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">
                Date <span className="text-destructive">*</span>
              </Label>
              <DatePicker value={date} onChange={setDate} placeholder="Select date" />
            </div>
            <div className="flex items-end gap-3">
              <div className="flex h-9 items-center gap-2.5 rounded-lg border border-border bg-card px-3">
                <Switch
                  id="all-day"
                  checked={allDay}
                  onCheckedChange={setAllDay}
                  aria-label="All day event"
                />
                <Label htmlFor="all-day" className="cursor-pointer text-xs text-muted-foreground">
                  All day
                </Label>
              </div>
              <div className="min-w-0 flex-1 space-y-1.5">
                <Label htmlFor="event-time" className="text-xs">
                  Time
                </Label>
                <Input
                  id="event-time"
                  type="time"
                  value={time}
                  disabled={allDay}
                  onChange={(e) => setTime(e.target.value)}
                  className="disabled:opacity-50"
                />
              </div>
            </div>
          </div>

          {/* Location */}
          <div className="space-y-1.5">
            <Label htmlFor="event-location" className="text-xs">
              Location <span className="font-normal text-muted-foreground/60">(optional)</span>
            </Label>
            <Input
              id="event-location"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="School Campus"
            />
          </div>

          {/* Notes */}
          <div className="space-y-1.5">
            <Label htmlFor="event-notes" className="text-xs">
              Notes <span className="font-normal text-muted-foreground/60">(optional)</span>
            </Label>
            <Textarea
              id="event-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Anything worth remembering about this event"
              rows={3}
              className="resize-none"
            />
          </div>
        </div>

        <DialogFooter className="border-t border-border px-5 py-4 sm:px-6">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? 'Adding…' : 'Add Event'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
