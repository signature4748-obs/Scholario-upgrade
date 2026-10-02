'use client'

/**
 * FoldersNav — folder + label navigation, shared by two surfaces:
 *
 *   • Desktop rail (lg+) — a quiet, always-visible column.
 *   • Mobile / tablet drawer — the same nav inside a Sheet, opened via
 *     the hamburger in the conversation-list header.
 *
 * Progressive disclosure: labels are collapsed behind a subtle toggle by
 * default; counts only appear when non-zero; clicking a folder/label is
 * the only way its content reveals in the middle pane.
 */

import { useState } from 'react'
import { Inbox, Star, Send, Users, FileText, Archive, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useMessagingStore, type Folder, type Label } from '@/lib/store/messaging-store'
import { LABEL_DOT } from './shared'

interface Props {
  /** Close the containing drawer (mobile) after a selection. */
  onNavigate?: () => void
  /** `drawer` renders slightly larger rows with comfortable touch targets. */
  variant?: 'rail' | 'drawer'
}

export function FoldersNav({ onNavigate, variant = 'rail' }: Props) {
  const activeFolder = useMessagingStore((s) => s.activeFolder)
  const setActiveFolder = useMessagingStore((s) => s.setActiveFolder)
  const activeLabel = useMessagingStore((s) => s.activeLabel)
  const setActiveLabel = useMessagingStore((s) => s.setActiveLabel)
  const conversations = useMessagingStore((s) => s.conversations)
  const groups = useMessagingStore((s) => s.groups)
  const drafts = useMessagingStore((s) => s.drafts)
  const [labelsOpen, setLabelsOpen] = useState(false)

  const inboxCount = conversations.filter((c) => !c.archived && c.unread > 0).length
  const starredCount = conversations.filter((c) => c.starred && !c.archived).length
  // 8B-7-d — server truth: a thread belongs to Sent when its newest
  // message is the viewer's (no reliance on loaded local history).
  const sentCount = conversations.filter((c) => c.lastFromMe && !c.archived).length
  const groupCount = groups.length
  const draftCount = drafts.length
  const archiveCount = conversations.filter((c) => c.archived).length

  const folders: Array<{ id: Folder; label: string; icon: React.ReactNode; count: number; highlight?: boolean }> = [
    { id: 'inbox', label: 'Inbox', icon: <Inbox className="h-4 w-4" />, count: inboxCount, highlight: true },
    { id: 'starred', label: 'Starred', icon: <Star className="h-4 w-4" />, count: starredCount },
    { id: 'sent', label: 'Sent', icon: <Send className="h-4 w-4" />, count: sentCount },
    { id: 'groups', label: 'Groups', icon: <Users className="h-4 w-4" />, count: groupCount },
    { id: 'drafts', label: 'Drafts', icon: <FileText className="h-4 w-4" />, count: draftCount },
    { id: 'archive', label: 'Archive', icon: <Archive className="h-4 w-4" />, count: archiveCount },
  ]

  const labels: Array<{ id: Label; label: string; count: number }> = [
    { id: 'Staff', label: 'Staff', count: conversations.filter((c) => c.type === 'staff' && !c.archived).length },
    { id: 'Parents', label: 'Parents', count: conversations.filter((c) => c.type === 'parent' && !c.archived).length },
    { id: 'Groups', label: 'Groups', count: conversations.filter((c) => c.type === 'group' && !c.archived).length },
    { id: 'Urgent', label: 'Urgent', count: conversations.filter((c) => c.urgent && !c.archived).length },
  ]

  const rowPad = variant === 'drawer' ? 'py-2.5' : 'py-[7px]'
  const countCls =
    variant === 'drawer'
      ? 'min-w-5 h-5 px-1.5 text-[10px]'
      : 'min-w-4.5 h-4.5 px-1 text-[9.5px]'

  const selectFolder = (id: Folder) => {
    setActiveFolder(id)
    onNavigate?.()
  }

  return (
    <nav aria-label="Message folders" className="flex flex-col gap-0.5">
      <p className={cn(
        'px-2.5 font-semibold uppercase tracking-wider text-muted-foreground/70',
        variant === 'drawer' ? 'text-[11px] pt-1 pb-2' : 'text-[10px] py-1.5',
      )}>
        Folders
      </p>

      {folders.map((f) => {
        const active = activeFolder === f.id && !activeLabel
        return (
          <button
            key={f.id}
            onClick={() => selectFolder(f.id)}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'relative flex w-full items-center gap-2.5 rounded-lg pr-2 text-left transition-colors',
              rowPad,
              'pl-3',
              active
                ? 'bg-primary/10 font-medium text-primary'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground',
            )}
          >
            {active && <span className="absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-r-full bg-primary" />}
            {f.icon}
            <span className="flex-1 text-[13px] leading-none">{f.label}</span>
            {f.count > 0 && (
              <span className={cn(
                'inline-flex items-center justify-center rounded-full font-semibold tabular-nums',
                countCls,
                f.highlight && f.id === 'inbox' && !active
                  ? 'bg-primary/15 text-primary'
                  : active
                    ? 'bg-primary/20 text-primary'
                    : 'bg-muted text-muted-foreground',
              )}>
                {f.count > 99 ? '99+' : f.count}
              </span>
            )}
          </button>
        )
      })}

      {/* Labels — collapsed by default (progressive disclosure) */}
      <button
        onClick={() => setLabelsOpen((o) => !o)}
        aria-expanded={labelsOpen}
        className={cn(
          'mt-3 flex w-full items-center gap-2.5 rounded-lg px-3 text-left transition-colors',
          rowPad,
          'text-muted-foreground hover:bg-accent hover:text-foreground',
        )}
      >
        <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', !labelsOpen && '-rotate-90')} />
        <span className="flex-1 text-[13px] font-medium leading-none">Labels</span>
        {activeLabel && <span className="h-1.5 w-1.5 rounded-full bg-primary" />}
      </button>

      {labelsOpen && (
        <div className="flex flex-col gap-0.5 pt-0.5">
          {labels.map((l) => {
            const active = activeLabel === l.id
            return (
              <button
                key={l.id}
                onClick={() => {
                  // Labels filter conversations — jump back to a folder that
                  // shows them (Groups/Drafts replace the conversation list).
                  if (activeFolder === 'groups' || activeFolder === 'drafts') {
                    setActiveFolder('inbox')
                  }
                  setActiveLabel(active ? null : l.id)
                  onNavigate?.()
                }}
                aria-pressed={active}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-lg pl-7 pr-2 text-left transition-colors',
                  rowPad,
                  active
                    ? 'bg-primary/10 font-medium text-primary'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                )}
              >
                <span className={cn('h-2 w-2 shrink-0 rounded-full', LABEL_DOT[l.id])} />
                <span className="flex-1 text-[13px] leading-none">{l.label}</span>
                {l.count > 0 && (
                  <span className="text-[10px] font-medium tabular-nums text-muted-foreground">{l.count}</span>
                )}
              </button>
            )
          })}
          {activeLabel && (
            <button
              onClick={() => setActiveLabel(null)}
              className="mt-1 px-7 text-left text-[11px] text-muted-foreground/80 hover:text-foreground underline underline-offset-2"
            >
              Clear label filter
            </button>
          )}
        </div>
      )}
    </nav>
  )
}
