'use client'

/**
 * comm-compose — unified composer for announcements.
 *
 * - Template picker (small practical set)
 * - Audience selector (school-wide + DB-backed class roster) with live recipient count
 * - Title + message (with character count for SMS)
 * - Category picker
 * - Channel selector (Push / SMS / Email checkboxes)
 * - Live preview (updates based on selected channels)
 * - Schedule option (now or future)
 * - Confirmation modal before send
 * - REAL platform broadcast: "Send Now" additionally POSTs to
 *   /api/announcements — the row lands in the school DB and the live event
 *   stream pushes it to every connected dashboard within seconds.
 *
 * No separate SMS/Email/Push tabs — channels live inside composer.
 */

import { useState, useMemo, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Smartphone, MessageSquare, Mail, Send, FileText, Check,
  AlertCircle, ChevronDown, Loader2, RadioTower, Globe,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  useCommunicationStore,
  getAudienceOptions,
  TEMPLATES,
  type AnnouncementCategory,
  type Channel,
  type Audience,
} from '@/lib/store/communication-store'
import { school } from '@/lib/mock/school'
import { cn } from '@/lib/utils'
import { CategoryBadge } from './comm-shared'
import { toast } from 'sonner'
import { useDismissOnEscape } from '@/hooks/use-dismiss-on-escape'

const CATEGORIES: AnnouncementCategory[] = ['Academic', 'Event', 'Holiday', 'General', 'Emergency', 'Parents', 'Transport', 'Examination']

const CATEGORY_ACCENTS: Record<AnnouncementCategory, string> = {
  Academic: 'bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-500/30',
  Event: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
  Holiday: 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30',
  General: 'bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/30',
  Emergency: 'bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/30',
  Parents: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
  Transport: 'bg-cyan-500/10 text-cyan-700 dark:text-cyan-300 border-cyan-500/30',
  Examination: 'bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-500/30',
}

interface DbClass { id: string; name: string; section: string | null; students: number }

type BroadcastState = 'idle' | 'sending' | 'sent' | 'failed'

