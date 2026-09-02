'use client'

import * as React from 'react'
import { motion } from 'framer-motion'
import { SPRING_CURVE } from '@/lib/motion'
import { cn } from '@/lib/utils'

/* PageHeader — single source of truth for page-title rows.
 *
 *   <PageHeader
 *     eyebrow="OVERVIEW"                (optional)
 *     title="Good morning, there"       (required)
 *     subtitle="Here's how..."           (optional)
 *     actions={<Button>Run</Button>}    (optional right-aligned slot)
 *   />
 *
 * Enforces one heading size, one subtitle size, one row layout for every page.
 */

type Props = {
  eyebrow?: string
  title: string | React.ReactNode
  subtitle?: string | React.ReactNode
  actions?: React.ReactNode
  className?: string
}

export function PageHeader({ eyebrow, title, subtitle, actions, className }: Props) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: SPRING_CURVE }}
      className={cn(
        'flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4',
        className
      )}
    >
      <div className="min-w-0 flex-1">
        {eyebrow && (
          <p className="text-[11px] font-semibold text-dim uppercase tracking-[0.12em] mb-2">
            {eyebrow}
          </p>
        )}
        <h1 className="font-display text-[32px] font-semibold text-ink leading-[1.15] tracking-tight">
          {title}
        </h1>
        {subtitle && (
          <p className="text-[14px] text-dim mt-2 leading-relaxed max-w-[560px]">
            {subtitle}
          </p>
        )}
      </div>
      {actions && (
        <div className="flex items-center gap-3 flex-shrink-0">{actions}</div>
      )}
    </motion.div>
  )
}

/* PageSection — consistent section container. Optional title + description above content. */
type SectionProps = {
  title?: string
  description?: string
  action?: React.ReactNode
  children: React.ReactNode
  className?: string
}

export function PageSection({
  title,
  description,
  action,
  children,
  className,
}: SectionProps) {
  return (
    <section className={cn('space-y-4', className)}>
      {(title || action) && (
        <div className="flex items-end justify-between gap-4">
          <div className="min-w-0">
            {title && (
              <h2 className="font-display text-[20px] font-semibold text-ink leading-tight tracking-tight">
                {title}
              </h2>
            )}
            {description && (
              <p className="text-[13px] text-dim mt-1 leading-relaxed">
                {description}
              </p>
            )}
          </div>
          {action && <div className="flex-shrink-0">{action}</div>}
        </div>
      )}
      {children}
    </section>
  )
}
