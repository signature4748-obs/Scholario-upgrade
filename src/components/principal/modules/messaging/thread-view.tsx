'use client'

/**
 * ThreadView — the active conversation.
 *
 * Modern professional chat anatomy:
 *   Header    → back (mobile) · avatar + name (tap → contact sheet) · menu
 *   Messages  → date dividers, consecutive-sender grouping, incoming
 *               (soft card) vs outgoing (calm emerald) bubbles, subtle
 *               timestamps and delivery ticks
 *   Composer  → auto-growing textarea pinned to the bottom, quiet draft
 *               auto-save
 *
 * All additional actions live behind one clean "…" menu — the chat surface
 * itself stays free of controls. No fake online/typing indicators.
 */

import { useState, useRef, useEffect, useMemo } from 'react'
import { motion } from 'framer-motion'
import {
  Send, Star, Archive, MoreHorizontal, AlertCircle, ArrowLeft,
  Check, Settings2, RotateCcw, Info, ChevronDown, MailX,
} from 'lucide-react'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import {
  useMessagingStore, formatMessageTime, formatDayLabel, type Message,
} from '@/lib/store/messaging-store'
import { ConversationAvatar } from './shared'
import { ContactDetailsSheet } from './contact-details'
import { toast } from 'sonner'

interface Props {
  /** Return to the conversation list (mobile only). */
  onBack: () => void
  onManageGroup: (groupId: string) => void
  /** Open a member's conversation, else a pre-addressed compose. */
  onContactMember: (name: string) => void
}

