'use client'

import * as React from 'react'
import * as TabsPrimitive from '@radix-ui/react-tabs'
import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'

export const Tabs = TabsPrimitive.Root

export function TabsList({
  className,
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      className={cn(
        'relative flex items-center border-b border-border w-full gap-0',
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
  const ref = React.useRef<HTMLButtonElement>(null)
  const [active, setActive] = React.useState(false)

  React.useEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => setActive(el.getAttribute('data-state') === 'active')
    update()
    const obs = new MutationObserver(update)
    obs.observe(el, { attributes: true, attributeFilter: ['data-state'] })
    return () => obs.disconnect()
  }, [])

  return (
    <TabsPrimitive.Trigger
      ref={ref}
      className={cn(
        'relative px-4 py-2.5 -mb-px text-[13px] font-sans font-medium',
        'transition-colors duration-150 outline-none',
        'text-dim hover:text-ink',
        'data-[state=active]:text-ink',
        'focus-visible:ring-2 focus-visible:ring-ember/40 focus-visible:rounded-md',
        className
      )}
      {...props}
    >
      {children}
      {active && (
        <motion.span
          layoutId="tabs-indicator"
          className="absolute bottom-0 left-0 right-0 h-[2px] rounded-t-full bg-ember"
          transition={{ type: 'spring', stiffness: 500, damping: 38, mass: 0.8 }}
          aria-hidden="true"
        />
      )}
    </TabsPrimitive.Trigger>
  )
}

export function TabsContent({
  className,
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      className={cn('pt-6 focus-visible:outline-none', className)}
      {...props}
    >
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
      >
        {children}
      </motion.div>
    </TabsPrimitive.Content>
  )
}
