'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { motion } from 'framer-motion'
import { TriangleAlert, ArrowRight } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'
import { setToken, setStoredUser } from '@/lib/auth-storage'
import { SPRING_CURVE } from '@/lib/motion'

const schema = z.object({
  email: z.string().email('Enter a valid email'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
})
type FormData = z.infer<typeof schema>


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
        transition={{ duration: 0.4, ease: SPRING_CURVE }}
        className="mb-8"
      >
        <h1 className="font-display font-semibold text-ink text-2xl leading-[1.15] tracking-tight">
          Welcome back
        </h1>
        <p className="font-sans text-sm text-dim mt-2 leading-relaxed">
          Sign in to your BeBest account to continue.
        </p>
        <div className="flex items-center gap-2 mt-4 text-xs text-dim font-medium font-sans">
          <span className="w-1.5 h-1.5 rounded-full bg-success flex-shrink-0" />
          SOC 2 · SSO Ready · Zero data retention
        </div>
      </motion.div>

      {/* Global error */}
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

      <form onSubmit={handleSubmit(onSubmit)} noValidate>
        <div className="flex flex-col gap-5">

          {/* Email field */}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, delay: 0.05, ease: SPRING_CURVE }}
          >
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
            />
          </motion.div>

          {/* Password field */}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, delay: 0.1, ease: SPRING_CURVE }}
          >
            <div className="flex items-center justify-between mb-2">
              <label className="text-[13px] font-semibold text-ink font-sans leading-none">
                Password
              </label>
              <Link
                href="/forgot-password"
                className="font-sans text-[13px] text-dim hover:text-ember transition-colors"
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
            />
          </motion.div>
        </div>

        {/* Submit */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.16, ease: SPRING_CURVE }}
          className="mt-8"
        >
          <Button
            type="submit"
            size="lg"
            loading={isSubmitting}
            disabled={isSubmitting}
            className="w-full h-11 rounded-lg font-sans font-semibold text-[15px] bg-ember hover:bg-ember-light active:bg-ember-dark text-paper shadow-ember transition-colors gap-2"
          >
            {isSubmitting ? 'Signing in…' : (
              <>
                Sign in
                <ArrowRight size={16} />
              </>
            )}
          </Button>
        </motion.div>

        {/* OAuth divider */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.35, delay: 0.2, ease: SPRING_CURVE }}
          className="flex items-center gap-3 my-6"
        >
          <div className="flex-1 h-px bg-border" />
          <span className="text-xs text-dim font-medium font-sans">or continue with</span>
          <div className="flex-1 h-px bg-border" />
        </motion.div>

        {/* Google OAuth */}
        <motion.div
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.24, ease: SPRING_CURVE }}
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
      </form>

      {/* Footer divider + signup link */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.4, delay: 0.3 }}
        className="mt-8 pt-6 border-t border-border text-center"
      >
        <p className="font-sans text-[13px] text-dim">
          Don&apos;t have an account?{' '}
          <Link
            href="/signup"
            className="text-ember font-medium hover:underline underline-offset-2 transition-colors"
          >
            Apply for access →
          </Link>
        </p>
      </motion.div>
    </div>
  )
}