export function ThreadView({ onBack, onManageGroup, onContactMember }: Props) {
  const activeId = useMessagingStore((s) => s.activeConversationId)
  const conversations = useMessagingStore((s) => s.conversations)
  const messages = useMessagingStore((s) => s.messages)
  const sendMessage = useMessagingStore((s) => s.sendMessage)
  const starConversation = useMessagingStore((s) => s.starConversation)
  const archiveConversation = useMessagingStore((s) => s.archiveConversation)
  const unarchiveConversation = useMessagingStore((s) => s.unarchiveConversation)
  const markUrgent = useMessagingStore((s) => s.markUrgent)
  const markUnread = useMessagingStore((s) => s.markUnread)
  const saveDraft = useMessagingStore((s) => s.saveDraft)
  const deleteDraft = useMessagingStore((s) => s.deleteDraft)
  const drafts = useMessagingStore((s) => s.drafts)
  const getGroupByConversationId = useMessagingStore((s) => s.getGroupByConversationId)

  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const convo = conversations.find((c) => c.id === activeId)
  const thread = activeId ? (messages[activeId] ?? []) : []
  const existingDraft = drafts.find((d) => d.conversationId === activeId)

  // Load draft text when switching conversations; clear stale draft state
  useEffect(() => {
    setText(existingDraft?.text ?? '')
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
  }, [activeId])

  // Keep the newest message in view — scroll ONLY the messages pane.
  // (scrollIntoView would also scroll the app-shell page container and
  // shift the whole module out of place.)
  // Deferred one frame so the newest message's full height (and any day
  // separators) are measured before scrolling — otherwise the tail can
  // land partially behind the composer.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const raf = requestAnimationFrame(() => {
      el.scrollTo({ top: el.scrollHeight })
    })
    return () => cancelAnimationFrame(raf)
  }, [thread.length, activeId])

  // Quiet draft auto-save (debounced)
  useEffect(() => {
    if (!activeId) return
    if (!text.trim()) {
      if (existingDraft) deleteDraft(existingDraft.id)
      return
    }
    if (existingDraft?.text === text) return
    const timer = setTimeout(() => saveDraft(activeId, text), 1200)
    return () => clearTimeout(timer)
  }, [text, activeId])

  // Auto-grow the reply textarea
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`
  }, [text])

  const handleSend = async () => {
    if (!text.trim() || !activeId) return
    setSending(true)
    // 8B-7-d — server POST: optimistic bubble in the store, the server
    // row replaces it (group threads fan out real direct messages).
    const result = await sendMessage(activeId, text)
    setSending(false)
    if (!result.ok) {
      toast.error('Message not sent', { description: result.error })
      return
    }
    setText('')
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
    // Reply drafts are removed once sent
    const draft = useMessagingStore.getState().drafts.find((d) => d.conversationId === activeId)
    if (draft) deleteDraft(draft.id)
    toast.success(
      'Message sent',
      result.skipped && result.skipped > 0
        ? { description: `${result.skipped} member${result.skipped === 1 ? '' : 's'} without messaging accounts were skipped` }
        : undefined,
    )
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const group = convo ? getGroupByConversationId(convo.id) : undefined

  if (!convo) {
    return (
      <div className="flex min-w-0 flex-1 flex-col items-center justify-center bg-muted/20">
        <div className="text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-card shadow-sm border border-border">
            <Send className="h-6 w-6 text-muted-foreground/40" />
          </div>
          <p className="text-sm font-medium text-muted-foreground">Select a conversation</p>
          <p className="mt-1 text-[11px] text-muted-foreground/60">
            Pick a thread from the list to read and reply.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {/* Header */}
      <div className="flex h-14 shrink-0 items-center gap-1.5 border-b border-border bg-card px-2 sm:px-3">
        <button
          onClick={onBack}
          aria-label="Back to conversations"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground md:hidden"
        >
          <ArrowLeft className="h-4.5 w-4.5" />
        </button>

        {/* Tap to reveal contact/group details */}
        <button
          onClick={() => setDetailsOpen(true)}
          aria-label={`Open details for ${convo.name}`}
          className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-1.5 py-1 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25"
        >
          <ConversationAvatar avatar={convo.avatar} type={convo.type} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <p className="truncate text-[13px] font-semibold text-foreground">{convo.name}</p>
              {convo.urgent && <AlertCircle className="h-3 w-3 shrink-0 text-rose-500" aria-label="Urgent" />}
            </div>
            <p className="truncate text-[11px] text-muted-foreground">{convo.role}</p>
          </div>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40" />
        </button>

        {/* Single clean actions menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label="Conversation actions"
            >
              <MoreHorizontal className="h-4.5 w-4.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onClick={() => setDetailsOpen(true)}>
              <Info className="h-3.5 w-3.5" /> Contact details
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                starConversation(convo.id)
                toast.success(convo.starred ? 'Removed from Starred' : 'Added to Starred')
              }}
            >
              <Star className={cn('h-3.5 w-3.5', convo.starred && 'fill-amber-400 text-amber-400')} />
              {convo.starred ? 'Unstar' : 'Star'}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                markUnread(convo.id)
                toast.success('Marked as unread')
              }}
            >
              <MailX className="h-3.5 w-3.5" /> Mark as unread
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {group && (
              <DropdownMenuItem onClick={() => onManageGroup(group.id)}>
                <Settings2 className="h-3.5 w-3.5" /> Manage members
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              className="text-rose-600 focus:text-rose-600"
              onClick={() => { markUrgent(convo.id); toast.success(convo.urgent ? 'Urgent flag removed' : 'Marked as urgent') }}
            >
              <AlertCircle className="h-3.5 w-3.5" /> {convo.urgent ? 'Remove urgent' : 'Mark as urgent'}
            </DropdownMenuItem>
            {convo.archived ? (
              <DropdownMenuItem
                onClick={() => { unarchiveConversation(convo.id); toast.success('Restored to Inbox') }}
              >
                <RotateCcw className="h-3.5 w-3.5" /> Restore to Inbox
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem
                className="text-rose-600 focus:text-rose-600"
                onClick={() => { archiveConversation(convo.id); toast.success('Archived — history preserved') }}
              >
                <Archive className="h-3.5 w-3.5" /> Archive
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="custom-scrollbar min-h-0 flex-1 overflow-y-auto bg-muted/20 px-3 py-3 sm:px-5 sm:py-4">
        {thread.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-[11px] text-muted-foreground/60">No messages yet — say hello.</p>
          </div>
        ) : (
          <MessageTimeline thread={thread} convoName={convo.name} />
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Composer — pinned bottom (respects iOS safe area on mobile) */}
      <div className="shrink-0 border-t border-border bg-card p-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] sm:p-2.5 sm:pb-2.5">
        <div className="flex items-end gap-2">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={`Message ${convo.name.split(' ')[0]}…`}
            rows={1}
            aria-label="Reply message"
            className="custom-scrollbar min-h-9 max-h-32 flex-1 resize-none rounded-xl border border-border bg-card px-3 py-2 text-[13px] leading-snug text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/25"
          />
          <button
            onClick={handleSend}
            disabled={!text.trim() || sending}
            aria-label="Send message"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-xs transition-all hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
        {existingDraft && text.trim() && (
          <p className="mt-1 px-1 text-[10px] text-muted-foreground/60">Draft saved</p>
        )}
      </div>

      {/* Contact / group details */}
      <ContactDetailsSheet
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
        conversation={convo}
        onManageGroup={onManageGroup}
        onContactMember={onContactMember}
        onStar={(id) => { starConversation(id); setDetailsOpen(false) }}
        onArchive={(id) => {
          if (convo.archived) { unarchiveConversation(id); toast.success('Restored to Inbox') }
          else { archiveConversation(id); toast.success('Archived') }
        }}
      />
    </div>
  )
}

// ─── Message timeline (date dividers + sender grouping) ──────────────

function MessageTimeline({ thread, convoName }: { thread: Message[]; convoName: string }) {
  const items = useMemo(() => {
    const out: Array<
      | { kind: 'day'; key: string; label: string }
      | { kind: 'msg'; key: string; msg: Message; first: boolean; last: boolean; convoName: string }
    > = []
    let lastDay = ''
    let lastSender = ''
    thread.forEach((msg, i) => {
      const day = new Date(msg.timestamp).toDateString()
      if (day !== lastDay) {
        out.push({ kind: 'day', key: `day-${day}`, label: formatDayLabel(msg.timestamp) })
        lastDay = day
        lastSender = ''
      }
      const next = thread[i + 1]
      const senderKey = `${msg.sender}:${msg.senderName ?? ''}`
      const nextKey = next ? `${next.sender}:${next.senderName ?? ''}` : ''
      const first = lastSender !== senderKey
      const last = !next || nextKey !== senderKey
      out.push({ kind: 'msg', key: msg.id, msg, first, last, convoName })
      lastSender = senderKey
    })
    return out
  }, [thread, convoName])

  return (
    <div className="mx-auto flex max-w-2xl flex-col">
      {items.map((item) =>
        item.kind === 'day' ? (
          <div key={item.key} className="my-2 flex items-center justify-center">
            <span className="rounded-full bg-border/60 px-2.5 py-0.5 text-[10px] font-medium tracking-wide text-muted-foreground">
              {item.label}
            </span>
          </div>
        ) : (
          <MessageRow
            key={item.key}
            msg={item.msg}
            first={item.first}
            last={item.last}
          />
        ),
      )}
    </div>
  )
}

function MessageRow({ msg, first, last }: { msg: Message; first: boolean; last: boolean }) {
  const isMe = msg.sender === 'me'
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15 }}
      className={cn('flex', isMe ? 'justify-end' : 'justify-start', !first && 'mt-0.5', first && 'mt-1.5')}
    >
      <div
        className={cn(
          'max-w-[82%] px-3.5 py-[7px] text-[13px] leading-relaxed sm:max-w-[72%]',
          isMe
            ? 'rounded-2xl bg-primary text-primary-foreground'
            : 'rounded-2xl border border-border bg-card text-foreground',
          isMe ? (last ? 'rounded-br-md' : 'rounded-br-lg') : last ? 'rounded-bl-md' : 'rounded-bl-lg',
        )}
      >
        {!isMe && msg.senderName && first && (
          <p className="mb-0.5 text-[10px] font-semibold text-violet-600 dark:text-violet-400">
            {msg.senderName}
          </p>
        )}
        <p className="whitespace-pre-wrap break-words">{msg.text}</p>
        {(isMe || last) && (
          <div
            className={cn(
              'mt-0.5 flex items-center justify-end gap-0.5',
              isMe ? 'text-primary-foreground/60' : 'text-muted-foreground/70',
            )}
          >
            <span className="text-[9px] tabular-nums">{formatMessageTime(msg.timestamp)}</span>
            {isMe && msg.status === 'sent' && <Check className="h-2.5 w-2.5" aria-label="Sent" />}
          </div>
        )}
      </div>
    </motion.div>
  )
}
