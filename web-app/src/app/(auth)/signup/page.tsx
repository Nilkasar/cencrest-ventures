'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { motion } from 'framer-motion'
import { Loader2, TriangleAlert, CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { api } from '@/lib/api'

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
        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        className="text-center"
        style={{ paddingTop: 16 }}
      >
        <motion.div
          initial={{ scale: 0, rotate: -12 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: 'spring', stiffness: 280, damping: 20, delay: 0.08 }}
          style={{ display: 'flex', justifyContent: 'center', marginBottom: 20 }}
        >
          <CheckCircle2 size={48} strokeWidth={1.5} style={{ color: 'var(--success)' }} />
        </motion.div>
        <h2
          className="font-display font-semibold"
          style={{ fontSize: 22, color: 'var(--ink)', letterSpacing: '-0.02em', marginBottom: 8 }}
        >
          Application received
        </h2>
        <p
          className="font-sans"
          style={{ fontSize: 14, color: 'var(--dim)', lineHeight: 1.65, maxWidth: 320, margin: '0 auto 24px' }}
        >
          We'll be in touch shortly.
        </p>
        <Link
          href="/login"
          className="font-sans transition-colors"
          style={{ fontSize: 13, color: 'var(--ember)', fontWeight: 500 }}
        >
          Back to sign in →
        </Link>
      </motion.div>
    )
  }

  return (
    <div>
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      >
        <h1
          className="font-display font-semibold"
          style={{ fontSize: 28, color: 'var(--ink)', letterSpacing: '-0.02em', marginBottom: 6 }}
        >
          Apply for access
        </h1>
        <p className="font-sans" style={{ fontSize: 14, color: 'var(--dim)', marginBottom: 32 }}>
          Spots are limited. We review every application personally.
        </p>
      </motion.div>

      {/* Global error */}
      {error && (
        <motion.div
          initial={{ opacity: 0, x: -4 }}
          animate={{ opacity: 1, x: 0 }}
          className="mb-5 flex items-start gap-3 rounded-lg font-sans"
          style={{
            borderLeft: '4px solid var(--danger)',
            background: 'rgba(220,38,38,0.07)',
            padding: '12px 14px',
          }}
        >
          <TriangleAlert
            size={15}
            style={{ color: 'var(--danger)', flexShrink: 0, marginTop: 1 }}
          />
          <span style={{ fontSize: 13, color: 'var(--danger)', lineHeight: 1.5 }}>{error}</span>
        </motion.div>
      )}

      <form onSubmit={handleSubmit(onSubmit)}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {FIELDS.map((field, i) => (
            <motion.div
              key={field.name}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                duration: 0.4,
                delay: [0, 0.06, 0.12, 0.18, 0.24][i] ?? 0,
                ease: [0.16, 1, 0.3, 1],
              }}
            >
              <label
                htmlFor={field.name}
                className="font-sans"
                style={{
                  display: 'block',
                  fontSize: 13,
                  fontWeight: 500,
                  color: 'var(--dim)',
                  marginBottom: 6,
                }}
              >
                {field.label}
              </label>
              <Input
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

        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.3, ease: [0.16, 1, 0.3, 1] }}
          style={{ marginTop: 28 }}
        >
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
                Submitting…
              </span>
            ) : (
              'Submit application'
            )}
          </Button>
        </motion.div>
      </form>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.4, delay: 0.38 }}
        className="text-center"
        style={{ marginTop: 24, paddingTop: 20, borderTop: '1px solid var(--border)' }}
      >
        <p className="font-sans" style={{ fontSize: 13, color: 'var(--dim)' }}>
          Already have an account?{' '}
          <Link
            href="/login"
            className="cursor-pointer transition-colors"
            style={{ color: 'var(--ember)', fontWeight: 500 }}
          >
            Sign in →
          </Link>
        </p>
      </motion.div>
    </div>
  )
}
