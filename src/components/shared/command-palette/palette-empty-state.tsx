'use client'

import { Search, Clock, Trash2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { SearchResultItem } from '@/lib/search-service'
import { renderItemIcon } from './utils'

interface PaletteEmptyStateProps {
  recentList: SearchResultItem[]
  active: number
  setActive: (n: number | ((a: number) => number)) => void
  handleSelect: (item: SearchResultItem) => void
  clearRecent: () => void
  removeRecent: (id: string) => void
}

export function PaletteEmptyState({
  recentList,
  active,
  setActive,
  handleSelect,
  clearRecent,
  removeRecent,
}: PaletteEmptyStateProps) {
  return (
    <div className="py-6 px-4">
      {recentList.length > 0 ? (
        <div className="space-y-1">
          <div className="flex items-center justify-between px-2 py-1 mb-1">
            <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              <Clock className="h-3 w-3 text-primary" />
              Recent Searches
            </span>
            <button
              onClick={clearRecent}
              className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-destructive transition-colors font-medium"
            >
              <Trash2 className="h-3 w-3" />
              Clear history
            </button>
          </div>

          <div className="space-y-0.5">
            {recentList.map((item, idx) => {
              const isActive = idx === active
              return (
                <div
                  key={`rec-${item.id}`}
                  data-idx={idx}
                  className="group flex items-center gap-1"
                >
                  <button
                    onMouseMove={() => setActive(idx)}
                    onClick={() => handleSelect(item)}
                    className={cn(
                      'flex min-w-0 flex-1 items-center gap-3 rounded-xl px-3 py-2 text-left text-sm transition-all focus-ring',
                      isActive
                        ? 'bg-primary/10 text-primary font-medium'
                        : 'hover:bg-accent/60 text-foreground'
                    )}
                  >
                    <span
                      className={cn(
                        'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-border/50 text-muted-foreground',
                        isActive && 'bg-primary/15 text-primary border-primary/20'
                      )}
                      aria-hidden="true"
                    >
                      {renderItemIcon(item.iconName)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-xs font-semibold">{item.title}</span>
                        <span className="text-[10px] px-1.5 py-0.2 rounded border bg-muted text-muted-foreground font-normal">
                          {item.category}
                        </span>
                      </span>
                      <span className="block text-[11px] text-muted-foreground truncate">{item.subtitle}</span>
                    </span>
                  </button>

                  <button
                    onClick={() => removeRecent(item.id)}
                    aria-label={`Remove ${item.title} from recent searches`}
                    className="shrink-0 rounded-md p-1.5 text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:bg-muted hover:text-destructive transition-all focus-ring"
                  >
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      ) : (
        <div className="text-center py-6 px-2 space-y-1.5">
          <div className="flex h-9 w-9 mx-auto items-center justify-center rounded-xl bg-primary/10 text-primary mb-2">
            <Search className="h-4.5 w-4.5" />
          </div>
          <p className="text-xs font-semibold text-foreground">Search School Portal</p>
          <p className="text-[11px] text-muted-foreground max-w-sm mx-auto">
            Type keywords like <span className="font-medium text-foreground">"Attendance"</span>, <span className="font-medium text-foreground">"Aarav"</span>, <span className="font-medium text-foreground">"Exam"</span>, or <span className="font-medium text-foreground">"Timetable"</span> to find students, faculty, classes, & records.
          </p>
        </div>
      )}
    </div>
  )
}
