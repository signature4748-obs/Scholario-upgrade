'use client'

import React, { useState, useMemo } from 'react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import {
  formatAadhaarDisplay,
  formatMobileDisplay,
  formatBankAccountDisplay,
  formatIFSCDisplay,
  cleanDigits,
  cleanAlphanumeric,
} from '@/lib/format'

/* ---------- AADHAAR INPUT COMPONENT ---------- */
export interface AadhaarInputProps {
  value: string
  onChange: (val: string) => void
  placeholder?: string
  disabled?: boolean
  className?: string
}

export function AadhaarInput({
  value,
  onChange,
  placeholder = '1234 5678 9012',
  disabled = false,
  className,
}: AadhaarInputProps) {
  const digitsOnly = useMemo(() => cleanDigits(value).slice(0, 12), [value])
  const displayValue = useMemo(() => formatAadhaarDisplay(digitsOnly), [digitsOnly])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = cleanDigits(e.target.value).slice(0, 12)
    onChange(raw) // Returns raw 12 digits to parent/form state
  }

  return (
    <Input
      type="text"
      inputMode="numeric"
      maxLength={14} // 12 digits + 2 spaces
      value={displayValue}
      onChange={handleChange}
      placeholder={placeholder}
      disabled={disabled}
      className={cn(
        'font-mono transition-colors text-sm font-normal text-foreground border-border',
        className
      )}
    />
  )
}

/* ---------- PHONE INPUT COMPONENT ---------- */
export interface PhoneInputProps {
  value: string
  onChange: (val: string) => void
  placeholder?: string
  disabled?: boolean
  className?: string
}

export function PhoneInput({
  value,
  onChange,
  placeholder = '98765 43210',
  disabled = false,
  className,
}: PhoneInputProps) {
  const rawDigits = useMemo(() => cleanDigits(value).slice(0, 10), [value])
  const displayValue = useMemo(() => formatMobileDisplay(rawDigits), [rawDigits])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = cleanDigits(e.target.value).slice(0, 10)
    onChange(raw) // Returns raw 10 digits to parent/form state
  }

  return (
    <Input
      type="text"
      inputMode="tel"
      maxLength={11} // 10 digits + 1 space
      value={displayValue}
      onChange={handleChange}
      placeholder={placeholder}
      disabled={disabled}
      className={cn(
        'font-mono transition-colors text-sm font-normal text-foreground border-border',
        className
      )}
    />
  )
}

/* ---------- BANK ACCOUNT INPUT COMPONENT ---------- */
export interface BankAccountInputProps {
  value: string
  onChange: (val: string) => void
  placeholder?: string
  disabled?: boolean
  className?: string
}

export function BankAccountInput({
  value,
  onChange,
  placeholder = '1234 5678 9012 3456',
  disabled = false,
  className,
}: BankAccountInputProps) {
  const rawDigits = useMemo(() => cleanDigits(value).slice(0, 18), [value])
  const displayValue = useMemo(() => formatBankAccountDisplay(rawDigits), [rawDigits])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = cleanDigits(e.target.value).slice(0, 18)
    onChange(raw)
  }

  return (
    <Input
      type="text"
      inputMode="numeric"
      value={displayValue}
      onChange={handleChange}
      placeholder={placeholder}
      disabled={disabled}
      className={cn('font-mono transition-colors text-sm', className)}
    />
  )
}

/* ---------- IFSC CODE INPUT COMPONENT ---------- */
export interface IFSCInputProps {
  value: string
  onChange: (val: string) => void
  placeholder?: string
  disabled?: boolean
  className?: string
}

export function IFSCInput({
  value,
  onChange,
  placeholder = 'SBIN 0001234',
  disabled = false,
  className,
}: IFSCInputProps) {
  const cleanStr = useMemo(() => cleanAlphanumeric(value).slice(0, 11), [value])
  const displayValue = useMemo(() => formatIFSCDisplay(cleanStr), [cleanStr])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = cleanAlphanumeric(e.target.value).slice(0, 11)
    onChange(raw)
  }

  return (
    <Input
      type="text"
      value={displayValue}
      onChange={handleChange}
      placeholder={placeholder}
      disabled={disabled}
      className={cn('font-mono uppercase transition-colors text-sm', className)}
    />
  )
}

/* ---------- EMAIL / GMAIL AUTO-RECOMMEND INPUT COMPONENT ---------- */
export interface EmailInputProps {
  value: string
  onChange: (val: string) => void
  placeholder?: string
  disabled?: boolean
  className?: string
}

export function EmailInput({
  value,
  onChange,
  placeholder = 'example@gmail.com',
  disabled = false,
  className,
}: EmailInputProps) {
  const [showRecs, setShowRecs] = useState(false)

  const atIndex = (value || '').indexOf('@')
  const username = atIndex >= 0 ? value.slice(0, atIndex) : value
  const domainPart = atIndex >= 0 ? value.slice(atIndex + 1) : ''

  const recommendations = useMemo(() => {
    if (atIndex < 0 || !username.trim()) return []
    const domains = ['gmail.com', 'scholario.edu', 'outlook.com', 'yahoo.com']
    if (!domainPart) return domains
    return domains.filter((d) => d.startsWith(domainPart.toLowerCase()) && d !== domainPart.toLowerCase())
  }, [atIndex, username, domainPart])

  const handleSelectDomain = (domain: string) => {
    onChange(`${username}@${domain}`)
    setShowRecs(false)
  }

  return (
    <div className="relative w-full">
      <Input
        type="email"
        value={value || ''}
        onChange={(e) => {
          onChange(e.target.value)
          setShowRecs(true)
        }}
        onFocus={() => setShowRecs(true)}
        placeholder={placeholder}
        disabled={disabled}
        className={cn('transition-colors', className)}
      />
      {showRecs && recommendations.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-1 z-50 rounded-lg border border-border bg-popover shadow-lg py-1">
          {recommendations.map((domain) => (
            <button
              key={domain}
              type="button"
              onClick={() => handleSelectDomain(domain)}
              className="w-full text-left px-3 py-1.5 text-xs text-foreground hover:bg-accent transition-colors flex items-center justify-between"
            >
              <span>{username}@{domain}</span>
              <span className="text-[10px] text-muted-foreground">Suggestion</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
