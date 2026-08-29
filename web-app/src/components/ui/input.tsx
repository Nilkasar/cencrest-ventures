'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  hint?: string
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, error, hint, id, ...props }, ref) => {
    const inputId = id ?? label?.toLowerCase().replace(/\s+/g, '-')

    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label
            htmlFor={inputId}
            className="text-[13px] font-medium text-ink font-sans leading-none"
          >
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          className={cn(
            // Size & spacing
            'h-11 w-full rounded-lg border px-4 text-[15px] font-sans text-ink',
            // Background & placeholder
            'bg-white placeholder:text-[var(--dim)] placeholder:font-normal',
            // Transitions
            'transition-[border-color,box-shadow] duration-150 ease-spring',
            // Focus
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember/30 focus-visible:ring-offset-0 focus-visible:border-ember',
            // Disabled
            'disabled:cursor-not-allowed disabled:opacity-50 disabled:bg-[var(--surface)]',
            // Error vs normal border
            error
              ? 'border-danger focus-visible:ring-danger/30 focus-visible:border-danger'
              : 'border-[var(--border)] hover:border-[var(--border-strong)]',
            className
          )}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={
            error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined
          }
          {...props}
        />
        {error && (
          <p id={`${inputId}-error`} className="text-[12px] text-danger font-sans leading-none mt-0.5">
            {error}
          </p>
        )}
        {!error && hint && (
          <p id={`${inputId}-hint`} className="text-[12px] text-dim font-sans leading-none mt-0.5">
            {hint}
          </p>
        )}
      </div>
    )
  }
)

Input.displayName = 'Input'
