import * as React from 'react'
import { cn } from '@/lib/utils'

interface EmptyStateProps {
  icon?: React.ReactNode
  title: string
  description?: string
  action?: React.ReactNode
  className?: string
  compact?: boolean
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
  compact = false,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center',
        compact ? 'py-8 px-4' : 'py-16 px-6',
        className
      )}
    >
      {icon && (
        <div
          className={cn(
            'flex items-center justify-center rounded-xl border border-border bg-surface text-dim mb-4',
            compact ? 'w-10 h-10' : 'w-12 h-12'
          )}
        >
          {icon}
        </div>
      )}
      <p
        className={cn(
          'font-display font-semibold text-ink tracking-tight',
          compact ? 'text-[14px]' : 'text-[16px]'
        )}
      >
        {title}
      </p>
      {description && (
        <p
          className={cn(
            'text-dim leading-relaxed mt-1.5 max-w-[280px]',
            compact ? 'text-[12px]' : 'text-[13px]'
          )}
        >
          {description}
        </p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}
