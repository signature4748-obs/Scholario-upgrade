'use client'

/**
 * ComposeModal — the primary "New Message" action.
 *
 * Progressive reveal, one step at a time:
 *   1. Recipient — searchable, grouped (Staff / Parents / Groups), with
 *      keyboard navigation (↑ ↓ Enter)
 *   2. Message   — recipient chip (replaceable) + auto-growing textarea
 *   3. Send · Save draft
 *
 * Responsive: centered dialog on desktop, bottom sheet on mobile
 * (rounded top, safe-area aware, full width).
 */

import { useState, useMemo, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Search, Send, X, Users, PenSquare, ArrowLeft } from 'lucide-react'
import { useIsMobile } from '@/hooks/use-mobile'
import { useMessagingStore, getRecipientOptions } from '@/lib/store/messaging-store'
import { ConversationAvatar } from './shared'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

export interface ComposePrefill {
  recipient?: string | null
  text?: string
}

interface Props {
  open: boolean
  onClose: () => void
  /** Pre-fill the recipient and/or message text (deep-links, drafts). */
  prefill?: ComposePrefill | null
}

export function ComposeModal({ open, onClose, prefill }: Props) {
  const isMobile = useIsMobile()
  const composeNew = useMessagingStore((s) => s.composeNew)
  const sendMessage = useMessagingStore((s) => s.sendMessage)
  const conversations = useMessagingStore((s) => s.conversations)
  const groups = useMessagingStore((s) => s.groups)
  // 8B-7-d — the recipient picker reads the real same-school directory
  // (server-synced with the threads) + the local groups.
  const directory = useMessagingStore((s) => s.directory)
  const openConversation = useMessagingStore((s) => s.openConversation)
  const setActiveFolder = useMessagingStore((s) => s.setActiveFolder)
  const saveNewDraft = useMessagingStore((s) => s.saveNewDraft)

  const [search, setSearch] = useState('')
  const [recipient, setRecipient] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  const recipients = useMemo(() => getRecipientOptions(), [groups, directory])

  const filtered = useMemo(() => {
    if (!search.trim()) return recipients
    const q = search.toLowerCase()
    return recipients.filter(
      (r) => r.name.toLowerCase().includes(q) || r.role.toLowerCase().includes(q),
    )
  }, [recipients, search])

  // Sectioned list: Staff / Parents / Students / Groups with their filtered subsets
  const sections = useMemo(() => {
    const staff = filtered.filter((r) => r.type === 'staff')
    const parents = filtered.filter((r) => r.type === 'parent')
    const students = filtered.filter((r) => r.type === 'student')
    const grp = filtered.filter((r) => r.type === 'group')
    return [
      { id: 'staff', label: 'Staff', items: staff },
      { id: 'parents', label: 'Parents', items: parents },
      { id: 'students', label: 'Students', items: students },
      { id: 'groups', label: 'Groups', items: grp },
    ].filter((s) => s.items.length > 0)
  }, [filtered])

  // Reset on open (apply prefill if provided)
  useEffect(() => {
    if (open) {
      setSearch('')
      setText(prefill?.text ?? '')
      setRecipient(prefill?.recipient ?? null)
      setActiveIndex(0)
    }
  }, [open, prefill])

  // ESC closes (treated as save-draft-if-text)
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        // Same semantics as the header X / overlay click
        if (text.trim()) {
          saveNewDraft(recipient ?? '(no recipient)', text)
          toast.info('Draft saved')
        }
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, text, recipient])

  // Keep the highlighted row in view
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${activeIndex}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  const recipientData = recipients.find((r) => r.name === recipient)
  const isGroupRecipient = recipientData?.type === 'group'

  const handleClose = () => {
    // Closing with typed text quietly preserves it as a draft so it can be
    // finished later from the Drafts folder.
    if (text.trim()) {
      saveNewDraft(recipient ?? '(no recipient)', text)
      toast.info('Draft saved')
    }
    onClose()
  }

  const handleSend = async () => {
    if (!recipient) { toast.error('Select a recipient first'); return }
    if (!text.trim()) { toast.error('Write a message first'); return }
    setSending(true)
    try {
      // 8B-7-d — threads are keyed by the counterpart USER id; the
      // existing conversation (if any) matches by id, else by name.
      const recipientData = recipients.find((r) => r.name === recipient)
      const existing =
        (recipientData?.userId && conversations.find((c) => c.id === recipientData.userId)) ||
        conversations.find((c) => c.name === recipient && !c.archived)
      const result = existing
        ? await sendMessage(existing.id, text)
        : await composeNew(recipient, text)
      if (!result.ok) {
        toast.error('Message not sent', { description: result.error })
        return
      }
      if (existing) {
        openConversation(existing.id)
        setActiveFolder(existing.type === 'group' ? 'groups' : existing.archived ? 'archive' : 'inbox')
      }
      if (result.skipped && result.skipped > 0) {
        toast.success('Message sent', {
          description: `To ${recipient} · ${result.skipped} member${result.skipped === 1 ? '' : 's'} without messaging accounts were skipped`,
        })
      } else {
        toast.success('Message sent', { description: `To ${recipient}` })
      }
      onClose()
    } finally {
      setSending(false)
    }
  }

  const handleSaveDraft = () => {
    if (!text.trim()) { onClose(); return }
    saveNewDraft(recipient ?? '(no recipient)', text)
    toast.success('Draft saved', { description: 'Find it in the Drafts folder' })
    onClose()
  }

  // Keyboard navigation on the recipient list
  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => Math.min(i + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const r = filtered[activeIndex]
      if (r) { setRecipient(r.name); setText(prefill?.text ?? '') }
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-[2px] sm:items-center sm:p-4"
          onClick={handleClose}
          role="dialog"
          aria-modal="true"
          aria-label="New message"
        >
          <motion.div
            initial={isMobile ? { y: '100%' } : { scale: 0.97, opacity: 0 }}
            animate={isMobile ? { y: 0 } : { scale: 1, opacity: 1 }}
            exit={isMobile ? { y: '100%' } : { scale: 0.97, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.32, 0.72, 0, 1] }}
            className={cn(
              'flex max-h-[92dvh] w-full flex-col overflow-hidden border border-border bg-card shadow-2xl',
              'sm:max-h-[85vh] sm:w-[26rem] sm:rounded-2xl',
              isMobile ? 'rounded-t-2xl' : '',
            )}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
              {recipient && (
                <button
                  onClick={() => setRecipient(null)}
                  aria-label="Change recipient"
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:hidden"
                >
                  <ArrowLeft className="h-4 w-4" />
                </button>
              )}
              <h3 className="flex-1 text-[13px] font-semibold text-foreground">
                {recipient ? 'New message' : 'Select recipient'}
              </h3>
              <button
                onClick={handleClose}
                aria-label="Close composer"
                className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Step 1 — recipient search */}
            {!recipient ? (
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="shrink-0 border-b border-border/60 px-3 py-2.5">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                    <input
                      autoFocus
                      value={search}
                      onChange={(e) => { setSearch(e.target.value); setActiveIndex(0) }}
                      onKeyDown={handleSearchKeyDown}
                      placeholder="Search staff, parents, students, or groups…"
                      aria-label="Search recipients"
                      className="h-9 w-full rounded-lg border border-border bg-card pl-8 pr-3 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/25"
                    />
                  </div>
                </div>

                <div ref={listRef} className="custom-scrollbar min-h-0 flex-1 overflow-y-auto py-1.5">
                  {sections.map((section) => (
                    <div key={section.id}>
                      <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                        {section.label} · {section.items.length}
                      </p>
                      {section.items.map((r) => {
                        const idx = filtered.indexOf(r)
                        const active = activeIndex === idx
                        return (
                          <button
                            key={`${r.type}-${r.name}`}
                            data-idx={idx}
                            onClick={() => setRecipient(r.name)}
                            onMouseEnter={() => setActiveIndex(idx)}
                            className={cn(
                              'flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors',
                              active ? 'bg-primary/[0.08]' : 'hover:bg-muted/40',
                            )}
                          >
                            <ConversationAvatar avatar={r.avatar} type={r.type} size="sm" />
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-[13px] font-medium text-foreground">{r.name}</p>
                              <p className="truncate text-[11px] text-muted-foreground">{r.role}</p>
                            </div>
                            {r.type === 'group' && (
                              <Users className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
                            )}
                          </button>
                        )
                      })}
                    </div>
                  ))}

                  {filtered.length === 0 && (
                    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
                      <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-muted/50 text-muted-foreground/50">
                        <Search className="h-4.5 w-4.5" />
                      </div>
                      <p className="text-xs font-medium text-muted-foreground">No recipients match “{search}”</p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground/70">
                        Try a name, role, or group name.
                      </p>
                    </div>
                  )}
                </div>

                <div className="shrink-0 border-t border-border/60 px-3 py-2">
                  <p className="text-[10px] text-muted-foreground/60">
                    ↑↓ to browse · Enter to select
                  </p>
                </div>
              </div>
            ) : (
              /* Step 2 — message */
              <div className="flex min-h-0 flex-1 flex-col">
                {/* Recipient chip */}
                <div className="flex shrink-0 items-center gap-2.5 border-b border-border/60 px-3 py-2.5">
                  <div className="flex min-w-0 flex-1 items-center gap-2.5">
                    <ConversationAvatar
                      avatar={recipientData?.avatar ?? '?'}
                      type={recipientData?.type ?? 'staff'}
                      size="sm"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-medium text-foreground">{recipient}</p>
                      <p className="truncate text-[11px] text-muted-foreground">{recipientData?.role}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => setRecipient(null)}
                    className="hidden h-8 items-center gap-1 rounded-lg border border-border px-2.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:inline-flex"
                  >
                    <PenSquare className="h-3 w-3" /> Change
                  </button>
                  <button
                    onClick={() => setRecipient(null)}
                    aria-label="Change recipient"
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:hidden"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                {isGroupRecipient && (
                  <p className="flex shrink-0 items-center gap-1.5 px-3 pt-2 text-[11px] text-muted-foreground">
                    <Users className="h-3 w-3 text-violet-500" />
                    Everyone in this group will receive your message.
                  </p>
                )}

                {/* Message */}
                <div className="flex min-h-0 flex-1 flex-col px-3 py-2.5">
                  <textarea
                    autoFocus
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSend() }}
                    placeholder="Write your message…"
                    aria-label="Message"
                    className="custom-scrollbar min-h-24 flex-1 resize-none rounded-lg border border-border bg-card px-3 py-2 text-[13px] leading-relaxed text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/25"
                  />
                </div>

                {/* Footer */}
                <div className="flex h-14 shrink-0 items-center justify-between gap-2 border-t border-border px-3">
                  <button
                    onClick={handleSaveDraft}
                    className="h-9 rounded-lg px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    Save draft
                  </button>
                  <button
                    onClick={handleSend}
                    disabled={!text.trim() || sending}
                    className="inline-flex h-9 items-center gap-1.5 rounded-full bg-primary px-4 text-xs font-semibold text-primary-foreground shadow-xs transition-all hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Send className="h-3.5 w-3.5" /> Send
                  </button>
                </div>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
