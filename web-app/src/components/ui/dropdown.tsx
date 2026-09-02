'use client'

import * as React from 'react'
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu'
import { motion } from 'framer-motion'
import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'

const SPRING = { type: 'spring' as const, stiffness: 420, damping: 34, mass: 0.9 }

const Dropdown          = DropdownMenuPrimitive.Root
const DropdownTrigger   = DropdownMenuPrimitive.Trigger
const DropdownGroup     = DropdownMenuPrimitive.Group
const DropdownPortal    = DropdownMenuPrimitive.Portal
const DropdownSub       = DropdownMenuPrimitive.Sub
const DropdownSubTrigger = DropdownMenuPrimitive.SubTrigger
const DropdownRadioGroup = DropdownMenuPrimitive.RadioGroup

function DropdownContent({
  className,
  sideOffset = 6,
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        sideOffset={sideOffset}
        className={cn(
          'z-[200] min-w-[180px] overflow-hidden rounded-xl border border-border bg-surface-raised py-1.5',
          'shadow-[0_8px_32px_rgba(22,20,15,0.12),0_2px_8px_rgba(22,20,15,0.06)]',
          className
        )}
        {...props}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.97, y: -4 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.97, y: -4 }}
          transition={SPRING}
        >
          {children}
        </motion.div>
      </DropdownMenuPrimitive.Content>
    </DropdownMenuPrimitive.Portal>
  )
}

function DropdownItem({
  className,
  inset,
  ...props
}: React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item> & { inset?: boolean }) {
  return (
    <DropdownMenuPrimitive.Item
      className={cn(
        'relative flex cursor-pointer select-none items-center gap-2 mx-1.5 rounded-md px-2.5 py-2',
        'text-[13px] font-sans text-ink outline-none',
        'transition-colors duration-100 focus:bg-surface',
        'data-[disabled]:pointer-events-none data-[disabled]:opacity-40',
        'data-[destructive]:text-danger data-[destructive]:focus:bg-danger/5',
        inset && 'pl-8',
        className
      )}
      {...props}
    />
  )
}

function DropdownCheckboxItem({
  className,
  children,
  checked,
  ...props
}: React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.CheckboxItem>) {
  return (
    <DropdownMenuPrimitive.CheckboxItem
      className={cn(
        'relative flex cursor-pointer select-none items-center gap-2 mx-1.5 rounded-md pl-8 pr-2.5 py-2',
        'text-[13px] font-sans text-ink outline-none',
        'transition-colors duration-100 focus:bg-surface',
        'data-[disabled]:pointer-events-none data-[disabled]:opacity-40',
        className
      )}
      checked={checked}
      {...props}
    >
      <span className="absolute left-2 flex h-4 w-4 items-center justify-center">
        <DropdownMenuPrimitive.ItemIndicator>
          <Check className="h-3.5 w-3.5" />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.CheckboxItem>
  )
}

function DropdownSeparator({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Separator>) {
  return (
    <DropdownMenuPrimitive.Separator
      className={cn('h-px bg-border mx-1.5 my-1', className)}
      {...props}
    />
  )
}

function DropdownLabel({
  className,
  inset,
  ...props
}: React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Label> & { inset?: boolean }) {
  return (
    <DropdownMenuPrimitive.Label
      className={cn(
        'px-3.5 py-1.5 text-[11px] font-semibold text-dim uppercase tracking-wider font-sans',
        inset && 'pl-8',
        className
      )}
      {...props}
    />
  )
}

export {
  Dropdown,
  DropdownTrigger,
  DropdownContent,
  DropdownItem,
  DropdownCheckboxItem,
  DropdownSeparator,
  DropdownLabel,
  DropdownGroup,
  DropdownPortal,
  DropdownSub,
  DropdownSubTrigger,
  DropdownRadioGroup,
}
