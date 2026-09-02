import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center gap-1 font-sans font-semibold rounded-full uppercase tracking-wide leading-none',
  {
    variants: {
      variant: {
        default:  'bg-surface text-dim border border-border',
        ember:    'bg-ember/10 text-ember border border-ember/20',
        success:  'bg-success-muted text-success border border-success/20',
        warning:  'bg-warning-muted text-warning border border-warning/20',
        danger:   'bg-danger-muted text-danger border border-danger/20',
        info:     'bg-info-muted text-info border border-info/20',
        outline:  'border border-border-strong text-ink bg-transparent',
      },
      size: {
        sm: 'text-[10px] px-1.5 py-0.5',
        md: 'text-[11px] px-2 py-0.5',
        lg: 'text-[12px] px-2.5 py-1',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'md',
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {
  dot?: boolean
}

const dotColor: Record<string, string> = {
  default: 'bg-dim',
  ember:   'bg-ember',
  success: 'bg-success',
  warning: 'bg-warning',
  danger:  'bg-danger',
  info:    'bg-info',
  outline: 'bg-dim',
}

export function Badge({
  className,
  variant,
  size,
  dot = false,
  children,
  ...props
}: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant, size, className }))} {...props}>
      {dot && (
        <span
          className={cn(
            'inline-block w-1.5 h-1.5 rounded-full flex-shrink-0',
            dotColor[variant ?? 'default'] ?? 'bg-dim'
          )}
          aria-hidden="true"
        />
      )}
      {children}
    </span>
  )
}
