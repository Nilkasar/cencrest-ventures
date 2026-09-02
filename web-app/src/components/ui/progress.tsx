'use client'

import * as React from 'react'
import * as ProgressPrimitive from '@radix-ui/react-progress'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const trackVariants = cva(
  'relative w-full overflow-hidden rounded-full bg-surface',
  {
    variants: {
      size: {
        sm: 'h-1',
        md: 'h-1.5',
        lg: 'h-2.5',
      },
    },
    defaultVariants: { size: 'md' },
  }
)

const barVariants = cva(
  'h-full rounded-full transition-[width] duration-500 ease-out',
  {
    variants: {
      variant: {
        default: 'bg-ember',
        success: 'bg-success',
        warning: 'bg-warning',
        danger:  'bg-danger',
        info:    'bg-info',
      },
    },
    defaultVariants: { variant: 'default' },
  }
)

interface ProgressProps
  extends React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root>,
    VariantProps<typeof barVariants>,
    VariantProps<typeof trackVariants> {
  value?: number
}

export function Progress({ className, variant, size, value = 0, ...props }: ProgressProps) {
  const clamped = Math.min(100, Math.max(0, value))
  return (
    <ProgressPrimitive.Root
      className={cn(trackVariants({ size }), className)}
      value={clamped}
      {...props}
    >
      <ProgressPrimitive.Indicator
        className={cn(barVariants({ variant }))}
        style={{ transform: `translateX(-${100 - clamped}%)` }}
      />
    </ProgressPrimitive.Root>
  )
}
