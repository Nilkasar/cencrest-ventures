'use client'

import * as React from 'react'
import { useEffect } from 'react'
import { motion, useMotionValue, useTransform, animate } from 'framer-motion'
import { TrendingUp, TrendingDown, Minus } from 'lucide-react'
import { cn } from '@/lib/utils'

interface StatCardProps {
  label: string
  value: number
  prefix?: string
  suffix?: string
  decimals?: number
  /** Pass as percentage integer, e.g. 12 for +12% */
  delta?: number
  deltaLabel?: string
  icon?: React.ReactNode
  className?: string
}

function AnimatedNumber({
  value,
  prefix = '',
  suffix = '',
  decimals = 0,
}: {
  value: number
  prefix?: string
  suffix?: string
  decimals?: number
}) {
  const motionVal = useMotionValue(0)
  const display = useTransform(
    motionVal,
    (v) => `${prefix}${v.toFixed(decimals)}${suffix}`
  )

  useEffect(() => {
    const controls = animate(motionVal, value, { duration: 1.0, ease: 'easeOut' })
    return controls.stop
  }, [value, motionVal])

  return <motion.span>{display}</motion.span>
}

export function StatCard({
  label,
  value,
  prefix,
  suffix,
  decimals = 0,
  delta,
  deltaLabel,
  icon,
  className,
}: StatCardProps) {
  const isPositive = delta !== undefined && delta > 0
  const isNegative = delta !== undefined && delta < 0
  const isZero     = delta !== undefined && delta === 0

  return (
    <div
      className={cn(
        'bg-surface-raised rounded-xl border border-border p-6 relative',
        'shadow-[0_1px_3px_rgba(22,20,15,0.06),0_1px_2px_rgba(22,20,15,0.03)]',
        className
      )}
    >
      {icon && (
        <span className="absolute top-5 right-5 text-dim" aria-hidden="true">
          {icon}
        </span>
      )}
      <p className="text-[11px] font-semibold font-sans text-dim uppercase tracking-wider mb-2">
        {label}
      </p>
      <div className="font-display text-3xl font-bold text-ink tracking-tight leading-none">
        <AnimatedNumber value={value} prefix={prefix} suffix={suffix} decimals={decimals} />
      </div>
      {delta !== undefined && (
        <div className="mt-2.5">
          <span
            className={cn(
              'text-[11px] font-semibold inline-flex items-center gap-1 px-2 py-0.5 rounded-full',
              isPositive && 'text-success bg-success/10',
              isNegative && 'text-danger bg-danger/10',
              isZero     && 'text-dim bg-surface',
            )}
          >
            {isPositive && <TrendingUp className="h-3 w-3" aria-hidden="true" />}
            {isNegative && <TrendingDown className="h-3 w-3" aria-hidden="true" />}
            {isZero     && <Minus className="h-3 w-3" aria-hidden="true" />}
            {isPositive && '+'}
            {delta.toFixed(1)}%
            {deltaLabel && <span className="font-normal opacity-70">{deltaLabel}</span>}
          </span>
        </div>
      )}
    </div>
  )
}
