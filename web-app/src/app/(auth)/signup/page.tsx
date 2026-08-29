'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { motion } from 'framer-motion'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { api } from '@/lib/api'

const schema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  email: z.string().email('Enter a valid email'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  orgName: z.string().min(2, 'Organisation name is required'),
})
type FormData = z.infer<typeof schema>

const words = 'Your brand deserves to be recommended.'.split(' ')

export default function SignupPage() {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({ resolver: zodResolver(schema) })

  async function onSubmit(data: FormData) {
    setError(null)
    try {
      await api.post('/api/auth/register', data)
      router.push('/onboarding')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Registration failed. Try again.')
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
          Join the brands building real recommendation intelligence.
        </motion.p>
      </div>

      {/* Right: form card */}
      <div className="bg-white/70 backdrop-blur-sm border border-[var(--border)] rounded-2xl p-8 shadow-sm w-full max-w-md mx-auto lg:mx-0">
        <h2 className="font-display font-semibold text-[var(--ink)] text-2xl mb-1">Create account</h2>
        <p className="text-[var(--dim)] text-sm mb-6">Fill in your details to get started.</p>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <Input
              {...register('name')}
              type="text"
              placeholder="Your name"
              autoComplete="name"
              disabled={isSubmitting}
              className="w-full"
            />
            {errors.name && (
              <p className="mt-1 text-xs text-[var(--danger)]">{errors.name.message}</p>
            )}
          </div>

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
              placeholder="Password (8+ characters)"
              autoComplete="new-password"
              disabled={isSubmitting}
              className="w-full"
            />
            {errors.password && (
              <p className="mt-1 text-xs text-[var(--danger)]">{errors.password.message}</p>
            )}
          </div>

          <div>
            <Input
              {...register('orgName')}
              type="text"
              placeholder="Organisation name"
              disabled={isSubmitting}
              className="w-full"
            />
            {errors.orgName && (
              <p className="mt-1 text-xs text-[var(--danger)]">{errors.orgName.message}</p>
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
                Creating account…
              </span>
            ) : (
              'Create account'
            )}
          </Button>
        </form>

        <p className="mt-4 text-sm text-center text-[var(--dim)]">
          Already have an account?{' '}
          <Link href="/login" className="text-[var(--ember)] hover:underline cursor-pointer">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  )
}
