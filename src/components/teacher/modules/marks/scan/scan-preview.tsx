'use client'

/**
 * marks/scan/scan-preview — the scanned document view. Desktop/tablet
 * review shows it beside the grid (split screen); mobile switches with
 * [Scan] [Data] tabs. The amber rectangle is the REAL source region of
 * the focused marks cell (coordinates from table detection — never a
 * fake mapping), scaled from the processed image to the preview box.
 */

import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, FileImage, ScanSearch } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ScanPage, ScanRow } from '@/lib/marks-scan/types'

interface ScanPreviewProps {
  pages: ScanPage[]
  activePage: number
  onPageChange: (idx: number) => void
  /** Focused review row — drives the source-region highlight. */
  highlightRow: ScanRow | null
  className?: string
}

export function ScanPreview({ pages, activePage, onPageChange, highlightRow, className }: ScanPreviewProps) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [boxSize, setBoxSize] = useState<{ w: number; h: number } | null>(null)
  const page = pages[activePage] ?? pages[0] ?? null

  // The highlight uses the processed-image coordinate space; the preview
  // letterboxes inside the wrapper — observe the rendered image box.
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const update = () => {
      const img = el.querySelector('img')
      if (img) {
        const _r = img.getBoundingClientRect()
        const wrap = el.getBoundingClientRect()
        // displayed image size (object-contain letterbox math)
        const scale = Math.min(wrap.width / (page?.width ?? 1), wrap.height / (page?.height ?? 1))
        setBoxSize({ w: (page?.width ?? 1) * scale, h: (page?.height ?? 1) * scale })
      } else {
        setBoxSize(null)
      }
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [page?.width, page?.height, activePage])

  const highlight =
    highlightRow?.box && highlightRow.pageId && page && highlightRow.pageId === page.id
      ? highlightRow.box
      : null

  return (
    <div className={cn('flex min-h-0 flex-col', className)}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          <ScanSearch className="h-3.5 w-3.5" aria-hidden="true" />
          Sheet preview
        </p>
        {pages.length > 1 && (
          <div className="flex items-center gap-1 rounded-lg border border-border bg-muted/40 p-0.5">
            <button
              type="button"
              onClick={() => onPageChange(Math.max(0, activePage - 1))}
              disabled={activePage === 0}
              className="rounded-md p-1 text-muted-foreground hover:bg-background hover:text-foreground disabled:opacity-40"
              aria-label="Previous page"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <span className="px-1 text-[11px] font-medium tabular-nums text-foreground">
              {activePage + 1} / {pages.length}
            </span>
            <button
              type="button"
              onClick={() => onPageChange(Math.min(pages.length - 1, activePage + 1))}
              disabled={activePage >= pages.length - 1}
              className="rounded-md p-1 text-muted-foreground hover:bg-background hover:text-foreground disabled:opacity-40"
              aria-label="Next page"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>
      <div
        ref={wrapRef}
        className="relative flex min-h-56 flex-1 items-center justify-center overflow-hidden rounded-xl border border-border bg-muted/30 p-2"
      >
        {page ? (
          <>
            <img
              src={page.dataUrl}
              alt={`Scanned marks sheet page ${activePage + 1} (${page.name})`}
              className="max-h-full max-w-full rounded-md object-contain shadow-sm"
              draggable={false}
            />
            {highlight && boxSize && (
              <div
                className="pointer-events-none absolute rounded-[3px] border-2 border-amber-500 bg-amber-400/15 shadow-[0_0_0_3px_rgba(245,158,11,0.15)]"
                style={{
                  left: `calc(50% - ${boxSize.w / 2}px + ${(highlight.x / (page?.width ?? 1)) * boxSize.w}px)`,
                  top: `calc(50% - ${boxSize.h / 2}px + ${(highlight.y / (page?.height ?? 1)) * boxSize.h}px)`,
                  width: `${(highlight.w / (page?.width ?? 1)) * boxSize.w}px`,
                  height: `${(highlight.h / (page?.height ?? 1)) * boxSize.h}px`,
                }}
              />
            )}
          </>
        ) : (
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <FileImage className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
            <p className="text-xs text-muted-foreground">
              {highlightRow && highlightRow.pageId
                ? 'This row was detected on another page.'
                : 'The scanned sheet appears here once processed.'}
            </p>
          </div>
        )}
      </div>
      <p className="mt-1.5 text-[10px] text-muted-foreground">
        Focus a marks cell to see its source region highlighted.
      </p>
    </div>
  )
}
