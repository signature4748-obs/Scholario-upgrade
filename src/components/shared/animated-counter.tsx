'use client'

import { useEffect, useRef, useState } from 'react'
import { useInView, useMotionValue, useSpring } from 'framer-motion'

interface AnimatedCounterProps {
  value: number
  duration?: number
  decimals?: number
  prefix?: string
  suffix?: string
  className?: string
  format?: (n: number) => string
  /** When true (default), re-animates whenever `value` changes (Brief §17). */
  animateOnChange?: boolean
}

export function AnimatedCounter({
  value,
  duration = 1.4,
  decimals = 0,
  prefix = '',
  suffix = '',
  className,
  format,
  animateOnChange = true,
}: AnimatedCounterProps) {
  const ref = useRef<HTMLSpanElement>(null)
  const inView = useInView(ref, { once: true, margin: '-40px' })
  const [display, setDisplay] = useState(0)
  const motionValue = useMotionValue(0)
  const spring = useSpring(motionValue, { duration: duration * 1000, bounce: 0 })

  // Animate on first mount (when in view) AND on subsequent value changes
  // (Brief §17: data-driven animation — KPI numbers re-count when data changes).
  useEffect(() => {
    if (inView) motionValue.set(value)
  }, [inView, value, motionValue])

  useEffect(() => {
    return spring.on('change', (v) => {
      setDisplay(v)
    })
  }, [spring])

  // When animateOnChange is true and value updates, re-trigger the spring.
  useEffect(() => {
    if (animateOnChange && inView) {
      motionValue.set(value)
    }
  }, [value, animateOnChange, inView, motionValue])

  const formatted = format
    ? format(display)
    : `${prefix}${new Intl.NumberFormat('en-IN', { maximumFractionDigits: decimals, minimumFractionDigits: decimals }).format(display)}${suffix}`

  return (
    <span ref={ref} className={className}>
      {formatted}
    </span>
  )
}

interface TypewriterTextProps {
  text: string
  className?: string
  delay?: number
}

export function TypewriterText({ text, className, delay = 0 }: TypewriterTextProps) {
  const [shown, setShown] = useState('')
  useEffect(() => {
    const timer = setTimeout(() => {
      let i = 0
      const interval = setInterval(() => {
        if (i <= text.length) {
          setShown(text.slice(0, i))
          i++
        } else {
          clearInterval(interval)
        }
      }, 35)
      return () => clearInterval(interval)
    }, delay)
    return () => clearTimeout(timer)
  }, [text, delay])
  return <span className={className}>{shown}</span>
}
