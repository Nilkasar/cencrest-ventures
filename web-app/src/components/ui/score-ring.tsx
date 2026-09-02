'use client'

import * as React from 'react'
import { useEffect } from 'react'
import { motion, useMotionValue, useTransform, animate } from 'framer-motion'
import { cn } from '@/lib/utils'

interface ScoreRingProps {
  score: number
  size?: number
  strokeWidth?: number
  label?: string
  className?: string
}

function scoreColor(score: number): string {
  if (score >= 75) return 'var(--color-success)'
  if (score >= 50) return 'var(--color-warning)'
  return 'var(--color-danger)'
}

function resolveStrokeWidth(size: number, explicit?: number): number {
  if (explicit !== undefined) return explicit
  if (size >= 120) return 8
  if (size >= 80)  return 7
  return 6
}

export function ScoreRing({
  score,
  size = 80,
  strokeWidth,
  label,
  className,
}: ScoreRingProps) {
  const sw = resolveStrokeWidth(size, strokeWidth)
  const radius = (size - sw) / 2
  const circumference = 2 * Math.PI * radius

  const motionVal = useMotionValue(0)
  const dashOffset = useTransform(
    motionVal,
    [0, 100],
    [circumference, circumference * (1 - score / 100)]
  )
  const displayScore = useTransform(motionVal, (v) => Math.round(v).toString())

  useEffect(() => {
    const controls = animate(motionVal, score, { duration: 1.1, ease: 'easeOut' })
    return controls.stop
  }, [score, motionVal])

  const fontSize =
    size >= 120 ? 'text-3xl' :
    size >= 80  ? 'text-xl'  :
    'text-lg'

  return (
    <div className={cn('flex flex-col items-center gap-2', className)}>
      <div className="relative inline-flex items-center justify-center">
        <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
          {/* Track */}
          <circle
            cx={size / 2} cy={size / 2} r={radius}
            fill="none"
            stroke="var(--color-border)"
            strokeWidth={sw}
            strokeOpacity={0.8}
          />
          {/* Arc */}
          <motion.circle
            cx={size / 2} cy={size / 2} r={radius}
            fill="none"
            stroke={scoreColor(score)}
            strokeWidth={sw}
            strokeLinecap="round"
            strokeDasharray={circumference}
            style={{ strokeDashoffset: dashOffset }}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <motion.span
            className={cn('font-display font-bold text-ink leading-none tabular-nums', fontSize)}
          >
            {displayScore}
          </motion.span>
        </div>
      </div>
      {label && (
        <span className="text-[11px] font-medium font-sans text-dim text-center uppercase tracking-wider">
          {label}
        </span>
      )}
    </div>
  )
}
