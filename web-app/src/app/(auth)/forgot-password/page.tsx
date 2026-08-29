'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { motion, AnimatePresence } from 'framer-motion'
import { Loader2, CheckCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { api } from '@/lib/api'

const schema = z.object({
  email: z.string().email('Enter a valid email'),
})
type FormData = z.infer<typeof schema>

export default function ForgotPasswordPage() {
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({ resolver: zodResolver(schema) })

  async function onSubmit(data: FormData) {
    setError(null)
    try {
      await api.post('/api/auth/forgot-password', data)
      setSuccess(true)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Try again.')
    }
  }

  return (
    <div className="w-full max-w-sm mx-auto">
      <div className="bg-white/70 backdrop-blur-sm border border-[var(--border)] rounded-2xl p-8 shadow-sm">
        <AnimatePresence mode="wait">
          {success ? (
            <motion.div
              key="success"
              className="flex flex-col items-center text-center gap-4 py-4"
              initial={{ opacity: 0, scale: 0.92 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.92 }}
              transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
            >
              <motion.div
                initial={{ scale: 0, rotate: -20 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{ type: 'spring', stiffness: 300, damping: 20, delay: 0.1 }}
              >
                <CheckCircle size={48} className="text-[var(--success)]" strokeWidth={1.5} />
              </motion.div>
              <div>
                <h2 className="font-display font-semibold text-[var(--ink)] text-xl mb-1">
                  Check your inbox
                </h2>
                <p className="text-[var(--dim)] text-sm">
                  We sent a reset link to your email. It expires in 30 minutes.
                </p>
              </div>
              <Link
                href="/login"
                className="text-sm text-[var(--ember)] hover:underline cursor-pointer mt-2"
              >
                Back to sign in
              </Link>
            </motion.div>
          ) : (
            <motion.div
              key="form"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25 }}
            >
              <h2 className="font-display font-semibold text-[var(--ink)] text-2xl mb-1">
                Reset password
              </h2>
              <p className="text-[var(--dim)] text-sm mb-6">
                Enter your email and we&apos;ll send a reset link.
              </p>

              <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                <div>
                  <Input
                    {...register('email')}
                    type="email"
                    placeholder="you@company.com"
                    autoComplete="email"
                    autoFocus
                    disabled={isSubmitting}
                    className="w-full"
                  />
                  {errors.email && (
                    <p className="mt-1 text-xs text-[var(--danger)]">{errors.email.message}</p>
                  )}
                </div>

                {error && (
                  <div className="rounded-lg bg-[var(--danger)]/10 border border-[var(--danger)]/20 px-3 py-2 text-sm text-[var(--danger)]">
                    {error}
                  </div>
                )}

                <Button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full bg-[var(--ember)] hover:bg-[var(--ember-light)] text-white font-medium cursor-pointer transition-colors"
                >
                  {isSubmitting ? (
                    <span className="flex items-center gap-2">
                      <Loader2 size={16} className="animate-spin" />
                      Sending…
                    </span>
                  ) : (
                    'Send reset link'
                  )}
                </Button>
              </form>

              <p className="mt-4 text-sm text-center">
                <Link
                  href="/login"
                  className="text-[var(--dim)] hover:text-[var(--ember)] transition-colors cursor-pointer"
                >
                  Back to sign in
                </Link>
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