export function ComposeSection() {
  const createAnnouncement = useCommunicationStore((s) => s.createAnnouncement)
  const sendAnnouncement = useCommunicationStore((s) => s.sendAnnouncement)
  const scheduleAnnouncement = useCommunicationStore((s) => s.scheduleAnnouncement)
  const markSynced = useCommunicationStore((s) => s.markSynced)

  const audienceOptions = useMemo(() => getAudienceOptions(), [])

  // Real class roster from the school DB — used for class-targeted audiences
  // so feed filtering (`CLASS:<name>`) matches actual enrollment.
  const [dbClasses, setDbClasses] = useState<DbClass[]>([])
  const [classesLoaded, setClassesLoaded] = useState(false)
  const [broadcastState, setBroadcastState] = useState<BroadcastState>('idle')

  useEffect(() => {
    let cancelled = false
    fetch('/api/classes?counts=1', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (cancelled) return
        const rows = j && typeof j === 'object' && 'data' in j ? (j as { data?: unknown }).data : j
        if (Array.isArray(rows)) {
          setDbClasses(
            rows.map((c: { id: string; name: string; section?: string | null; _count?: { students?: number } }) => ({
              id: c.id,
              name: c.name,
              section: c.section ?? null,
              students: c._count?.students ?? 0,
            }))
          )
        }
        setClassesLoaded(true)
      })
      .catch(() => { if (!cancelled) setClassesLoaded(true) })
    return () => { cancelled = true }
  }, [])

  const [title, setTitle] = useState('')
  const [message, setMessage] = useState('')
  const [category, setCategory] = useState<AnnouncementCategory>('General')
  const [audience, setAudience] = useState<Audience>('All Parents')
  const [channels, setChannels] = useState<Channel[]>(['Push'])
  const [scheduleMode, setScheduleMode] = useState<'now' | 'later'>('now')
  const [scheduledFor, setScheduledFor] = useState('')
  const [showConfirm, setShowConfirm] = useState(false)
  const [showTemplates, setShowTemplates] = useState(false)

  // Audience selector expanded state
  const [audienceExpanded, setAudienceExpanded] = useState<'global' | 'classes'>('global')

  // Compute recipient count — DB counts for real classes, canonical estimates
  // for school-wide audiences.
  const recipientCount = useMemo(() => {
    if (audience === 'All Parents') return audienceOptions.global[0].count
    if (audience === 'All Students') return audienceOptions.global[1].count
    if (audience === 'All Teachers') return audienceOptions.global[2].count
    if (audience === 'All Staff') return audienceOptions.global[3].count
    const dbClass = dbClasses.find((c) => c.name === audience)
    if (dbClass) return dbClass.students
    const cls = audienceOptions.classes.find((c) => c.value === audience)
    if (cls) return cls.count
    const sec = audienceOptions.sections.find((s) => s.value === audience)
    if (sec) return sec.count
    return 0
  }, [audience, audienceOptions, dbClasses])

  const smsSegments = useMemo(() => {
    if (!channels.includes('SMS')) return 0
    const totalChars = (title.length + message.length + 20) // school name sig
    return Math.max(1, Math.ceil(totalChars / 160))
  }, [channels, title, message])

  const isEmergency = category === 'Emergency'

  const toggleChannel = (c: Channel) => {
    setChannels((prev) => prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c])
  }

  const applyTemplate = (template: typeof TEMPLATES[0]) => {
    setTitle(template.name)
    setMessage(template.body)
    setCategory(template.category)
    setShowTemplates(false)
    toast.success('Template applied', { description: template.name })
  }

  const handleSend = async () => {
    if (!title.trim()) { toast.error('Title required', { description: 'Please enter a title.' }); return }
    if (!message.trim()) { toast.error('Message required', { description: 'Please enter a message.' }); return }
    if (channels.length === 0) { toast.error('Select at least one channel', { description: 'Push, SMS or Email.' }); return }
    if (scheduleMode === 'later' && !scheduledFor) { toast.error('Schedule date required', { description: 'Pick a date and time.' }); return }

    const localId = createAnnouncement({
      title,
      message,
      category,
      audience,
      channels,
      author: 'Principal',
      recipientCount,
    })

    if (scheduleMode === 'now') {
      sendAnnouncement(localId)
      setBroadcastState('sending')

      // REAL platform broadcast — persist to the school DB; the live event
      // stream picks the row up (~4s) and pushes a toast to every dashboard.
      let delivered = false
      let deliveryNote = ''
      try {
        const r = await fetch('/api/announcements', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: title.trim(), message: message.trim(), audience, category }),
        })
        const j = await r.json().catch(() => null)
        const payload = j && typeof j === 'object' && 'data' in j ? (j as { data?: { id?: string; estimatedRecipients?: number | null } }).data : j as { id?: string } | null
        if (r.ok && payload?.id) {
          markSynced(localId, payload.id)
          delivered = true
        } else {
          deliveryNote = (j as { error?: string })?.error === 'FORBIDDEN'
            ? 'Platform broadcasts require the Principal role.'
            : 'Platform broadcast service unavailable — announcement kept in this session.'
        }
      } catch {
        deliveryNote = 'Platform broadcast unreachable — announcement kept in this session.'
      }

      if (delivered) {
        setBroadcastState('sent')
        toast.success('Announcement broadcast live', {
          description: `${recipientCount.toLocaleString('en-IN')} recipients via ${channels.join(' + ')} · pushed to every connected dashboard in real time`,
          icon: <RadioTower className="h-4 w-4 text-emerald-500" />,
        })
      } else {
        setBroadcastState('failed')
        toast.warning('Announcement sent (demo mode)', { description: deliveryNote || 'Delivery not confirmed.' })
      }
      setTimeout(() => setBroadcastState('idle'), 3200)
    } else {
      scheduleAnnouncement(localId, new Date(scheduledFor).toISOString())
      toast.success('Announcement scheduled', {
        description: `${formatScheduledDate(scheduledFor)} · ${recipientCount.toLocaleString('en-IN')} recipients`,
      })
    }

    // Reset form
    setTitle('')
    setMessage('')
    setChannels(['Push'])
    setScheduleMode('now')
    setScheduledFor('')
    setShowConfirm(false)
  }

  const openConfirm = () => {
    if (!title.trim()) { toast.error('Title required'); return }
    if (!message.trim()) { toast.error('Message required'); return }
    if (channels.length === 0) { toast.error('Select a channel'); return }
    if (scheduleMode === 'later' && !scheduledFor) { toast.error('Schedule date required'); return }
    setShowConfirm(true)
  }

  return (
    <div className="max-w-7xl mx-auto">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* Composer (left) */}
        <div className="space-y-3">
          {/* Template picker */}
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs gap-1.5"
              onClick={() => setShowTemplates(!showTemplates)}
            >
              <FileText className="h-3.5 w-3.5" /> Templates
              <ChevronDown className={cn('h-3 w-3 transition-transform', showTemplates && 'rotate-180')} />
            </Button>
            <span className="text-[10px] text-muted-foreground">Start from a pre-filled template</span>
          </div>
          <AnimatePresence>
            {showTemplates && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                <div className="grid grid-cols-2 gap-1.5">
                  {TEMPLATES.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => applyTemplate(t)}
                      className="text-left rounded-md border border-border bg-card px-2.5 py-2 hover:border-primary/40 transition-colors"
                    >
                      <p className="text-[11px] font-semibold">{t.name}</p>
                      <p className="text-[9px] text-muted-foreground line-clamp-1">{t.body}</p>
                    </button>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Title */}
          <div>
            <label className="text-[10px] text-muted-foreground uppercase font-semibold tracking-wider mb-1 block">Title</label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Annual Sports Day — 15 December"
              className="h-9 text-sm"
            />
          </div>

          {/* Message */}
          <div>
            <label className="text-[10px] text-muted-foreground uppercase font-semibold tracking-wider mb-1 block">
              Message
              {channels.includes('SMS') && (
                <span className="ml-2 text-muted-foreground/70 normal-case">
                  {(title.length + message.length + 20)} chars · {smsSegments} SMS segment{smsSegments > 1 ? 's' : ''}
                </span>
              )}
            </label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Write your announcement message…"
              rows={5}
              className="w-full text-xs rounded-md border border-border bg-card px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>

          {/* Category */}
          <div>
            <label className="text-[10px] text-muted-foreground uppercase font-semibold tracking-wider mb-1 block">Category</label>
            <div className="flex items-center gap-1.5 flex-wrap">
              {CATEGORIES.map((c) => (
                <button
                  key={c}
                  onClick={() => setCategory(c)}
                  className={cn(
                    'inline-flex items-center px-2 py-1 rounded-md text-[10px] font-medium border transition-all',
                    category === c ? CATEGORY_ACCENTS[c] : 'border-border bg-card text-muted-foreground hover:text-foreground',
                  )}
                >
                  {c === 'Emergency' && <AlertCircle className="h-2.5 w-2.5 mr-1" />}
                  {c}
                </button>
              ))}
            </div>
          </div>

          {/* Audience */}
          <div>
            <label className="text-[10px] text-muted-foreground uppercase font-semibold tracking-wider mb-1 block">
              Audience · <span className="text-emerald-600 normal-case">{recipientCount.toLocaleString('en-IN')} recipients</span>
            </label>
            <div className="flex items-center gap-1 mb-1.5">
              <button
                onClick={() => setAudienceExpanded('global')}
                className={cn(
                  'px-2 py-1 text-[10px] font-medium rounded transition-colors',
                  audienceExpanded === 'global' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground',
                )}
              >
                School-wide
              </button>
              <button
                onClick={() => setAudienceExpanded('classes')}
                className={cn(
                  'px-2 py-1 text-[10px] font-medium rounded transition-colors',
                  audienceExpanded === 'classes' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground',
                )}
              >
                Classes
                {classesLoaded && dbClasses.length > 0 && (
                  <span className={cn('ml-1 px-1 rounded text-[8px]', audienceExpanded === 'classes' ? 'bg-primary-foreground/20' : 'bg-emerald-500/15 text-emerald-600')}>DB</span>
                )}
              </button>
            </div>
            <select
              value={audience}
              onChange={(e) => setAudience(e.target.value as Audience)}
              className="w-full h-8 text-xs rounded-md border border-border bg-background px-2"
            >
              {audienceExpanded === 'global' && (
                <>
                  <optgroup label="School-wide audiences">
                    {audienceOptions.global.map((a) => (
                      <option key={a.value} value={a.value}>{a.label} ({a.count.toLocaleString('en-IN')})</option>
                    ))}
                  </optgroup>
                  {audienceOptions.classes.length > 0 && (
                    <optgroup label="Demo roster classes (local only)">
                      {audienceOptions.classes.slice(0, 4).map((c) => (
                        <option key={c.value} value={c.value}>{c.label}</option>
                      ))}
                    </optgroup>
                  )}
                </>
              )}
              {audienceExpanded === 'classes' && (
                <optgroup label={classesLoaded && dbClasses.length > 0 ? 'Classes — school database' : 'Classes (loading…)'}>
                  {dbClasses.map((c) => (
                    <option key={c.id} value={c.name}>
                      {c.name} · {c.students} enrolled
                    </option>
                  ))}
                  {classesLoaded && dbClasses.length === 0 && audienceOptions.classes.map((c) => (
                    <option key={c.value} value={c.value}>{c.label} ({c.count.toLocaleString('en-IN')} students)</option>
                  ))}
                </optgroup>
              )}
            </select>
            {/* Public reach hint — whole-school broadcasts also appear on the
                public website's live notice board (see /api/schools/public). */}
            {(audience === 'Whole School' || audience === 'All Students') && (
              <p className="mt-1.5 flex items-start gap-1.5 rounded-md border border-emerald-500/25 bg-emerald-500/[0.06] px-2 py-1.5 text-[10px] leading-snug text-emerald-700 dark:text-emerald-300">
                <Globe className="mt-px h-3 w-3 shrink-0" aria-hidden />
                Whole-school notices are also published to the school website&apos;s public notice board.
              </p>
            )}
          </div>

          {/* Channels */}
          <div>
            <label className="text-[10px] text-muted-foreground uppercase font-semibold tracking-wider mb-1 block">Send via</label>
            <div className="grid grid-cols-3 gap-1.5">
              {([
                { id: 'Push', label: 'Push', desc: 'App notification', icon: <Smartphone className="h-4 w-4" /> },
                { id: 'SMS', label: 'SMS', desc: 'Text message', icon: <MessageSquare className="h-4 w-4" /> },
                { id: 'Email', label: 'Email', desc: 'Email message', icon: <Mail className="h-4 w-4" /> },
              ] as const).map((c) => (
                <button
                  key={c.id}
                  onClick={() => toggleChannel(c.id)}
                  className={cn(
                    'relative flex flex-col items-center gap-1 rounded-lg border p-2.5 transition-all',
                    channels.includes(c.id) ? 'border-primary bg-primary/5 ring-1 ring-primary/20' : 'border-border hover:border-primary/40',
                  )}
                >
                  {channels.includes(c.id) && (
                    <span className="absolute top-1.5 right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-primary-foreground">
                      <Check className="h-2.5 w-2.5" />
                    </span>
                  )}
                  <span className={cn('flex h-8 w-8 items-center justify-center rounded-md',
                    channels.includes(c.id) ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground')}>
                    {c.icon}
                  </span>
                  <p className="text-[11px] font-medium">{c.label}</p>
                  <p className="text-[9px] text-muted-foreground">{c.desc}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Schedule */}
          <div>
            <label className="text-[10px] text-muted-foreground uppercase font-semibold tracking-wider mb-1 block">Schedule</label>
            <div className="flex items-center gap-1 mb-1.5">
              <button
                onClick={() => setScheduleMode('now')}
                className={cn('px-2.5 py-1 text-[11px] font-medium rounded transition-colors',
                  scheduleMode === 'now' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground')}
              >
                Send Now
              </button>
              <button
                onClick={() => setScheduleMode('later')}
                className={cn('px-2.5 py-1 text-[11px] font-medium rounded transition-colors',
                  scheduleMode === 'later' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground')}
              >
                Schedule for Later
              </button>
            </div>
            {scheduleMode === 'later' && (
              <Input
                type="datetime-local"
                value={scheduledFor}
                onChange={(e) => setScheduledFor(e.target.value)}
                className="h-8 text-xs"
              />
            )}
          </div>

          {/* Send button */}
          <Button
            size="lg"
            disabled={broadcastState === 'sending'}
            className={cn(
              'w-full h-10 text-sm gap-2 transition-all',
              isEmergency
                ? 'bg-gradient-to-r from-rose-600 to-pink-600 hover:from-rose-700 hover:to-pink-700 text-white'
                : 'bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white',
              broadcastState === 'sent' && 'from-emerald-500 to-teal-500',
              broadcastState === 'sending' && 'opacity-80 cursor-wait',
            )}
            onClick={openConfirm}
          >
            {broadcastState === 'sending' ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Broadcasting…
              </>
            ) : broadcastState === 'sent' ? (
              <>
                <RadioTower className="h-4 w-4" /> Broadcast delivered
              </>
            ) : (
              <>
                <Send className="h-4 w-4" />
                {scheduleMode === 'now' ? (isEmergency ? 'Send Emergency Alert' : 'Send Announcement') : 'Schedule Announcement'}
              </>
            )}
          </Button>

          {/* Broadcast status strip */}
          <AnimatePresence>
            {(broadcastState === 'sent' || broadcastState === 'failed') && (
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                className={cn(
                  'flex items-center gap-2 rounded-lg border px-3 py-2 text-[11px]',
                  broadcastState === 'sent'
                    ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300'
                    : 'border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-300',
                )}
              >
                {broadcastState === 'sent' ? (
                  <>
                    <span className="relative flex h-2 w-2 shrink-0">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60" />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                    </span>
                    Live broadcast confirmed — platform delivery succeeded. Connected dashboards received the push.
                  </>
                ) : (
                  <>
                    <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                    Kept in demo session — platform broadcast was not confirmed.
                  </>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Live Preview (right) */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold">Live Preview</p>
            <CategoryBadge category={category} />
          </div>

          {channels.includes('Push') && (
            <PushPreview title={title || 'Your title here'} message={message || 'Your message will appear here.'} audience={audience} />
          )}
          {channels.includes('SMS') && (
            <SmsPreview title={title} message={message || 'Your message will appear here.'} segments={smsSegments} audience={audience} recipientCount={recipientCount} />
          )}
          {channels.includes('Email') && (
            <EmailPreview title={title || 'Your subject here'} message={message || 'Your message will appear here.'} audience={audience} />
          )}
          {channels.length === 0 && (
            <div className="rounded-xl border-2 border-dashed border-border bg-muted/20 p-8 text-center">
              <Mail className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
              <p className="text-xs text-muted-foreground">Select a channel to see preview</p>
            </div>
          )}
        </div>
      </div>

      {/* Confirmation modal */}
      <AnimatePresence>
        {showConfirm && (
          <ConfirmModal
            title={title}
            audience={audience}
            recipientCount={recipientCount}
            channels={channels}
            scheduleMode={scheduleMode}
            scheduledFor={scheduledFor}
            isEmergency={isEmergency}
            onCancel={() => setShowConfirm(false)}
            onConfirm={handleSend}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

// ─── Push Preview ────────────────────────────────────────────────────

function PushPreview({ title, message, audience }: { title: string; message: string; audience: string }) {
  return (
    <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="rounded-xl border border-border bg-gradient-to-br from-sky-50 to-white dark:from-sky-950/20 dark:to-card p-3">
      <div className="flex items-start gap-2">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 text-white text-xs font-bold">
          {school.logo}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold">{school.shortName}</p>
            <span className="text-[9px] text-muted-foreground">now</span>
          </div>
          <p className="text-xs font-semibold mt-0.5 line-clamp-1">{title}</p>
          <p className="text-[11px] text-muted-foreground line-clamp-2 mt-0.5">{message}</p>
        </div>
      </div>
      <p className="text-[9px] text-muted-foreground mt-2 pt-2 border-t border-border/40 flex items-center gap-1">
        <Smartphone className="h-2.5 w-2.5" /> Push notification preview · {audience}
      </p>
    </motion.div>
  )
}

// ─── SMS Preview ─────────────────────────────────────────────────────

function SmsPreview({ title, message, segments, audience: _audience, recipientCount }: { title: string; message: string; segments: number; audience: string; recipientCount: number }) {
  const smsText = `${title ? title + ': ' : ''}${message} — ${school.name}`
  return (
    <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="rounded-xl border border-border bg-gradient-to-br from-emerald-50 to-white dark:from-emerald-950/20 dark:to-card p-3">
      <div className="flex items-start gap-2">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500 text-white">
          <MessageSquare className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold">SMS Preview</p>
            <span className="text-[9px] text-muted-foreground">{smsText.length} chars</span>
          </div>
          <div className="mt-1.5 rounded-lg bg-white dark:bg-card border border-border p-2.5">
            <p className="text-[11px] text-foreground whitespace-pre-wrap">{smsText}</p>
          </div>
          <div className="flex items-center justify-between mt-1.5 text-[9px] text-muted-foreground">
            <span>{segments} SMS segment{segments > 1 ? 's' : ''}</span>
            <span>{recipientCount.toLocaleString('en-IN')} recipients</span>
          </div>
        </div>
      </div>
    </motion.div>
  )
}

// ─── Email Preview ──────────────────────────────────────────────────

function EmailPreview({ title, message, audience }: { title: string; message: string; audience: string }) {
  return (
    <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="rounded-xl border border-border bg-gradient-to-br from-amber-50 to-white dark:from-amber-950/20 dark:to-card p-3">
      <div className="flex items-start gap-2">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-500 text-white">
          <Mail className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold">Email Preview</p>
            <span className="text-[9px] text-muted-foreground">{audience}</span>
          </div>
          <div className="mt-1.5 rounded-lg bg-white dark:bg-card border border-border overflow-hidden">
            <div className="px-2.5 py-1.5 border-b border-border/60 bg-muted/20">
              <p className="text-[10px] text-muted-foreground">From: {school.email}</p>
              <p className="text-[11px] font-semibold mt-0.5">{title}</p>
            </div>
            <div className="p-2.5">
              <p className="text-[11px] text-foreground whitespace-pre-wrap line-clamp-6">{message}</p>
              <p className="text-[10px] text-muted-foreground mt-2 pt-2 border-t border-border/40">— {school.principal}<br />{school.name}</p>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  )
}

// ─── Confirm Modal ───────────────────────────────────────────────────

function ConfirmModal({ title, audience, recipientCount, channels, scheduleMode, scheduledFor, isEmergency, onCancel, onConfirm }: {
  title: string
  audience: string
  recipientCount: number
  channels: Channel[]
  scheduleMode: 'now' | 'later'
  scheduledFor: string
  isEmergency: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  // Escape cancels the confirm modal (backdrop click already does).
  useDismissOnEscape(onCancel)
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      role="dialog"
      aria-modal="true"
      aria-label={isEmergency ? 'Confirm emergency alert' : 'Confirm announcement'}
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onCancel}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="bg-card border border-border rounded-xl shadow-2xl max-w-sm w-full p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-sm font-bold mb-1">
          {isEmergency ? 'Confirm Emergency Alert' : 'Confirm Announcement'}
        </h3>
        <p className="text-[11px] text-muted-foreground mb-3 line-clamp-1">{title}</p>

        <div className="space-y-1.5 rounded-lg bg-muted/30 p-2.5 text-[11px]">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Audience</span>
            <span className="font-medium">{audience}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Recipients</span>
            <span className="font-bold tabular-nums">{recipientCount.toLocaleString('en-IN')}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Channels</span>
            <span className="font-medium">{channels.join(' + ')}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Schedule</span>
            <span className="font-medium">{scheduleMode === 'now' ? 'Send now' : formatScheduledDate(scheduledFor)}</span>
          </div>
        </div>

        {scheduleMode === 'now' && (
          <div className="mt-2 rounded-md bg-emerald-500/10 border border-emerald-500/30 p-2 flex items-start gap-1.5">
            <RadioTower className="h-3.5 w-3.5 text-emerald-600 shrink-0 mt-0.5" />
            <div>
              <p className="text-[10px] font-semibold text-emerald-700 dark:text-emerald-300">Live platform broadcast</p>
              <p className="text-[10px] text-emerald-600/80 dark:text-emerald-400/80">The notice is persisted to the school database and pushed in real time to every connected dashboard.</p>
            </div>
          </div>
        )}

        {isEmergency && (
          <div className="mt-2 rounded-md bg-rose-500/10 border border-rose-500/30 p-2 flex items-start gap-1.5">
            <AlertCircle className="h-3.5 w-3.5 text-rose-600 shrink-0 mt-0.5" />
            <p className="text-[10px] text-rose-700 dark:text-rose-300">Emergency alerts send immediately to all selected channels.</p>
          </div>
        )}

        <div className="flex items-center justify-end gap-1 mt-3 pt-3 border-t border-border">
          <Button variant="outline" size="sm" className="h-8 text-xs" onClick={onCancel}>Cancel</Button>
          <Button
            size="sm"
            className={cn(
              'h-8 text-xs gap-1.5',
              isEmergency ? 'bg-rose-600 hover:bg-rose-700 text-white' : 'bg-emerald-600 hover:bg-emerald-700 text-white',
            )}
            onClick={onConfirm}
          >
            <Send className="h-3.5 w-3.5" /> {scheduleMode === 'now' ? 'Send' : 'Schedule'}
          </Button>
        </div>
      </motion.div>
    </motion.div>
  )
}

function formatScheduledDate(dateStr: string): string {
  if (!dateStr) return 'Not set'
  const d = new Date(dateStr)
  return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}
