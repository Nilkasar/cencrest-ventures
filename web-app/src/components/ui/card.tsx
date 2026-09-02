'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'

/* Card — white surface on cream background.
   `interactive` adds pointer cursor + hover lift.
   `dark` flips to ink background for hero callouts.       */

type CardProps = React.HTMLAttributes<HTMLDivElement> & {
  interactive?: boolean
  /** @deprecated use interactive */
  hover?: boolean
  dark?: boolean
}

export function Card({
  className,
  interactive = false,
  hover,
  dark = false,
  children,
  ...props
}: CardProps) {
  const isInteractive = interactive || hover
  return (
    <div
      className={cn(
        /* Base */
        'rounded-xl border',
        /* Dark variant */
        dark
          ? 'bg-ink text-paper border-[rgba(247,243,236,0.07)]'
          : 'bg-surface-raised text-ink border-border',
        /* Elevation — light shadow by default */
        dark
          ? 'shadow-[0_2px_8px_rgba(0,0,0,0.25)]'
          : 'shadow-[0_1px_3px_rgba(22,20,15,0.06),0_1px_2px_rgba(22,20,15,0.03)]',
        /* Interactive lift */
        isInteractive && !dark &&
          'cursor-pointer transition-all duration-200 ease-out ' +
          'hover:shadow-[0_6px_24px_rgba(22,20,15,0.10),0_2px_6px_rgba(22,20,15,0.05)] ' +
          'hover:border-border-strong hover:-translate-y-px',
        isInteractive && dark &&
          'cursor-pointer transition-colors duration-200 hover:bg-[rgba(255,255,255,0.04)]',
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
}

export function CardHeader({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('flex flex-col gap-1 p-6 pb-0', className)} {...props}>
      {children}
    </div>
  )
}

export function CardTitle({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cn(
        'font-display text-[17px] font-semibold text-ink leading-snug tracking-tight',
        className
      )}
      {...props}
    >
      {children}
    </h3>
  )
}

export function CardDescription({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p className={cn('text-[13px] text-dim leading-relaxed', className)} {...props}>
      {children}
    </p>
  )
}

export function CardContent({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('p-6', className)} {...props}>
      {children}
    </div>
  )
}

export function CardFooter({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'flex items-center gap-3 px-6 py-4 border-t border-border/60',
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
}
