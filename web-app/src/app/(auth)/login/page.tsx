'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { motion } from 'framer-motion'
import { TriangleAlert } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'
import { setToken, setStoredUser } from '@/lib/auth-storage'

const schema = z.object({
  email: z.string().email('Enter a valid email'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
})
type FormData = z.infer<typeof schema>

const SPRING = [0.16, 1, 0.3, 1] as const

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
      }>('/api/auth/login', data)
      setToken(res.accessToken)
      setStoredUser(res.user)
      const orgsRes = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'}/api/orgs`,
        { headers: { Authorization: `Bearer ${res.accessToken}` } }
      )
      if (orgsRes.ok) {
        const orgs = (await orgsRes.json()) as Array<{ slug: string }>
        window.location.href = orgs[0]?.slug ? `/${orgs[0].slug}/dashboard` : '/create-org'
      } else {
        window.location.href = '/create-org'
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Login failed. Try again.')
    }
  }

  return (
    <div className="w-full">
      {/* Heading */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: SPRING }}
        className="mb-8"
      >
        <h1 className="font-display font-semibold text-[var(--ink)] text-[28px] leading-tight tracking-[-0.02em]">
          Welcome back
        </h1>
        <p className="font-sans text-sm text-[var(--dim)] mt-1.5">
          Sign in to your BeBest account
        </p>
      </motion.div>

      {/* Global error */}
      {error && (
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-5 flex items-start gap-2.5 rounded-lg border-l-4 border-danger bg-danger/8 px-3.5 py-3"
        >
          <TriangleAlert size={14} className="text-danger shrink-0 mt-0.5" />
          <span className="font-sans text-[13px] text-danger leading-snug">{error}</span>
        </motion.div>
      )}

      <form onSubmit={handleSubmit(onSubmit)} noValidate>
        <div className="flex flex-col gap-5">
          {/* Email */}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, delay: 0.06, ease: SPRING }}
          >
            <label
              htmlFor="email"
              className="block font-sans text-[13px] font-medium text-[var(--ink)] mb-1.5"
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
          </motion.div>

          {/* Password */}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, delay: 0.12, ease: SPRING }}
          >
            <div className="flex items-center justify-between mb-1.5">
              <label
                htmlFor="password"
                className="font-sans text-[13px] font-medium text-[var(--ink)]"
              >
                Password
              </label>
              <Link
                href="/forgot-password"
                className="font-sans text-[12px] text-[var(--dim)] hover:text-[var(--ember)] transition-colors"
              >
                Forgot password?
              </Link>
            </div>
            <Input
              id="password"
              {...register('password')}
              type="password"
              placeholder="••••••••"
              autoComplete="current-password"
              disabled={isSubmitting}
              error={errors.password?.message}
              className="w-full"
            />
          </motion.div>
        </div>

        {/* Submit button */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.18, ease: SPRING }}
          className="mt-7"
        >
          <Button
            type="submit"
            size="lg"
            loading={isSubmitting}
            disabled={isSubmitting}
            className="w-full bg-ember hover:bg-ember-light active:bg-ember-dark text-paper font-sans font-semibold text-[15px] h-11 rounded-lg shadow-ember transition-colors"
          >
            {isSubmitting ? 'Signing in…' : 'Sign in'}
          </Button>
        </motion.div>
      </form>

      {/* Footer */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.4, delay: 0.28 }}
        className="mt-7 pt-6 border-t border-[var(--border)] text-center"
      >
        <p className="font-sans text-[13px] text-[var(--dim)]">
          Don&apos;t have an account?{' '}
          <Link
            href="/signup"
            className="text-[var(--ember)] font-medium hover:underline underline-offset-2 transition-colors"
          >
            Apply for access →
          </Link>
        </p>
      </motion.div>
    </div>
  )
}
