'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { motion, AnimatePresence } from 'framer-motion'
import { Loader2, CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { api } from '@/lib/api'

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
          transition={{ duration: 0.38, ease: [0.16, 1, 0.3, 1] }}
          className="text-center"
          style={{ paddingTop: 12 }}
        >
          <motion.div
            initial={{ scale: 0, rotate: -15 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: 'spring', stiffness: 280, damping: 22, delay: 0.1 }}
            style={{ display: 'flex', justifyContent: 'center', marginBottom: 20 }}
          >
            <CheckCircle2 size={40} strokeWidth={1.5} style={{ color: 'var(--success)' }} />
          </motion.div>

          <h1
            className="font-display font-semibold"
            style={{ fontSize: 24, color: 'var(--ink)', letterSpacing: '-0.02em', marginBottom: 8 }}
          >
            Check your inbox
          </h1>
          <p className="font-sans" style={{ fontSize: 14, color: 'var(--dim)', lineHeight: 1.65, marginBottom: 28 }}>
            We sent a reset link to{' '}
            <span style={{ color: 'var(--ink)', fontWeight: 500 }}>{sentEmail}</span>.{' '}
            Check your spam if you don&apos;t see it.
          </p>

          <div className="flex flex-col items-center gap-3">
            <button
              type="button"
              onClick={() => setSuccess(false)}
              className="font-sans transition-colors cursor-pointer"
              style={{
                fontSize: 13,
                color: 'var(--dim)',
                background: 'none',
                border: 'none',
                padding: 0,
              }}
            >
              Send again
            </button>
            <Link
              href="/login"
              className="font-sans transition-colors cursor-pointer"
              style={{ fontSize: 13, color: 'var(--ember)', fontWeight: 500 }}
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
          transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
        >
          <h1
            className="font-display font-semibold"
            style={{ fontSize: 28, color: 'var(--ink)', letterSpacing: '-0.02em', marginBottom: 6 }}
          >
            Reset password
          </h1>
          <p className="font-sans" style={{ fontSize: 14, color: 'var(--dim)', marginBottom: 32 }}>
            Enter your email and we&apos;ll send a reset link.
          </p>

          {error && (
            <div
              className="mb-5 px-4 py-3 rounded-lg font-sans"
              style={{
                borderLeft: '4px solid var(--danger)',
                background: 'rgba(220,38,38,0.07)',
                fontSize: 13,
                color: 'var(--danger)',
              }}
            >
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit(onSubmit)}>
            <div>
              <label
                htmlFor="email"
                className="font-sans"
                style={{ display: 'block', fontSize: 13, fontWeight: 500, color: 'var(--dim)', marginBottom: 6 }}
              >
                Work email
              </label>
              <Input
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
            </div>

            <div style={{ marginTop: 24 }}>
              <Button
                type="submit"
                disabled={isSubmitting}
                loading={isSubmitting}
                className="w-full font-sans font-medium"
                style={{ height: 42, fontSize: 14 }}
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

          <div
            className="text-center"
            style={{ marginTop: 24, paddingTop: 20, borderTop: '1px solid var(--border)' }}
          >
            <Link
              href="/login"
              className="font-sans transition-colors cursor-pointer"
              style={{ fontSize: 13, color: 'var(--dim)' }}
            >
              ← Back to sign in
            </Link>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
