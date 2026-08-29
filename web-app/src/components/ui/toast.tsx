'use client'

import * as React from 'react'
import * as ToastPrimitive from '@radix-ui/react-toast'
import { motion, AnimatePresence } from 'framer-motion'
import { X, CheckCircle, AlertCircle, AlertTriangle, Info } from 'lucide-react'
import { cn } from '@/lib/utils'
import { spring } from '@/design-system/motion'

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

const variantStyles: Record<ToastVariant, string> = {
  success: 'border-success/30 bg-success-muted',
  error: 'border-danger/30 bg-danger-muted',
  warning: 'border-warning/30 bg-warning-muted',
  info: 'border-info/30 bg-info-muted',
}

const variantIcon: Record<ToastVariant, React.ReactNode> = {
  success: <CheckCircle className="h-4 w-4 text-success shrink-0" />,
  error: <AlertCircle className="h-4 w-4 text-danger shrink-0" />,
  warning: <AlertTriangle className="h-4 w-4 text-warning shrink-0" />,
  info: <Info className="h-4 w-4 text-info shrink-0" />,
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
      <ToastPrimitive.Provider swipeDirection="right" duration={4000}>
        {children}
        <AnimatePresence>
          {toasts.map((t) => (
            <ToastPrimitive.Root
              key={t.id}
              onOpenChange={(open) => { if (!open) remove(t.id) }}
              asChild
            >
              <motion.div
                initial={{ opacity: 0, x: 40, y: 0 }}
                animate={{ opacity: 1, x: 0, y: 0 }}
                exit={{ opacity: 0, x: 40 }}
                transition={spring}
                className={cn(
                  'flex items-start gap-3 w-80 max-w-sm rounded-lg border p-4 shadow-md',
                  'bg-paper border-border',
                  t.variant && variantStyles[t.variant]
                )}
              >
                {t.variant && variantIcon[t.variant]}
                <div className="flex-1 min-w-0">
                  <ToastPrimitive.Title className="text-sm font-sans font-semibold text-ink">
                    {t.title}
                  </ToastPrimitive.Title>
                  {t.description && (
                    <ToastPrimitive.Description className="text-xs text-dim font-sans mt-0.5">
                      {t.description}
                    </ToastPrimitive.Description>
                  )}
                </div>
                <ToastPrimitive.Close
                  className="shrink-0 p-0.5 rounded text-dim hover:text-ink transition-colors"
                  aria-label="Dismiss"
                >
                  <X className="h-3.5 w-3.5" />
                </ToastPrimitive.Close>
              </motion.div>
            </ToastPrimitive.Root>
          ))}
        </AnimatePresence>
        <ToastPrimitive.Viewport className="fixed bottom-4 right-4 z-[400] flex flex-col gap-2 w-80 max-w-sm" />
      </ToastPrimitive.Provider>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastContextValue {
  const ctx = React.useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>')
  return ctx
}
