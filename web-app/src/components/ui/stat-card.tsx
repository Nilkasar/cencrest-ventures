'use client'

import * as React from 'react'
import { useEffect } from 'react'
import { motion, useMotionValue, useTransform, animate } from 'framer-motion'
import { TrendingUp, TrendingDown, Minus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { tokens } from '@/design-system/tokens'

interface StatCardProps {
  label: string
  value: number
  prefix?: string
  suffix?: string
  decimals?: number
  delta?: number
  deltaLabel?: string
  className?: string
}

function AnimatedNumber({
  value,
  decimals = 0,
  prefix = '',
  suffix = '',
}: {
  value: number
  decimals?: number
  prefix?: string
  suffix?: string
}) {
  const motionVal = useMotionValue(0)
  const display = useTransform(
    motionVal,
    (v) => `${prefix}${v.toFixed(decimals)}${suffix}`
  )

  useEffect(() => {
    const controls = animate(motionVal, value, {
      duration: tokens.animation.duration.crawl / 1000,
      ease: 'easeOut',
    })
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
  className,
}: StatCardProps) {
  const isPositive = delta !== undefined && delta > 0
  const isNegative = delta !== undefined && delta < 0
  const isNeutral = delta === undefined || delta === 0

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        type: 'tween',
        ease: tokens.animation.easing.spring,
        duration: tokens.animation.duration.normal / 1000,
      }}
      className={cn(
        'bg-surface border border-border rounded-lg shadow-sm p-6',
        'border-l-2 border-l-ember',
        className
      )}
    >
      <p className="text-sm font-sans text-dim mb-2">{label}</p>
      <div className="font-display text-4xl font-semibold text-ink leading-none mb-3">
        <AnimatedNumber
          value={value}
          prefix={prefix}
          suffix={suffix}
          decimals={decimals}
        />
      </div>
      {delta !== undefined && (
        <div
          className={cn(
            'inline-flex items-center gap-1 text-sm font-sans font-medium',
            isPositive && 'text-success',
            isNegative && 'text-danger',
            isNeutral && 'text-dim',
          )}
        >
          {isPositive && <TrendingUp className="h-4 w-4" aria-hidden="true" />}
          {isNegative && <TrendingDown className="h-4 w-4" aria-hidden="true" />}
          {isNeutral && delta === 0 && <Minus className="h-4 w-4" aria-hidden="true" />}
          <span>
            {isPositive && '+'}
            {delta.toFixed(1)}%
            {deltaLabel && <span className="text-dim font-normal ml-1">{deltaLabel}</span>}
          </span>
        </div>
      )}
    </motion.div>
  )
}
