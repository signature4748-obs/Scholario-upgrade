'use client'

/**
 * EventDetailDialog — clean, focused read view for one calendar
 * event, using the standard Scholario dialog surface.
 *
 * Progressive disclosure: the grid and lists stay light; full context
 * (date, time, location, notes, source) lives here and only appears
 * when the user asks for it by clicking an event.
 *
 * Events added at runtime (source 'user') can be removed from here —
 * the removal goes through `useCalendarStore.removeEvent` so the grid,
 * upcoming list and counts all stay consistent.
 *
 * CALENDAR DB WIRING — removal is server-authoritative for events that
 * came from the DB (`serverId`): DELETE /api/events?id= (tenant-scoped,
 * `school.events.write`). The feed refetches afterwards so every device
 * converges. LEGACY user events (pre-wiring localStorage rows) keep
 * their local removal. Failures surface an honest toast — the event is
 * never removed locally on a failed server delete.
 */

import { useState } from 'react'
import { Calendar, Clock, MapPin, NotebookText, Trash2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import {
  refreshCalendarServerEvents,
  useCalendarStore,
  type CalendarEvent,
} from '@/lib/store/calendar-store'
import { SOURCE_META, formatFullDate, formatTimeLabel } from './data'
import { TypeBadge } from './primitives'

export interface EventDetailDialogProps {
  event: CalendarEvent | null
  onOpenChange: (open: boolean) => void
  /** Allow removing user-created events (principal/teacher). */
  canManage: boolean
}

function MetaRow({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-border bg-muted text-muted-foreground">
        <Icon className="h-3.5 w-3.5" aria-hidden />
      </div>
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
          {label}
        </p>
        <p className="mt-0.5 text-[13px] font-medium leading-snug text-foreground">{value}</p>
      </div>
    </div>
  )
}

export function EventDetailDialog({ event, onOpenChange, canManage }: EventDetailDialogProps) {
  const removeEvent = useCalendarStore((s) => s.removeEvent)
  const [removing, setRemoving] = useState(false)
  const open = event !== null

  if (!event) {
    return <Dialog open={false} onOpenChange={onOpenChange} />
  }

  const isUserEvent = event.source === 'user'
  const isServerEvent = Boolean(event.serverId)
  const description = event.description?.trim()

  /** Server events: DELETE /api/events?id=<row> (tenant-scoped). */
  const handleServerDelete = async () => {
    if (!event.serverId || removing) return
    setRemoving(true)
    try {
      const res = await fetch(`/api/events?id=${encodeURIComponent(event.serverId)}`, {
        method: 'DELETE',
        credentials: 'same-origin',
      })
      let json: unknown = null
      try {
        json = await res.json()
      } catch {
        /* non-JSON body — handled below */
      }
      const envelope = json as { ok?: unknown; error?: { publicMessage?: string; message?: string } } | null
      if (!res.ok || !envelope || envelope.ok !== true) {
        throw new Error(
          envelope?.error?.publicMessage ??
            envelope?.error?.message ??
            (res.status === 403
              ? 'Your role cannot remove school events.'
              : 'The event could not be removed. Please try again.'),
        )
      }
      await refreshCalendarServerEvents()
      onOpenChange(false)
      toast.success('Event removed', {
        description: `${event.title} · ${formatFullDate(event.date)}`,
      })
    } catch (err) {
      toast.error('Event not removed', {
        description: err instanceof Error ? err.message : 'Please try again.',
      })
    } finally {
      setRemoving(false)
    }
  }

  /** Legacy localStorage rows — local removal (pre-server-wiring data). */
  const handleLocalDelete = () => {
    removeEvent(event.id)
    onOpenChange(false)
    toast.success('Event removed', {
      description: `${event.title} · ${formatFullDate(event.date)}`,
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[calc(100vw-1.5rem)] gap-0 p-0 sm:max-w-md">
        {/* Type + source */}
        <DialogHeader className="gap-2 px-5 pt-5 text-left sm:px-6 sm:pt-6">
          <div className="flex flex-wrap items-center gap-1.5">
            <TypeBadge type={event.type} />
            <span className="inline-flex items-center rounded-full border border-border bg-muted px-2 py-[3px] text-[10px] font-medium leading-none text-muted-foreground">
              {SOURCE_META[event.source]?.label ?? event.source}
            </span>
          </div>
          <DialogTitle className="pr-8 text-left text-lg leading-snug font-semibold tracking-tight">
            {event.title}
          </DialogTitle>
          <DialogDescription className="sr-only">
            Event details for {event.title}
          </DialogDescription>
        </DialogHeader>

        {/* Meta */}
        <div className="space-y-3.5 px-5 py-4 sm:px-6">
          <MetaRow icon={Calendar} label="Date" value={formatFullDate(event.date)} />
          <MetaRow
            icon={Clock}
            label="Time"
            value={formatTimeLabel(event.time)}
          />
          {(event.location || event.source !== 'holiday') && (
            <MetaRow
              icon={MapPin}
              label="Location"
              value={event.location?.trim() || 'School Campus'}
            />
          )}
          {description && (
            <MetaRow icon={NotebookText} label="Notes" value={description} />
          )}
        </div>

        {(isServerEvent || isUserEvent) && canManage && (
          <>
            <div className="mx-5 h-px bg-border sm:mx-6" aria-hidden />
            <div className="flex items-center justify-between gap-3 px-5 py-3.5 sm:px-6">
              <p className="text-[11px] leading-tight text-muted-foreground">
                {isServerEvent
                  ? 'A saved school event — removing it updates the calendar for everyone.'
                  : 'A local event from before server sync — removing it only affects this browser.'}
              </p>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => (isServerEvent ? void handleServerDelete() : handleLocalDelete())}
                disabled={removing}
                className="h-8 shrink-0 gap-1.5 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden /> {removing ? 'Removing…' : 'Remove'}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
