'use client'

import * as React from 'react'
import { useEffect } from 'react'
import { motion, useMotionValue, useTransform, animate } from 'framer-motion'
import { cn } from '@/lib/utils'
import { tokens } from '@/design-system/tokens'

interface ScoreRingProps {
  score: number
  size?: number
  strokeWidth?: number
  label?: string
  className?: string
}

function scoreStrokeColor(score: number): string {
  if (score >= 75) return tokens.colors.success
  if (score >= 50) return tokens.colors.warning
  return tokens.colors.danger
}

export function ScoreRing({
  score,
  size = 80,
  strokeWidth = 6,
  label,
  className,
}: ScoreRingProps) {
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const motionVal = useMotionValue(0)
  const dashOffset = useTransform(
    motionVal,
    [0, 100],
    [circumference, circumference * (1 - score / 100)]
  )
  const displayScore = useTransform(motionVal, (v) => Math.round(v).toString())

  useEffect(() => {
    const controls = animate(motionVal, score, {
      duration: tokens.animation.duration.crawl / 1000,
      ease: 'easeOut',
    })
    return controls.stop
  }, [score, motionVal])

  const stroke = scoreStrokeColor(score)
  const fontSize = size < 60 ? 'text-sm' : size < 100 ? 'text-lg' : 'text-2xl'

  return (
    <div className={cn('flex flex-col items-center gap-2', className)}>
      <div className="relative inline-flex items-center justify-center">
        <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={tokens.colors.border}
            strokeWidth={strokeWidth}
          />
          <motion.circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={stroke}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={circumference}
            style={{ strokeDashoffset: dashOffset }}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <motion.span
            className={cn('font-display font-semibold text-ink leading-none', fontSize)}
          >
            {displayScore}
          </motion.span>
        </div>
      </div>
      {label && (
        <span className="text-xs font-sans text-dim text-center leading-tight">{label}</span>
      )}
    </div>
  )
}
