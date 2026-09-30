'use client'

/**
 * MessagingModule — Messages & Inbox.
 *
 * Progressive-disclosure layout:
 *
 *   Desktop (lg+)   Folders rail → Conversation list → Active conversation
 *   Tablet (md–lg)  Conversation list → Active conversation (folders in a drawer)
 *   Mobile (<md)    Conversation list → full-screen conversation (slide-in),
 *                   folders in a drawer, composer as a bottom sheet
 *
 * The Compose action stays primary: in the rail on desktop, in the list
 * header everywhere else. Everything else — group management, drafts,
 * contact details, per-conversation actions — appears only through
 * interaction.
 *
 * State mutations (all functional): send, star, archive/restore, mark
 * unread/urgent, drafts (auto-save/edit/send/discard), search (names +
 * message content), labels, groups (create/manage/delete).
 * No fake online/typing indicators, no dead Call/Video buttons.
 */

import { useState, useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import { PenSquare } from 'lucide-react'
import { PageTransition } from '@/components/shared/ui'
import { useIsMobile } from '@/hooks/use-mobile'
import { useMessagingStore } from '@/lib/store/messaging-store'
import { useIsDemoTenant } from '@/lib/store/demo-tenant'
import { useFocusStore } from '@/lib/store/focus-store'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { toast } from 'sonner'
import { FoldersNav } from './folders-nav'
import { ConversationList } from './conversation-list'
import { ThreadView } from './thread-view'
import { ComposeModal, type ComposePrefill } from './compose-modal'
import { GroupsPanel } from './groups-panel'
import { ManageMembersDialog } from './groups-panel'
import { DraftsList } from './drafts-list'
import { cn } from '@/lib/utils'

export function MessagingModule() {
  const activeConversationId = useMessagingStore((s) => s.activeConversationId)
  const activeFolder = useMessagingStore((s) => s.activeFolder)
  const conversations = useMessagingStore((s) => s.conversations)
  const openConversation = useMessagingStore((s) => s.openConversation)

  // FINAL-GATE (EG-9F/R4) — the demo tenant's sanctioned seed corpus is
  // applied ONCE here (module root); a real tenant keeps the honest empty
  // state. Guarded inside the applier: at-most-once, never over
  // non-pristine (server-hydrated / user-mutated) state.
  const isDemo = useIsDemoTenant()
  const ensureDemoSeed = useMessagingStore((s) => s.ensureDemoSeed)
  useEffect(() => { if (isDemo) ensureDemoSeed() }, [isDemo, ensureDemoSeed])

  const isMobile = useIsMobile()
  const [mobileView, setMobileView] = useState<'list' | 'thread'>('list')
  const [composeOpen, setComposeOpen] = useState(false)
  const [composePrefill, setComposePrefill] = useState<ComposePrefill | null>(null)
  const [foldersDrawerOpen, setFoldersDrawerOpen] = useState(false)
  const [manageGroupId, setManageGroupId] = useState<string | null>(null)

  // ── Parent deep-link from the global search (command palette) ──────
  // Matches the guardian by conversation name or by ward, else opens a
  // pre-addressed composer. Cleared after handling.
  const focus = useFocusStore((s) => s.focus)
  const handledParentTs = useRef<number | null>(null)
  useEffect(() => {
    if (!focus || focus.type !== 'parent' || handledParentTs.current === focus.ts) return
    handledParentTs.current = focus.ts
    const name = focus.title.toLowerCase().trim()
    if (!name) return
    const parents = conversations.filter((c) => c.type === 'parent')
    const match =
      parents.find((c) => c.name.toLowerCase().trim() === name) ??
      parents.find((c) => name.startsWith(c.name.toLowerCase().trim())) ??
      parents.find((c) => c.name.toLowerCase().includes(name) || name.includes(c.name.toLowerCase().trim()))
    let wardMatch = null as typeof parents[number] | null
    const ward = /guardian of\s+(.+?)(?:\s*[·•]|\s*\+91|$)/i.exec(focus.subtitle ?? '')?.[1]?.toLowerCase().trim()
    if (ward && !match) {
      wardMatch =
        parents.find((c) => c.studentName?.toLowerCase().trim() === ward) ??
        parents.find((c) => ward.includes(c.studentName?.toLowerCase().trim() ?? '\u0000')) ??
        parents.find((c) => c.studentName?.toLowerCase().includes(ward) || ward.includes(c.studentName?.toLowerCase().split(' ')[0] ?? '\u0000')) ??
        null
    }
    if (match || wardMatch) {
      const hit = match ?? wardMatch!
      openConversation(hit.id)
      toast.success(`Opened ${hit.name}'s conversation`, {
        description: 'Deep-linked from global search',
      })
    } else {
      setComposePrefill({ recipient: focus.title })
      setComposeOpen(true)
      toast.info(`New message to ${focus.title}`, {
        description: 'No existing conversation with this guardian yet.',
      })
    }
    useFocusStore.getState().clearFocus()
  }, [focus?.ts, focus?.type, focus?.title, focus?.subtitle, conversations, openConversation])

  // Switch to the thread view on mobile whenever a conversation opens
  useEffect(() => {
    if (activeConversationId) setMobileView('thread')
  }, [activeConversationId])

  const handleCompose = (prefill?: ComposePrefill) => {
    setComposePrefill(prefill ?? null)
    setComposeOpen(true)
  }

  /** Open a member's conversation, else a pre-addressed compose. */
  const handleContactMember = (name: string) => {
    const convo = useMessagingStore.getState().conversations.find(
      (c) => c.name === name && !c.archived,
    )
    if (convo) {
      openConversation(convo.id)
    } else {
      handleCompose({ recipient: name })
    }
  }

  const isGroupsFolder = activeFolder === 'groups'
  const isDraftsFolder = activeFolder === 'drafts'

  return (
    <PageTransition className="flex h-full flex-col">
      {/* 3-pane card — fills the viewport; panes scroll independently */}
      <div className="relative h-full min-h-0 overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <div className="grid h-full grid-rows-1 md:grid-cols-[20rem_1fr] xl:grid-cols-[14rem_20rem_1fr] 2xl:grid-cols-[15rem_22rem_1fr]">
          {/* Pane 1 — folders rail (desktop only) */}
          <aside className="hidden min-h-0 flex-col border-r border-border bg-muted/20 xl:flex">
            {/* Primary action — Compose */}
            <div className="shrink-0 p-3 pb-1">
              <button
                onClick={() => handleCompose()}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2 text-[13px] font-semibold text-primary-foreground shadow-xs transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                <PenSquare className="h-4 w-4" /> Compose
              </button>
            </div>
            <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto px-2 pb-3">
              <FoldersNav />
            </div>
          </aside>

          {/* Pane 2 — conversation list / groups / drafts */}
          <div
            className={cn(
              'flex min-h-0 min-w-0 flex-col bg-card md:border-r md:border-border',
              isMobile && mobileView === 'thread' && 'max-md:hidden',
            )}
          >
            {isGroupsFolder ? (
              <GroupsPanel onCompose={(name) => handleCompose({ recipient: name })} />
            ) : isDraftsFolder ? (
              <DraftsList
                onEditNewDraft={(draft) => handleCompose({ recipient: draft.recipientName, text: draft.text })}
                onOpenThread={() => setMobileView('thread')}
              />
            ) : (
              <ConversationList
                onCompose={() => handleCompose()}
                onOpenFolders={() => setFoldersDrawerOpen(true)}
              />
            )}
          </div>

          {/* Pane 3 — active conversation.
              Mobile: slides over the card as a full-screen view. */}
          <motion.div
            initial={false}
            animate={{ x: isMobile && mobileView !== 'thread' ? '100%' : 0 }}
            transition={{ duration: 0.28, ease: [0.32, 0.72, 0, 1] }}
            className={cn(
              'flex min-h-0 min-w-0 flex-col bg-card',
              'md:static md:translate-x-0',
              'max-md:absolute max-md:inset-0 max-md:z-20',
              isMobile && mobileView !== 'thread' && 'pointer-events-none',
            )}
          >
            <ThreadView
              onBack={() => setMobileView('list')}
              onManageGroup={(groupId) => setManageGroupId(groupId)}
              onContactMember={handleContactMember}
            />
          </motion.div>
        </div>
      </div>

      {/* Folders drawer — tablet & mobile */}
      <Sheet open={foldersDrawerOpen} onOpenChange={setFoldersDrawerOpen}>
        <SheetContent side="left" className="w-[16rem] gap-0 p-0 sm:max-w-none">
          <SheetHeader className="border-b border-border px-4 py-3.5">
            <SheetTitle className="text-sm">Messages</SheetTitle>
            <SheetDescription className="text-[11px]">Folders & labels</SheetDescription>
          </SheetHeader>
          <div className="p-2">
            <button
              onClick={() => { setFoldersDrawerOpen(false); handleCompose() }}
              className="mb-2 flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2.5 text-[13px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
            >
              <PenSquare className="h-4 w-4" /> Compose
            </button>
            <FoldersNav variant="drawer" onNavigate={() => setFoldersDrawerOpen(false)} />
          </div>
        </SheetContent>
      </Sheet>

      {/* Composer */}
      <ComposeModal
        open={composeOpen}
        onClose={() => { setComposeOpen(false); setComposePrefill(null) }}
        prefill={composePrefill}
      />

      {/* Group member management (shared by thread menu + contact sheet) */}
      <ManageMembersDialog
        groupId={manageGroupId}
        onOpenChange={(open) => { if (!open) setManageGroupId(null) }}
      />
    </PageTransition>
  )
}
