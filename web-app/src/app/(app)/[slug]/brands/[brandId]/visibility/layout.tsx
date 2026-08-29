'use client'

import { useParams, usePathname } from 'next/navigation'
import Link from 'next/link'
import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'

const NAV_ITEMS = [
  { label: 'Overview', href: (slug: string, brandId: string) => `/${slug}/brands/${brandId}/visibility` },
  { label: 'Runs', href: (slug: string, brandId: string) => `/${slug}/brands/${brandId}/visibility/runs` },
]

export default function VisibilityLayout({ children }: { children: React.ReactNode }) {
  const { slug, brandId } = useParams<{ slug: string; brandId: string }>()
  const pathname = usePathname()

  return (
    <div className="flex flex-col min-h-0 flex-1">
      {/* Sticky sub-nav */}
      <div className="sticky top-0 z-20 bg-paper border-b border-border">
        <nav className="flex items-end gap-0 px-6 max-w-screen-xl mx-auto">
          {NAV_ITEMS.map((item) => {
            const href = item.href(slug, brandId)
            const isActive = item.label === 'Overview'
              ? pathname === href
              : pathname.startsWith(href)
            return (
              <Link
                key={item.label}
                href={href}
                className={cn(
                  'relative px-4 py-3 text-sm font-sans font-medium transition-colors duration-150',
                  '-mb-px',
                  isActive ? 'text-ink' : 'text-dim hover:text-ink'
                )}
              >
                {item.label}
                {isActive && (
                  <motion.span
                    layoutId="visibility-nav-indicator"
                    className="absolute bottom-0 left-0 right-0 h-0.5 bg-ink rounded-full"
                    transition={{ type: 'spring', stiffness: 400, damping: 32 }}
                  />
                )}
              </Link>
            )
          })}
        </nav>
      </div>

      {/* Page content */}
      <div className="flex-1 px-6 py-8 max-w-screen-xl mx-auto w-full">
        {children}
      </div>
    </div>
  )
}
