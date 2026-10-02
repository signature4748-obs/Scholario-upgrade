'use client'

/**
 * DraftsList — the Drafts folder content (replaces the conversation list
 * while the Drafts folder is active).
 *
 * Shows EVERY draft, not just reply drafts:
 *   • reply drafts  → open the conversation with the draft loaded
 *   • new drafts    → reopen the composer pre-filled (recipient + text)
 *
 * Row actions (disclosed on hover / always on touch): Edit · Send now ·
 * Discard.
 */

import { useMemo } from 'react'
import { FileText, PenSquare, Send, Trash2, Clock } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  useMessagingStore, formatListTime, type Draft, type Conversation,
} from '@/lib/store/messaging-store'
import { ConversationAvatar } from './shared'
import { toast } from 'sonner'

interface Props {
  onEditNewDraft: (draft: Draft) => void
  /** Mobile: switch from list to thread after opening a conversation. */
  onOpenThread: () => void
}

export function DraftsList({ onEditNewDraft, onOpenThread }: Props) {
  const drafts = useMessagingStore((s) => s.drafts)
  const conversations = useMessagingStore((s) => s.conversations)
  const searchQuery = useMessagingStore((s) => s.searchQuery)
  const openConversation = useMessagingStore((s) => s.openConversation)
  const unarchiveConversation = useMessagingStore((s) => s.unarchiveConversation)
  const sendDraft = useMessagingStore((s) => s.sendDraft)
  const deleteDraft = useMessagingStore((s) => s.deleteDraft)

  const rows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    const sorted = [...drafts].sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    )
    if (!q) return sorted
    return sorted.filter((d) => {
      const convo = d.conversationId ? conversations.find((c) => c.id === d.conversationId) : undefined
      const target = convo?.name ?? d.recipientName ?? ''
      return target.toLowerCase().includes(q) || d.text.toLowerCase().includes(q)
    })
  }, [drafts, conversations, searchQuery])

  const editDraft = (draft: Draft) => {
    if (draft.conversationId) {
      const convo = conversations.find((c) => c.id === draft.conversationId)
      if (convo?.archived) unarchiveConversation(convo.id)
      openConversation(draft.conversationId)
      onOpenThread()
    } else {
      onEditNewDraft(draft)
    }
  }

  const handleSend = async (draft: Draft) => {
    // 8B-7-d — the draft goes out through the server; it is consumed
    // only when a row was actually persisted (failures keep the draft).
    const result = await sendDraft(draft.id)
    const target = draft.conversationId
      ? conversations.find((c) => c.id === draft.conversationId)?.name
      : draft.recipientName
    if (!result.ok) {
      toast.error('Draft not sent', { description: result.error ?? 'Please try again.' })
      return
    }
    toast.success('Draft sent', { description: `To ${target ?? 'recipient'}` })
    onOpenThread()
  }

  const handleDiscard = (draft: Draft) => {
    deleteDraft(draft.id)
    toast.success('Draft discarded')
  }

  return (
    <div className="flex h-full min-w-0 flex-col bg-card">
      {/* Header — consistent with the conversation list */}
      <div className="shrink-0 space-y-2.5 border-b border-border px-3 pb-2.5 pt-3">
        <div className="flex items-center gap-1.5">
          <h2 className="truncate text-[13px] font-semibold text-foreground">Drafts</h2>
          {rows.length > 0 && (
            <span className="inline-flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-muted px-1.5 text-[10px] font-semibold tabular-nums text-muted-foreground">
              {rows.length}
            </span>
          )}
        </div>
        <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <FileText className="h-3 w-3" /> Unfinished messages — pick one to continue.
        </p>
      </div>

      <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto">
        {rows.length > 0 ? (
          rows.map((d) => (
            <DraftRow
              key={d.id}
              draft={d}
              convo={d.conversationId ? conversations.find((c) => c.id === d.conversationId) : undefined}
              onEdit={() => editDraft(d)}
              onSend={() => handleSend(d)}
              onDiscard={() => handleDiscard(d)}
            />
          ))
        ) : (
          <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
            <div className="mb-2.5 flex h-12 w-12 items-center justify-center rounded-full bg-muted/50 text-muted-foreground/50">
              <FileText className="h-6 w-6" />
            </div>
            <p className="text-xs font-medium text-muted-foreground">
              {searchQuery.trim() ? 'No drafts match your search' : 'No drafts'}
            </p>
            <p className="mt-0.5 text-[11px] text-muted-foreground/70">
              {searchQuery.trim() ? 'Try a different search term.' : 'Messages you start and save will appear here.'}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

function DraftRow({
  draft, convo, onEdit, onSend, onDiscard,
}: {
  draft: Draft
  convo?: Conversation
  onEdit: () => void
  onSend: () => void
  onDiscard: () => void
}) {
  const name = convo?.name ?? draft.recipientName ?? 'No recipient'
  const avatar = convo?.avatar ?? (name !== 'No recipient' ? name.split(' ').map((n) => n[0]).slice(0, 2).join('') : '—')
  const type = convo?.type ?? 'staff'

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onEdit}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onEdit() } }}
      className="group relative cursor-pointer border-b border-border/40 px-3 py-2.5 outline-none transition-colors hover:bg-muted/40 focus-visible:bg-muted/40"
    >
      <div className="flex items-start gap-2.5">
        <ConversationAvatar avatar={avatar} type={type} />

        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="flex min-w-0 items-center gap-1.5 truncate text-[13px] font-medium text-foreground/85">
              <span className="truncate">{name}</span>
              <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-semibold text-muted-foreground">
                <FileText className="h-2.5 w-2.5" /> Draft
              </span>
              {convo?.archived && (
                <span className="shrink-0 text-[10px] text-muted-foreground/60">· archived</span>
              )}
            </p>
            <span className="flex shrink-0 items-center gap-0.5 text-[10px] tabular-nums text-muted-foreground/80">
              <Clock className="h-2.5 w-2.5" />
              {formatListTime(draft.timestamp)}
            </span>
          </div>
          <p className="mt-0.5 truncate text-[11.5px] leading-snug text-muted-foreground">
            {draft.text}
          </p>
        </div>
      </div>

      {/* Row actions — visible on hover (desktop) / always small (touch) */}
      <div className="absolute bottom-1.5 right-2 flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 max-md:opacity-60">
        <button
          onClick={(e) => { e.stopPropagation(); onEdit() }}
          aria-label="Edit draft"
          title="Edit draft"
          className="flex h-6.5 w-6.5 items-center justify-center rounded-md bg-card/80 text-muted-foreground shadow-xs transition-colors hover:bg-muted hover:text-foreground"
        >
          <PenSquare className="h-3 w-3" />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onSend() }}
          aria-label="Send draft now"
          title="Send draft now"
          className="flex h-6.5 w-6.5 items-center justify-center rounded-md bg-card/80 text-muted-foreground shadow-xs transition-colors hover:bg-emerald-500/10 hover:text-emerald-600"
        >
          <Send className="h-3 w-3" />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onDiscard() }}
          aria-label="Discard draft"
          title="Discard draft"
          className={cn(
            'flex h-6.5 w-6.5 items-center justify-center rounded-md bg-card/80 text-muted-foreground shadow-xs transition-colors hover:bg-rose-500/10 hover:text-rose-600',
          )}
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
    </div>
  )
}
