'use client'

import * as React from 'react'
import * as SelectPrimitive from '@radix-ui/react-select'
import { motion } from 'framer-motion'
import { ChevronDown, Check } from 'lucide-react'
import { cn } from '@/lib/utils'

const SPRING = { type: 'spring' as const, stiffness: 420, damping: 34, mass: 0.9 }

const Select      = SelectPrimitive.Root
const SelectGroup = SelectPrimitive.Group
const SelectValue = SelectPrimitive.Value

function SelectTrigger({
  className,
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>) {
  return (
    <SelectPrimitive.Trigger
      className={cn(
        'relative flex h-10 w-full items-center justify-between',
        'rounded-md border border-border bg-surface-raised px-3 pr-9',
        'text-[14px] font-sans text-ink',
        'shadow-[inset_0_1px_2px_rgba(22,20,15,0.04)]',
        'transition-[border-color,box-shadow] duration-150',
        'hover:border-border-strong',
        'focus:outline-none focus:border-ember focus:ring-2 focus:ring-ember/15 focus:shadow-none',
        'disabled:cursor-not-allowed disabled:opacity-40 disabled:bg-surface',
        '[&[data-placeholder]]:text-dim/60',
        className
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDown
          className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-dim pointer-events-none shrink-0 transition-transform duration-150
          [[data-state=open]_&]:rotate-180"
        />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  )
}

function SelectContent({
  className,
  children,
  position = 'popper',
  ...props
}: React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        position={position}
        className={cn(
          'relative z-[200] min-w-[8rem] overflow-hidden rounded-xl border border-border bg-surface-raised py-1.5',
          'shadow-[0_8px_32px_rgba(22,20,15,0.12),0_2px_8px_rgba(22,20,15,0.06)]',
          position === 'popper' && 'w-[var(--radix-select-trigger-width)] mt-1',
          className
        )}
        {...props}
      >
        <motion.div
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={SPRING}
        >
          <SelectPrimitive.Viewport className="p-1">
            {children}
          </SelectPrimitive.Viewport>
        </motion.div>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  )
}

function SelectItem({
  className,
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      className={cn(
        'relative flex w-full cursor-pointer select-none items-center rounded-md py-2 pl-8 pr-2.5',
        'text-[13px] font-sans text-ink outline-none',
        'transition-colors duration-100',
        'focus:bg-surface data-[state=checked]:text-ember',
        'data-[disabled]:pointer-events-none data-[disabled]:opacity-40',
        className
      )}
      {...props}
    >
      <span className="absolute left-2 flex h-4 w-4 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <Check className="h-3.5 w-3.5" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  )
}

function SelectLabel({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof SelectPrimitive.Label>) {
  return (
    <SelectPrimitive.Label
      className={cn(
        'px-2.5 py-1.5 text-[11px] font-semibold text-dim uppercase tracking-wider font-sans',
        className
      )}
      {...props}
    />
  )
}

function SelectSeparator({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof SelectPrimitive.Separator>) {
  return (
    <SelectPrimitive.Separator
      className={cn('h-px bg-border mx-1 my-1', className)}
      {...props}
    />
  )
}

export {
  Select,
  SelectGroup,
  SelectValue,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectLabel,
  SelectSeparator,
}
