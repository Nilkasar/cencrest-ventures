'use client'

import * as React from 'react'
import * as ProgressPrimitive from '@radix-ui/react-progress'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const indicatorVariants = cva(
  'h-full rounded-full transition-all duration-[900ms] ease-spring',
  {
    variants: {
      variant: {
        default: 'bg-ember',
        success: 'bg-success',
        warning: 'bg-warning',
        danger: 'bg-danger',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
)

interface ProgressProps
  extends React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root>,
    VariantProps<typeof indicatorVariants> {
  value?: number
}

export function Progress({ className, variant, value = 0, ...props }: ProgressProps) {
  return (
    <ProgressPrimitive.Root
      className={cn(
        'relative h-2 w-full overflow-hidden rounded-full bg-surface border border-border',
        className
      )}
      value={value}
      {...props}
    >
      <ProgressPrimitive.Indicator
        className={cn(indicatorVariants({ variant }))}
        style={{ transform: `translateX(-${100 - Math.min(100, Math.max(0, value))}%)` }}
      />
    </ProgressPrimitive.Root>
  )
}
