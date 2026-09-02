'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'

export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'prefix'> {
  label?: string
  hint?: string
  error?: string
  /** Icon or element rendered left-inside the input */
  prefix?: React.ReactNode
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, hint, error, prefix: prefixNode, id, ...props }, ref) => {
    const generatedId = React.useId()
    const inputId = id ?? generatedId

    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label
            htmlFor={inputId}
            className="text-[12px] font-semibold text-ink font-sans uppercase tracking-wide"
          >
            {label}
          </label>
        )}

        <div className="relative flex items-center">
          {prefixNode && (
            <span
              className="absolute left-3 flex items-center text-dim pointer-events-none"
              aria-hidden="true"
            >
              {prefixNode}
            </span>
          )}
          <input
            ref={ref}
            id={inputId}
            className={cn(
              'h-10 w-full rounded-md border bg-surface-raised px-3 text-[14px] font-sans text-ink',
              'placeholder:text-dim/60 placeholder:font-normal',
              'shadow-[inset_0_1px_2px_rgba(22,20,15,0.04)]',
              'transition-[border-color,box-shadow] duration-150',
              'hover:border-border-strong',
              'focus-visible:outline-none focus-visible:border-ember focus-visible:ring-2 focus-visible:ring-ember/15 focus-visible:shadow-none',
              'disabled:cursor-not-allowed disabled:opacity-40 disabled:bg-surface',
              prefixNode && 'pl-9',
              error
                ? 'border-danger focus-visible:ring-danger/20 focus-visible:border-danger'
                : 'border-border',
              className
            )}
            aria-invalid={error ? 'true' : undefined}
            aria-describedby={
              error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined
            }
            {...props}
          />
        </div>

        {error && (
          <p
            id={`${inputId}-error`}
            role="alert"
            className="text-[12px] text-danger font-medium font-sans flex items-center gap-1.5"
          >
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-danger flex-shrink-0" aria-hidden="true" />
            {error}
          </p>
        )}
        {!error && hint && (
          <p id={`${inputId}-hint`} className="text-[12px] text-dim font-sans">
            {hint}
          </p>
        )}
      </div>
    )
  }
)
Input.displayName = 'Input'
