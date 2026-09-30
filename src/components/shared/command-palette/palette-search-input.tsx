'use client'

import { Search, X } from 'lucide-react'

interface PaletteSearchInputProps {
  inputRef: React.RefObject<HTMLInputElement | null>
  query: string
  setQuery: (q: string) => void
}

export function PaletteSearchInput({ inputRef, query, setQuery }: PaletteSearchInputProps) {
  return (
    <div className="flex items-center gap-3 border-b border-border/70 px-4 py-3.5 shrink-0 bg-card/40">
      <Search className="h-4.5 w-4.5 text-primary shrink-0" aria-hidden="true" />
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Search the school portal"
        placeholder="Type to search students, teachers, classes, exams, notices, fees…"
        className="flex-1 bg-transparent text-sm font-medium outline-none placeholder:text-muted-foreground/60 text-foreground"
      />
      {query && (
        <button
          onClick={() => setQuery('')}
          className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors focus-ring"
          aria-label="Clear search"
          title="Clear"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      )}
      <kbd className="hidden sm:inline-flex shrink-0 rounded-md border border-border/80 bg-muted/70 px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground" aria-hidden="true">
        ESC
      </kbd>
    </div>
  )
}
