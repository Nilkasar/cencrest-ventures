'use client'

import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  [
    'inline-flex items-center justify-center gap-2',
    'font-sans font-semibold tracking-[-0.01em]',
    'transition-all duration-150 ease-out',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember/40 focus-visible:ring-offset-2 focus-visible:ring-offset-paper',
    'disabled:pointer-events-none disabled:opacity-40',
    'cursor-pointer select-none',
    'whitespace-nowrap',
  ].join(' '),
  {
    variants: {
      variant: {
        /* Primary: ember fill, warm shadow */
        primary:
          'bg-ember text-paper shadow-[0_1px_2px_rgba(194,65,12,0.25),0_1px_1px_rgba(0,0,0,0.06)] ' +
          'hover:bg-ember-light hover:shadow-[0_2px_8px_rgba(194,65,12,0.32)] ' +
          'active:bg-ember-dark active:shadow-none',
        /* Secondary: white card, ink text */
        secondary:
          'bg-surface-raised text-ink border border-border shadow-[0_1px_2px_rgba(22,20,15,0.05)] ' +
          'hover:border-border-strong hover:shadow-[0_2px_8px_rgba(22,20,15,0.08)] ' +
          'active:bg-surface',
        /* Ghost: transparent, minimal */
        ghost:
          'bg-transparent text-dim hover:text-ink hover:bg-surface active:bg-border/60',
        /* Outline: bordered, no fill */
        outline:
          'bg-transparent text-ink border border-border ' +
          'hover:bg-surface hover:border-border-strong ' +
          'shadow-[0_1px_2px_rgba(22,20,15,0.04)]',
        /* Danger: red fill */
        danger:
          'bg-danger text-paper shadow-sm ' +
          'hover:bg-[#b91c1c] active:bg-[#991b1b]',
        /* Success: green fill */
        success:
          'bg-success text-paper shadow-sm ' +
          'hover:bg-[#15803d] active:bg-[#166534]',
      },
      size: {
        sm:   'h-7 px-2.5 text-[12px] rounded-md',
        md:   'h-9 px-4 text-[13px] rounded-md',
        lg:   'h-11 px-6 text-[14px] rounded-lg',
        icon: 'h-9 w-9 rounded-md p-0',
      },
    },
    defaultVariants: {
      variant: 'primary',
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

function InlineSpinner({ sizeName }: { sizeName: 'sm' | 'md' | 'lg' | 'icon' | null | undefined }) {
  const dim = sizeName === 'sm' ? 13 : sizeName === 'lg' ? 18 : 15
  return (
    <svg
      width={dim}
      height={dim}
      viewBox="0 0 24 24"
      fill="none"
      className="animate-[spin_0.7s_linear_infinite]"
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
      <Slot className={cn(buttonVariants({ variant, size, className }))} {...props}>
        {children}
      </Slot>
    )
  }

  return (
    <MotionButton
      whileTap={{ scale: 0.975 }}
      transition={{ type: 'tween', duration: 0.12, ease: [0.16, 1, 0.3, 1] }}
      className={cn(buttonVariants({ variant, size, className }))}
      disabled={disabled || loading}
      aria-busy={loading}
      {...(props as React.ComponentPropsWithoutRef<typeof MotionButton>)}
    >
      {loading && <InlineSpinner sizeName={size} />}
      {children}
    </MotionButton>
  )
}
