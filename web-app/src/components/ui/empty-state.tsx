import * as React from 'react'
import { cn } from '@/lib/utils'

interface EmptyStateProps {
  icon?: React.ReactNode
  title: string
  description?: string
  action?: React.ReactNode
  className?: string
}

export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center py-16 text-center', className)}>
      {icon && (
        <div className="w-14 h-14 rounded-full bg-surface border border-border flex items-center justify-center mb-4 text-dim">
          {icon}
        </div>
      )}
      <h3 className="font-display text-base font-semibold text-ink mb-1">{title}</h3>
      {description && (
        <p className="text-sm text-dim max-w-xs font-sans leading-relaxed">{description}</p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}
