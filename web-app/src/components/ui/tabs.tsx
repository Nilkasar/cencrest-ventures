'use client'

import * as React from 'react'
import * as TabsPrimitive from '@radix-ui/react-tabs'
import { motion, AnimatePresence } from 'framer-motion'
import { cn } from '@/lib/utils'
import { spring } from '@/design-system/motion'

export const Tabs = TabsPrimitive.Root

interface TabsListProps extends React.ComponentPropsWithoutRef<typeof TabsPrimitive.List> {
  activeValue?: string
}

export function TabsList({
  className,
  children,
  activeValue: _activeValue,
  ...props
}: TabsListProps) {
  return (
    <TabsPrimitive.List
      className={cn(
        'relative inline-flex items-end gap-0 border-b border-border w-full',
        className
      )}
      {...props}
    >
      {children}
    </TabsPrimitive.List>
  )
}

export function TabsTrigger({
  className,
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        'group relative px-4 py-2.5 text-sm font-sans font-medium text-dim',
        'transition-colors duration-[150ms]',
        '-mb-px',
        'hover:text-ink',
        'data-[state=active]:text-ink',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember focus-visible:ring-inset',
        className
      )}
      {...props}
    >
      {children}
      {/* Active indicator using CSS approach */}
      <span
        className={cn(
          'absolute bottom-0 left-0 right-0 h-0.5 rounded-full',
          'bg-ink scale-x-0 group-data-[state=active]:scale-x-100',
          'transition-transform duration-[250ms] ease-spring origin-center',
        )}
        aria-hidden="true"
      />
    </TabsPrimitive.Trigger>
  )
}

export function TabsContent({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      className={cn('pt-6 focus-visible:outline-none', className)}
      {...props}
    />
  )
}
