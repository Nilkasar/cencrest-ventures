'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { motion } from 'framer-motion'
import { Loader2, TriangleAlert } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'
import { setToken, setStoredUser } from '@/lib/auth-storage'

const schema = z.object({
  email: z.string().email('Enter a valid email'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
})
type FormData = z.infer<typeof schema>

const FIELDS = [
  {
    name: 'email' as const,
    label: 'Work email',
    type: 'email',
    autoComplete: 'email',
    placeholder: 'you@company.com',
    autoFocus: true,
  },
  {
    name: 'password' as const,
    label: 'Password',
    type: 'password',
    autoComplete: 'current-password',
    placeholder: '••••••••',
    autoFocus: false,
  },
]

export default function LoginPage() {
  const [error, setError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({ resolver: zodResolver(schema) })

  async function onSubmit(data: FormData) {
    setError(null)
    try {
      const res = await api.post<{
        accessToken: string
        user: { id: string; email: string; name: string }
        orgs?: Array<{ slug: string }>
      }>('/api/auth/login', data)
      setToken(res.accessToken)
      setStoredUser(res.user)
      const orgsRes = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'}/api/orgs`,
        { headers: { Authorization: `Bearer ${res.accessToken}` } }
      )
      if (orgsRes.ok) {
        const orgs = (await orgsRes.json()) as Array<{ slug: string }>
        const slug = orgs[0]?.slug
        window.location.href = slug ? `/${slug}/dashboard` : '/onboarding'
      } else {
        window.location.href = '/onboarding'
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Login failed. Try again.')
    }
  }

  return (
    <div>
      {/* Heading */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      >
        <h1
          className="font-display font-semibold"
          style={{ fontSize: 28, color: 'var(--ink)', letterSpacing: '-0.02em', marginBottom: 6 }}
        >
          Sign in
        </h1>
        <p className="font-sans" style={{ fontSize: 14, color: 'var(--dim)', marginBottom: 32 }}>
          Welcome back. Continue where you left off.
        </p>
      </motion.div>

      {/* Global error — card with red left-border stripe */}
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {FIELDS.map((field, i) => (
            <motion.div
              key={field.name}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                duration: 0.4,
                delay: i === 0 ? 0 : i === 1 ? 0.06 : 0.12,
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
                autoFocus={field.autoFocus}
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
          transition={{ duration: 0.4, delay: 0.18, ease: [0.16, 1, 0.3, 1] }}
          style={{ marginTop: 28 }}
        >
          <Button
            type="submit"
            disabled={isSubmitting}
            loading={isSubmitting}
            className="w-full font-sans font-medium"
            style={{
              height: 42,
              fontSize: 14,
            }}
          >
            {isSubmitting ? (
              <span className="flex items-center justify-center gap-2">
                <Loader2 size={15} className="animate-spin" />
                Signing in…
              </span>
            ) : (
              'Sign in'
            )}
          </Button>

          {/* Two-column row below button */}
          <div className="flex items-center justify-between mt-3">
            <Link
              href="/forgot-password"
              className="font-sans transition-colors"
              style={{ fontSize: 13, color: 'var(--dim)' }}
            >
              Forgot password?
            </Link>
            <Link
              href="/signup"
              className="font-sans transition-colors"
              style={{ fontSize: 13, color: 'var(--ember)', fontWeight: 500 }}
            >
              Create account
            </Link>
          </div>
        </motion.div>
      </form>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.4, delay: 0.35 }}
        className="text-center"
        style={{ marginTop: 28, paddingTop: 24, borderTop: '1px solid var(--border)' }}
      >
        <p className="font-sans" style={{ fontSize: 13, color: 'var(--dim)' }}>
          No account?{' '}
          <Link
            href="/signup"
            className="cursor-pointer transition-colors"
            style={{ color: 'var(--ember)', fontWeight: 500 }}
          >
            Apply for access →
          </Link>
        </p>
      </motion.div>
    </div>
  )
}
