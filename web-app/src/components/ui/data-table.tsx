'use client'

import * as React from 'react'
import { ChevronLeft, ChevronRight, Table2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { SkeletonText } from '@/components/ui/skeleton'

export interface Column<T> {
  key: keyof T | string
  header: string
  className?: string
  render?: (value: unknown, row: T) => React.ReactNode
}

interface DataTableProps<T> {
  data: T[]
  columns: Column<T>[]
  className?: string
  emptyMessage?: string
  emptyIcon?: React.ReactNode
  loading?: boolean
  rowKey?: (row: T) => string | number
  pageSize?: number
}

export function DataTable<T extends Record<string, unknown>>({
  data,
  columns,
  className,
  emptyMessage = 'No data available.',
  emptyIcon,
  loading = false,
  rowKey,
  pageSize = 10,
}: DataTableProps<T>) {
  const [page, setPage] = React.useState(0)
  const totalPages = Math.ceil(data.length / pageSize)
  const pageData = data.slice(page * pageSize, (page + 1) * pageSize)

  React.useEffect(() => {
    setPage(0)
  }, [data.length])

  return (
    <div className={cn('w-full flex flex-col gap-0', className)}>
      <div className="w-full overflow-x-auto">
        <table className="w-full border-collapse font-sans">
          <thead className="border-b border-border sticky top-0 bg-surface z-10">
            <tr>
              {columns.map((col, i) => (
                <th
                  key={String(col.key)}
                  className={cn(
                    'text-left text-[11px] font-semibold text-dim uppercase tracking-wider px-4 py-3.5',
                    i === 0 && 'pl-6',
                    i === columns.length - 1 && 'pr-6',
                    col.className
                  )}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: Math.min(pageSize, 5) }).map((_, i) => (
                <tr key={i} className="border-b border-border/50 last:border-0">
                  {columns.map((col, ci) => (
                    <td
                      key={String(col.key)}
                      className={cn(
                        'px-4 py-4',
                        ci === 0 && 'pl-6',
                        ci === columns.length - 1 && 'pr-6'
                      )}
                    >
                      <SkeletonText lines={1} />
                    </td>
                  ))}
                </tr>
              ))
            ) : pageData.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="py-12 text-center">
                  <div className="flex flex-col items-center justify-center gap-3">
                    <div className="w-12 h-12 rounded-2xl bg-surface border border-border flex items-center justify-center text-dim mb-1">
                      {emptyIcon ?? <Table2 className="h-5 w-5" />}
                    </div>
                    <p className="text-[14px] font-semibold text-ink font-display">{emptyMessage}</p>
                  </div>
                </td>
              </tr>
            ) : (
              pageData.map((row, i) => (
                <tr
                  key={rowKey ? rowKey(row) : i}
                  className="border-b border-border/50 last:border-0 hover:bg-surface/50 transition-colors duration-100"
                >
                  {columns.map((col, ci) => {
                    const val = row[col.key as keyof T]
                    return (
                      <td
                        key={String(col.key)}
                        className={cn(
                          'text-[14px] text-ink px-4 py-4',
                          ci === 0 && 'pl-6',
                          ci === columns.length - 1 && 'pr-6',
                          col.className
                        )}
                      >
                        {col.render ? col.render(val as unknown, row) : String(val ?? '—')}
                      </td>
                    )
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between px-6 py-3 border-t border-border">
          <span className="text-[11px] text-dim font-sans uppercase tracking-wider">
            Page {page + 1} of {totalPages}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="p-1.5 rounded-md text-dim hover:text-ink hover:bg-surface disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              aria-label="Previous page"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page === totalPages - 1}
              className="p-1.5 rounded-md text-dim hover:text-ink hover:bg-surface disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              aria-label="Next page"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
