'use client'

import { motion, AnimatePresence } from 'framer-motion'
import type { CommandPaletteProps } from './command-palette/types'
import { useCommandPalette } from './command-palette/use-command-palette'
import { PaletteSearchInput } from './command-palette/palette-search-input'
import { PaletteEmptyState } from './command-palette/palette-empty-state'
import { PaletteResultsList } from './command-palette/palette-results-list'
import { PaletteFooter } from './command-palette/palette-footer'

export function CommandPalette({ open, onOpenChange, groups = [], onNavigate, role = 'principal' }: CommandPaletteProps) {
  const palette = useCommandPalette({ open, onOpenChange, groups, role, onNavigate })

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.12 }}
          className="fixed inset-0 z-[100] flex items-start justify-center pt-[10vh] sm:pt-[14vh] px-3 sm:px-4"
        >
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => onOpenChange(false)}
          />

          {/* Dialog Panel - Compact Apple Spotlight / Raycast Style */}
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Global search — command palette"
            initial={{ opacity: 0, y: -12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="relative w-full max-w-xl overflow-hidden rounded-2xl border border-border/80 bg-background/95 backdrop-blur-2xl shadow-2xl flex flex-col max-h-[75vh] z-10"
          >
            <PaletteSearchInput
              inputRef={palette.inputRef}
              query={palette.query}
              setQuery={palette.setQuery}
            />

            {/* Content Container */}
            <div ref={palette.listRef} className="flex-1 overflow-y-auto p-2 no-scrollbar">
              {/* ZERO QUERY STATE: Clean, minimal prompt when empty */}
              {!palette.query.trim() && (
                <PaletteEmptyState
                  recentList={palette.recentList}
                  active={palette.active}
                  setActive={palette.setActive}
                  handleSelect={palette.handleSelect}
                  clearRecent={palette.clearRecent}
                  removeRecent={palette.removeRecent}
                />
              )}

              {/* ACTIVE QUERY RESULTS - Clean dynamic filtering */}
              {palette.query.trim() && (
                <PaletteResultsList
                  query={palette.query}
                  groupedResults={palette.groupedResults}
                  systemActions={palette.systemActions}
                  active={palette.active}
                  setActive={palette.setActive}
                  handleSelect={palette.handleSelect}
                />
              )}
            </div>

            <PaletteFooter />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
