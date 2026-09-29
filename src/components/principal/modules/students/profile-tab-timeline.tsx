'use client'

import {
  Archive, Bus, Clock, Crown, Home, IndianRupee, RotateCcw, TrendingUp, User,
} from 'lucide-react'
import { formatDate } from '@/lib/format'
import type { StudentRecord } from '@/lib/store/students-store'
import { Section } from './shared'

type Props = { student: StudentRecord }

export function TimelineTab({ student }: Props) {
  const events = [...student.timeline].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
  const iconFor = (type: string) => {
    switch (type) {
      case 'admission': return <User className="h-3.5 w-3.5" />
      case 'promotion': return <TrendingUp className="h-3.5 w-3.5" />
      case 'transfer': return <Bus className="h-3.5 w-3.5" />
      case 'fee': return <IndianRupee className="h-3.5 w-3.5" />
      case 'house': return <Home className="h-3.5 w-3.5" />
      case 'position': return <Crown className="h-3.5 w-3.5" />
      case 'archive': return <Archive className="h-3.5 w-3.5" />
      case 'restore': return <RotateCcw className="h-3.5 w-3.5" />
      default: return <Clock className="h-3.5 w-3.5" />
    }
  }
  return (
    <div className="space-y-4">
      <Section title="Student Timeline">
        {events.length === 0 ? (
          <div className="rounded-lg border border-border bg-card/40 p-6 text-center">
            <Clock className="h-8 w-8 text-muted-foreground/50 mx-auto mb-2" aria-hidden="true" />
            <p className="text-sm font-medium">No timeline events</p>
            <p className="text-xs text-muted-foreground mt-1">
              Admissions, transfers and archive actions will be recorded here as they happen.
            </p>
          </div>
        ) : (
          <div className="relative pl-5">
            <div className="absolute left-2 top-1 bottom-1 w-px bg-border" />
            {events.map((ev) => (
              <div key={ev.id} className="relative pb-4">
                <div className="absolute -left-[14px] top-0 flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-primary border-2 border-background">
                  {iconFor(ev.type)}
                </div>
                <div className="ml-2">
                  <p className="text-sm font-medium">{ev.title}</p>
                  <p className="text-xs text-muted-foreground">{ev.description}</p>
                  <div className="flex items-center gap-2 mt-0.5 text-[11px] text-muted-foreground">
                    <Clock className="h-3 w-3" /> {formatDate(ev.date)}<span>·</span><span>{ev.by}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  )
}
