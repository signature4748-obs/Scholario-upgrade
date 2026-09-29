'use client'

/**
 * Shared design primitives for Principal Panel modules.
 *
 * These components establish the consistent design language for every
 * module: minimal whitespace-driven layout, no card-in-card nesting,
 * subtle dividers instead of heavy borders, single-page titles,
 * settings rows that don't repeat themselves.
 *
 * Usage:
 *   <PageHeader title="Admissions" subtitle="3 applications · 2 pending" />
 *   <SettingsCard>
 *     <SettingsCardSection title="Privacy" icon={Lock} defaultOpen>
 *       <ToggleRow label="Sensitive Data Protection" />
 *     </SettingsCardSection>
 *   </SettingsCard>
 *   <ActionBar dirty onSave onDiscard />
 */

import { useState, type ReactNode, type ComponentType } from 'react'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  Collapsible, CollapsibleTrigger, CollapsibleContent,
} from '@/components/ui/collapsible'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'

/* PageHeader — single title per page, optional subtitle, optional actions */
export function PageHeader({
  title, subtitle, actions, onBack, className,
}: {
  title: string
  subtitle?: string
  actions?: ReactNode
  onBack?: () => void
  className?: string
}) {
  return (
    <div className={cn('flex items-center justify-between gap-4 mb-6', className)}>
      <div className="flex items-center gap-3 min-w-0">
        {onBack && (
          <Button variant="ghost" size="sm" onClick={onBack}
            className="h-8 px-2 text-muted-foreground hover:text-foreground shrink-0">
            <span aria-hidden>←</span>
            <span className="sr-only">Back</span>
          </Button>
        )}
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-foreground leading-tight truncate">{title}</h1>
          {subtitle && (
            <p className="text-xs text-muted-foreground mt-0.5 leading-tight truncate">{subtitle}</p>
          )}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  )
}

/* SegmentedTabs — Apple/Linear style pill control */
export function SegmentedTabs<T extends string>({
  value, onValueChange, tabs, className,
}: {
  value: T
  onValueChange: (v: T) => void
  tabs: Array<{ value: T; label: string }>
  className?: string
}) {
  return (
    <div className={cn('inline-flex h-9 p-1 gap-1 rounded-full bg-muted/60', className)}>
      {tabs.map((t) => (
        <button key={t.value} type="button" onClick={() => onValueChange(t.value)}
          className={cn(
            'text-xs rounded-full px-4 transition-all',
            value === t.value
              ? 'bg-white shadow-sm text-foreground'
              : 'text-muted-foreground hover:text-foreground'
          )}>
          {t.label}
        </button>
      ))}
    </div>
  )
}

/* SettingsCard — single rounded container with divided sections */
export function SettingsCard({
  children, className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn('rounded-xl border border-border/60 bg-card px-6 divide-y divide-border/40', className)}>
      {children}
    </div>
  )
}

/* SettingsCardSection — collapsible row with icon + title + chevron */
export function SettingsCardSection({
  title, icon: Icon, defaultOpen = false, description, tag, children,
}: {
  title: string
  icon?: ComponentType<{ className?: string }>
  defaultOpen?: boolean
  /** One short contextual line under the group title (max ~60 chars). */
  description?: string
  /** Short scope label, e.g. "FORM" or "OFFICIAL DOCUMENT" */
  tag?: string
  children: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button type="button" className="w-full flex items-center gap-3 py-4 text-left">
          {Icon && <Icon className="h-4 w-4 text-muted-foreground shrink-0" />}
          <div className="flex-1 min-w-0">
            <p className="text-base font-medium text-foreground">{title}</p>
            {description && (
              <p className="text-xs text-muted-foreground mt-0.5 truncate">{description}</p>
            )}
          </div>
          {tag && (
            <span className="text-[9px] font-bold uppercase tracking-[0.08em] text-muted-foreground/80 border border-border/60 rounded px-1.5 py-0.5 shrink-0">
              {tag}
            </span>
          )}
          <ChevronRight
            className={cn(
              'h-4 w-4 text-muted-foreground transition-transform shrink-0',
              open && 'rotate-90'
            )}
          />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="pb-4 pl-7 pr-1">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  )
}

/* ToggleRow — name + Switch on right, optional helper text */
export function ToggleRow({
  label, helper, checked, onCheckedChange, disabled,
}: {
  label: string
  helper?: string
  checked: boolean
  onCheckedChange: (v: boolean) => void
  disabled?: boolean
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-3 border-t border-border/40 first:border-t-0">
      <div className="min-w-0 flex-1">
        <p className="text-sm text-foreground">{label}</p>
        {helper && <p className="text-[11px] text-muted-foreground mt-0.5">{helper}</p>}
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} className="shrink-0" />
    </div>
  )
}

/* ValueRow — name + custom control on right (inputs, selects, etc.) */
export function ValueRow({
  label, helper, children,
}: {
  label: string
  helper?: string
  children: ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-3 border-t border-border/40 first:border-t-0">
      <div className="min-w-0 flex-1">
        <p className="text-sm text-foreground">{label}</p>
        {helper && <p className="text-[11px] text-muted-foreground mt-0.5">{helper}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

/* RadioRowGroup — name + inline radio options (e.g. Required / Optional) */
export function RadioRowGroup({
  label, helper, name: _name, options, value, onValueChange,
}: {
  label: string
  helper?: string
  name: string
  options: Array<{ value: string; label: string; hint?: string }>
  value: string
  onValueChange: (v: string) => void
}) {
  return (
    <div className="py-3 border-t border-border/40 first:border-t-0">
      <p className="text-sm text-foreground">{label}</p>
      {helper && <p className="text-[11px] text-muted-foreground mt-0.5">{helper}</p>}
      <div
        role="radiogroup"
        aria-label={label}
        className="mt-2 flex flex-wrap gap-2"
      >
        {options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={value === opt.value}
            title={opt.hint}
            onClick={() => onValueChange(opt.value)}
            className={
              'rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-colors ' +
              (value === opt.value
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border text-muted-foreground hover:bg-muted/60 hover:text-foreground')
            }
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  )
}

/* ActionBar — sticky bottom bar with Discard/Save. Hidden until dirty=true */
export function ActionBar({
  discardLabel = 'Discard Changes',
  saveLabel = 'Save Changes',
  dirty = false,
  saving = false,
  onDiscard,
  onSave,
}: {
  discardLabel?: string
  saveLabel?: string
  dirty?: boolean
  saving?: boolean
  onDiscard: () => void
  onSave: () => void
}) {
  if (!dirty) return null
  return (
    <div className="sticky bottom-0 left-0 right-0 z-30 mt-6 -mx-6 px-6 py-3 bg-background/95 backdrop-blur border-t border-border/60 flex items-center justify-end gap-2 animate-in slide-in-from-bottom-2 duration-200">
      <Button variant="ghost" onClick={onDiscard} disabled={saving} className="h-8 text-xs">
        {discardLabel}
      </Button>
      <Button onClick={onSave} disabled={saving}
        className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700 text-white">
        {saving ? 'Saving…' : saveLabel}
      </Button>
    </div>
  )
}

/* EmptyState — consistent empty state across modules */
export function EmptyState({
  icon: Icon, title, description, action,
}: {
  icon?: ComponentType<{ className?: string }>
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      {Icon && (
        <div className="mb-3 h-10 w-10 rounded-full bg-muted flex items-center justify-center">
          <Icon className="h-5 w-5 text-muted-foreground" />
        </div>
      )}
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description && (
        <p className="text-xs text-muted-foreground mt-1 max-w-sm">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
