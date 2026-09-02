'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { motion, AnimatePresence } from 'framer-motion'
import { Loader2, CheckCircle2, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { api } from '@/lib/api'
import { SPRING_CURVE } from '@/lib/motion'

const schema = z.object({
  email: z.string().email('Enter a valid email'),
})
type FormData = z.infer<typeof schema>


export default function ForgotPasswordPage() {
  const [success, setSuccess] = useState(false)
  const [sentEmail, setSentEmail] = useState('')
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
      setSentEmail(data.email)
      setSuccess(true)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Something went wrong. Try again.'
      if (msg.toLowerCase().includes('404') || msg.toLowerCase().includes('not found')) {
        setSentEmail(data.email)
        setSuccess(true)
      } else {
        setError(msg)
      }
    }
  }

  return (
    <AnimatePresence mode="wait">
      {success ? (
        <motion.div
          key="success"
          initial={{ opacity: 0, scale: 0.94 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.94 }}
          transition={{ duration: 0.38, ease: SPRING_CURVE }}
          className="text-center py-3"
        >
          <motion.div
            initial={{ scale: 0, rotate: -15 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: 'spring', stiffness: 280, damping: 22, delay: 0.1 }}
            className="flex justify-center mb-5"
          >
            <CheckCircle2 size={40} strokeWidth={1.5} className="text-success" />
          </motion.div>

          <h1 className="font-display font-semibold text-ink text-2xl tracking-tight mb-2">
            Check your inbox
          </h1>
          <p className="font-sans text-sm text-dim leading-relaxed mb-7">
            We sent a reset link to{' '}
            <span className="text-ink font-medium">{sentEmail}</span>.{' '}
            Check your spam if you don&apos;t see it.
          </p>

          <div className="flex flex-col items-center gap-3">
            <button
              type="button"
              onClick={() => setSuccess(false)}
              className="font-sans text-[13px] text-dim hover:text-ink transition-colors cursor-pointer bg-transparent border-0 p-0"
            >
              Send again
            </button>
            <Link
              href="/login"
              className="font-sans text-[13px] text-ember font-medium hover:underline underline-offset-2 transition-colors"
            >
              ← Back to sign in
            </Link>
          </div>
        </motion.div>
      ) : (
        <motion.div
          key="form"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.35, ease: SPRING_CURVE }}
          className="w-full"
        >
          <div className="mb-8">
            <h1 className="font-display font-semibold text-ink text-2xl leading-tight tracking-tight">
              Reset password
            </h1>
            <p className="font-sans text-[15px] text-dim mt-2.5 leading-relaxed">
              Enter your email and we&apos;ll send a reset link.
            </p>
          </div>

          {error && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-5 flex items-start gap-3 rounded-lg border-l-[3px] border-danger bg-danger/[0.06] px-4 py-3.5"
            >
              <TriangleAlert size={15} className="text-danger shrink-0 mt-px" />
              <span className="font-sans text-[13px] text-danger leading-snug">{error}</span>
            </motion.div>
          )}

          <form onSubmit={handleSubmit(onSubmit)}>
            <Input
              label="Work email"
              id="email"
              {...register('email')}
              type="email"
              placeholder="you@company.com"
              autoComplete="email"
              autoFocus
              disabled={isSubmitting}
              error={errors.email?.message}
              className="w-full"
            />

            <div className="mt-6">
              <Button
                type="submit"
                size="lg"
                disabled={isSubmitting}
                loading={isSubmitting}
                className="w-full h-11 rounded-lg font-sans font-semibold text-[15px] bg-ember hover:bg-ember-light active:bg-ember-dark text-paper shadow-ember transition-colors"
              >
                {isSubmitting ? (
                  <span className="flex items-center justify-center gap-2">
                    <Loader2 size={15} className="animate-spin" />
                    Sending…
                  </span>
                ) : (
                  'Send reset link'
                )}
              </Button>
            </div>
          </form>

          <div className="mt-7 pt-6 border-t border-border text-center">
            <Link
              href="/login"
              className="font-sans text-[13px] text-dim hover:text-ink transition-colors"
            >
              ← Back to sign in
            </Link>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
