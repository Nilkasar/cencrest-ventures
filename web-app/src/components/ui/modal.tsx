'use client'

import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { motion, AnimatePresence } from 'framer-motion'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

const SPRING = { type: 'spring' as const, stiffness: 420, damping: 34, mass: 0.9 }

const Modal = DialogPrimitive.Root
const ModalTrigger = DialogPrimitive.Trigger
const ModalClose = DialogPrimitive.Close
const ModalPortal = DialogPrimitive.Portal

function ModalOverlay({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      className={cn(
        'fixed inset-0 z-[300] bg-ink/40 backdrop-blur-[3px]',
        'data-[state=open]:animate-[fadeIn_0.18s_ease-out]',
        'data-[state=closed]:animate-[fadeIn_0.14s_ease-in_reverse]',
        className
      )}
      {...props}
    />
  )
}

interface ModalContentProps extends React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> {
  showClose?: boolean
  size?: 'sm' | 'md' | 'lg'
}

const sizeClass = {
  sm: 'max-w-md',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
}

function ModalContent({
  className,
  children,
  showClose = true,
  size = 'md',
  ...props
}: ModalContentProps) {
  return (
    <ModalPortal>
      <ModalOverlay />
      <DialogPrimitive.Content
        className={cn(
          'fixed left-1/2 top-1/2 z-[301] -translate-x-1/2 -translate-y-1/2',
          'w-full mx-4 focus:outline-none',
          sizeClass[size]
        )}
        {...props}
      >
        <motion.div
          initial={{ scale: 0.96, opacity: 0, y: 8 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.97, opacity: 0, y: 4 }}
          transition={SPRING}
          className={cn(
            'bg-surface-raised rounded-2xl border border-border overflow-hidden',
            'shadow-[0_24px_64px_rgba(22,20,15,0.18),0_8px_24px_rgba(22,20,15,0.08)]',
            className
          )}
        >
          {showClose && (
            <DialogPrimitive.Close
              className={cn(
                'absolute right-4 top-4 z-10 rounded-md p-1.5 text-dim',
                'transition-colors hover:text-ink hover:bg-surface',
                'focus:outline-none focus:ring-2 focus:ring-ember/40'
              )}
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </DialogPrimitive.Close>
          )}
          {children}
        </motion.div>
      </DialogPrimitive.Content>
    </ModalPortal>
  )
}

function ModalHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('px-6 pt-6 pb-4 border-b border-border', className)}
      {...props}
    />
  )
}

function ModalTitle({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      className={cn('font-display text-xl font-semibold text-ink leading-tight pr-8 tracking-tight', className)}
      {...props}
    />
  )
}

function ModalDescription({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      className={cn('text-[13px] text-dim font-sans mt-1 leading-relaxed', className)}
      {...props}
    />
  )
}

function ModalBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('px-6 py-5', className)} {...props} />
}

function ModalFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'flex items-center justify-end gap-3 px-6 py-4 border-t border-border bg-surface/40',
        className
      )}
      {...props}
    />
  )
}

export {
  Modal,
  ModalTrigger,
  ModalClose,
  ModalContent,
  ModalHeader,
  ModalTitle,
  ModalDescription,
  ModalBody,
  ModalFooter,
  AnimatePresence,
}
