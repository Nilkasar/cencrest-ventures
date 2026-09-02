'use client'

import * as React from 'react'
import * as ToastPrimitive from '@radix-ui/react-toast'
import { motion, AnimatePresence } from 'framer-motion'
import { X, CheckCircle2, AlertCircle, AlertTriangle, Info } from 'lucide-react'
import { cn } from '@/lib/utils'

type ToastVariant = 'success' | 'error' | 'warning' | 'info'

interface ToastItem {
  id: string
  title: string
  description?: string
  variant?: ToastVariant
}

interface ToastContextValue {
  toast: (item: Omit<ToastItem, 'id'>) => void
}

const ToastContext = React.createContext<ToastContextValue | null>(null)

const variantConfig: Record<
  ToastVariant,
  { borderClass: string; iconWrapClass: string; icon: React.ReactNode }
> = {
  success: {
    borderClass: 'border-l-success',
    iconWrapClass: 'text-success',
    icon: <CheckCircle2 className="h-4 w-4" />,
  },
  error: {
    borderClass: 'border-l-danger',
    iconWrapClass: 'text-danger',
    icon: <AlertCircle className="h-4 w-4" />,
  },
  warning: {
    borderClass: 'border-l-warning',
    iconWrapClass: 'text-warning',
    icon: <AlertTriangle className="h-4 w-4" />,
  },
  info: {
    borderClass: 'border-l-info',
    iconWrapClass: 'text-info',
    icon: <Info className="h-4 w-4" />,
  },
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<ToastItem[]>([])

  const toast = React.useCallback((item: Omit<ToastItem, 'id'>) => {
    const id = Math.random().toString(36).slice(2)
    setToasts((prev) => [...prev, { ...item, id }])
  }, [])

  const remove = React.useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  return (
    <ToastContext.Provider value={{ toast }}>
      <ToastPrimitive.Provider swipeDirection="right" duration={4500}>
        {children}
        <AnimatePresence>
          {toasts.map((t) => {
            const config = t.variant ? variantConfig[t.variant] : null
            return (
              <ToastPrimitive.Root
                key={t.id}
                onOpenChange={(open) => { if (!open) remove(t.id) }}
                asChild
              >
                <motion.div
                  initial={{ opacity: 0, x: 20, y: 0 }}
                  animate={{ opacity: 1, x: 0, y: 0 }}
                  exit={{ opacity: 0, x: 20, scale: 0.98 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 32 }}
                  className={cn(
                    'bg-surface-raised border border-border rounded-xl shadow-lg',
                    'pl-4 pr-3 py-3.5 flex items-start gap-3',
                    'min-w-[300px] max-w-[400px]',
                    'border-l-2',
                    config?.borderClass ?? 'border-l-border-strong'
                  )}
                >
                  {config && (
                    <span
                      className={cn('shrink-0 mt-0.5', config.iconWrapClass)}
                      aria-hidden="true"
                    >
                      {config.icon}
                    </span>
                  )}
                  <div className="flex-1 min-w-0">
                    <ToastPrimitive.Title className="text-[13px] font-semibold text-ink leading-snug">
                      {t.title}
                    </ToastPrimitive.Title>
                    {t.description && (
                      <ToastPrimitive.Description className="text-[12px] text-dim mt-0.5 leading-relaxed">
                        {t.description}
                      </ToastPrimitive.Description>
                    )}
                  </div>
                  <ToastPrimitive.Close
                    className="shrink-0 text-dim hover:text-ink transition-colors mt-0.5 rounded p-0.5 hover:bg-surface"
                    aria-label="Dismiss"
                  >
                    <X className="h-3.5 w-3.5" />
                  </ToastPrimitive.Close>
                </motion.div>
              </ToastPrimitive.Root>
            )
          })}
        </AnimatePresence>
        <ToastPrimitive.Viewport className="fixed bottom-4 right-4 z-[400] flex flex-col gap-2" />
      </ToastPrimitive.Provider>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastContextValue {
  const ctx = React.useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>')
  return ctx
}
