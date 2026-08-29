'use client'

import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'
import { tokens } from '@/design-system/tokens'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 font-sans font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 cursor-pointer select-none',
  {
    variants: {
      variant: {
        default: 'bg-ember text-paper hover:bg-ember-light active:bg-ember-dark',
        outline: 'border border-border bg-transparent text-ink hover:bg-surface hover:border-border-strong',
        ghost: 'text-ink hover:bg-surface',
        danger: 'bg-danger text-white hover:bg-red-700 active:bg-red-800',
        success: 'bg-success text-white hover:bg-green-700 active:bg-green-800',
      },
      size: {
        sm: 'h-8 px-3 text-sm rounded-md',
        md: 'h-10 px-4 text-sm rounded-md',
        lg: 'h-12 px-6 text-base rounded-lg',
        icon: 'h-10 w-10 rounded-md',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'md',
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
  loading?: boolean
}

function Spinner({ size }: { size: 'sm' | 'md' | 'lg' | 'icon' | null | undefined }) {
  const dim = size === 'sm' ? 14 : size === 'lg' ? 18 : 16
  return (
    <svg
      width={dim}
      height={dim}
      viewBox="0 0 24 24"
      fill="none"
      className="animate-spin"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path
        d="M12 2a10 10 0 0 1 10 10"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  )
}

const MotionButton = motion.create('button')

export function Button({
  className,
  variant,
  size,
  asChild = false,
  loading = false,
  disabled,
  children,
  ...props
}: ButtonProps) {
  if (asChild) {
    return (
      <Slot
        className={cn(buttonVariants({ variant, size, className }))}
        {...props}
      >
        {children}
      </Slot>
    )
  }

  return (
    <MotionButton
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      transition={{
        type: 'tween',
        ease: tokens.animation.easing.spring,
        duration: tokens.animation.duration.fast / 1000,
      }}
      className={cn(buttonVariants({ variant, size, className }))}
      disabled={disabled || loading}
      {...(props as React.ComponentPropsWithoutRef<typeof MotionButton>)}
    >
      {loading && <Spinner size={size} />}
      {children}
    </MotionButton>
  )
}
