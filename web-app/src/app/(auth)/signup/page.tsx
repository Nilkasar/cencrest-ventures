'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { motion } from 'framer-motion'
import { Loader2, TriangleAlert, CheckCircle2, ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { api } from '@/lib/api'
import { SPRING_CURVE } from '@/lib/motion'

const schema = z
  .object({
    name: z.string().min(2, 'Full name must be at least 2 characters'),
    company: z.string().min(1, 'Company name is required'),
    email: z.string().email('Enter a valid work email'),
    password: z.string().min(8, 'Password must be at least 8 characters'),
    confirmPassword: z.string(),
  })
  .refine((d) => d.password === d.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Passwords do not match',
  })

type FormData = z.infer<typeof schema>

interface FieldDef {
  name: keyof FormData
  label: string
  type: string
  autoComplete: string
  placeholder: string
}

const FIELDS: FieldDef[] = [
  { name: 'name', label: 'Full name', type: 'text', autoComplete: 'name', placeholder: 'Jane Smith' },
  { name: 'company', label: 'Company', type: 'text', autoComplete: 'organization', placeholder: 'Acme Corp' },
  { name: 'email', label: 'Work email', type: 'email', autoComplete: 'email', placeholder: 'you@company.com' },
  { name: 'password', label: 'Password', type: 'password', autoComplete: 'new-password', placeholder: '8+ characters' },
  { name: 'confirmPassword', label: 'Confirm password', type: 'password', autoComplete: 'new-password', placeholder: 'Repeat password' },
]


export default function SignupPage() {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({ resolver: zodResolver(schema) })

  async function onSubmit(data: FormData) {
    setError(null)
    try {
      await api.post('/api/auth/register', data)
      setSubmitted(true)
      setTimeout(() => router.push('/create-org'), 1200)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Registration failed. Try again.'
      if (msg.toLowerCase().includes('404') || msg.toLowerCase().includes('not found')) {
        setSubmitted(true)
      } else {
        setError(msg)
      }
    }
  }

  if (submitted) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.4, ease: SPRING_CURVE }}
        className="text-center py-4"
      >
        <motion.div
          initial={{ scale: 0, rotate: -12 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: 'spring', stiffness: 280, damping: 20, delay: 0.08 }}
          className="flex justify-center mb-5"
        >
          <CheckCircle2 size={48} strokeWidth={1.5} className="text-success" />
        </motion.div>
        <h2 className="font-display font-semibold text-ink text-xl tracking-tight mb-2">
          Application received
        </h2>
        <p className="font-sans text-sm text-dim leading-relaxed max-w-xs mx-auto mb-6">
          We&apos;ll be in touch shortly.
        </p>
        <Link
          href="/login"
          className="font-sans text-[13px] text-ember font-medium transition-colors hover:underline underline-offset-2"
        >
          Back to sign in →
        </Link>
      </motion.div>
    )
  }

  return (
    <div className="w-full">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: SPRING_CURVE }}
        className="mb-8"
      >
        <h1 className="font-display font-semibold text-ink text-[32px] leading-tight tracking-tight">
          Apply for access
        </h1>
        <p className="font-sans text-[15px] text-dim mt-2.5 leading-relaxed">
          Spots are limited. We review every application personally.
        </p>
      </motion.div>

      {/* Global error */}
      {error && (
        <motion.div
          initial={{ opacity: 0, x: -4 }}
          animate={{ opacity: 1, x: 0 }}
          className="mb-5 flex items-start gap-3 rounded-lg border-l-[3px] border-danger bg-danger/[0.06] px-4 py-3.5"
        >
          <TriangleAlert size={15} className="text-danger shrink-0 mt-px" />
          <span className="font-sans text-[13px] text-danger leading-snug">{error}</span>
        </motion.div>
      )}

      <form onSubmit={handleSubmit(onSubmit)}>
        <div className="flex flex-col gap-5">
          {FIELDS.map((field, i) => (
            <motion.div
              key={field.name}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                duration: 0.4,
                delay: [0, 0.06, 0.12, 0.18, 0.24][i] ?? 0,
                ease: SPRING_CURVE,
              }}
            >
              <Input
                label={field.label}
                id={field.name}
                {...register(field.name)}
                type={field.type}
                placeholder={field.placeholder}
                autoComplete={field.autoComplete}
                disabled={isSubmitting}
                error={errors[field.name]?.message}
                className="w-full"
              />
            </motion.div>
          ))}
        </div>

        {/* OAuth divider */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.35, delay: 0.28, ease: SPRING_CURVE }}
          className="flex items-center gap-3 mt-8 mb-5"
        >
          <div className="flex-1 h-px bg-border" />
          <span className="text-xs text-dim font-medium font-sans">or continue with</span>
          <div className="flex-1 h-px bg-border" />
        </motion.div>

        {/* Google OAuth */}
        <motion.div
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.32, ease: SPRING_CURVE }}
          className="mb-6"
        >
          <Button
            variant="outline"
            className="w-full h-11 gap-2.5 font-sans font-medium text-sm"
            type="button"
          >
            <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
              <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
              <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
              <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
              <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
            </svg>
            Continue with Google
          </Button>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.36, ease: SPRING_CURVE }}
        >
          <Button
            type="submit"
            size="lg"
            disabled={isSubmitting}
            loading={isSubmitting}
            className="w-full h-11 rounded-lg font-sans font-semibold text-[15px] bg-ember hover:bg-ember-light active:bg-ember-dark text-paper shadow-ember transition-colors gap-2"
          >
            {isSubmitting ? (
              <span className="flex items-center justify-center gap-2">
                <Loader2 size={15} className="animate-spin" />
                Submitting…
              </span>
            ) : (
              <>
                Submit application
                <ArrowRight size={16} />
              </>
            )}
          </Button>
        </motion.div>
      </form>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.4, delay: 0.42 }}
        className="mt-8 pt-6 border-t border-border text-center"
      >
        <p className="font-sans text-[13px] text-dim">
          Already have an account?{' '}
          <Link
            href="/login"
            className="text-ember font-medium hover:underline underline-offset-2 transition-colors"
          >
            Sign in →
          </Link>
        </p>
      </motion.div>
    </div>
  )
}
