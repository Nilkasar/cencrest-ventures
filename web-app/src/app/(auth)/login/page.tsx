'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { motion } from 'framer-motion'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { api } from '@/lib/api'
import { setToken, setStoredUser } from '@/lib/auth-storage'

const schema = z.object({
  email: z.string().email('Enter a valid email'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
})
type FormData = z.infer<typeof schema>

const headline = 'See why AI recommends your competitors.'
const words = headline.split(' ')

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
      const res = await api.post<{ accessToken: string; user: { id: string; email: string; name: string }; orgs?: Array<{ slug: string }> }>('/api/auth/login', data)
      setToken(res.accessToken)
      setStoredUser(res.user)
      // Fetch orgs to get slug for redirect
      const orgsRes = await fetch(`${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'}/api/orgs`, {
        headers: { Authorization: `Bearer ${res.accessToken}` },
      })
      if (orgsRes.ok) {
        const orgs = await orgsRes.json() as Array<{ slug: string }>
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
    <div className="max-w-5xl mx-auto w-full grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
      {/* Left: headline */}
      <div className="hidden lg:block">
        <h1 className="font-display font-semibold text-[var(--ink)] leading-tight" style={{ fontSize: 'clamp(2rem, 4vw, 3.25rem)' }}>
          {words.map((word, i) => (
            <motion.span
              key={i}
              className="inline-block mr-[0.25em]"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: i * 0.07, ease: [0.16, 1, 0.3, 1] }}
            >
              {word}
            </motion.span>
          ))}
        </h1>
        <motion.p
          className="mt-4 text-[var(--dim)] text-lg"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: words.length * 0.07 + 0.1, duration: 0.4 }}
        >
          Recommendation intelligence for B2B brands.
        </motion.p>
      </div>

      {/* Right: form card */}
      <div
        className="bg-white/70 backdrop-blur-sm border border-[var(--border)] rounded-2xl p-8 shadow-sm w-full max-w-md mx-auto lg:mx-0"
      >
        <h2 className="font-display font-semibold text-[var(--ink)] text-2xl mb-1">Sign in</h2>
        <p className="text-[var(--dim)] text-sm mb-6">Welcome back. Enter your credentials to continue.</p>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <Input
              {...register('email')}
              type="email"
              placeholder="you@company.com"
              autoComplete="email"
              disabled={isSubmitting}
              className="w-full"
            />
            {errors.email && (
              <p className="mt-1 text-xs text-[var(--danger)]">{errors.email.message}</p>
            )}
          </div>

          <div>
            <Input
              {...register('password')}
              type="password"
              placeholder="Password"
              autoComplete="current-password"
              disabled={isSubmitting}
              className="w-full"
            />
            {errors.password && (
              <p className="mt-1 text-xs text-[var(--danger)]">{errors.password.message}</p>
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
                Signing in…
              </span>
            ) : (
              'Sign in'
            )}
          </Button>
        </form>

        <div className="mt-4 flex flex-col gap-2 text-sm text-center">
          <Link
            href="/forgot-password"
            className="text-[var(--dim)] hover:text-[var(--ember)] transition-colors cursor-pointer"
          >
            Forgot password?
          </Link>
          <span className="text-[var(--dim)]">
            Don&apos;t have an account?{' '}
            <Link
              href="/signup"
              className="text-[var(--ember)] hover:underline cursor-pointer"
            >
              Apply
            </Link>
          </span>
        </div>
      </div>
    </div>
  )
}
