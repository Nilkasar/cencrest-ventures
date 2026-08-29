'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { motion } from 'framer-motion'
import { Building2, TriangleAlert } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'

const schema = z.object({
  name: z.string().min(2, 'Organization name must be at least 2 characters').max(100),
})
type FormData = z.infer<typeof schema>

const SPRING = [0.16, 1, 0.3, 1] as const

export default function CreateOrgPage() {
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
      const org = await api.post<{ id: string; name: string; slug: string }>('/api/orgs', data)
      router.push(`/${org.slug}/dashboard`)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to create organization.')
    }
  }

  return (
    <div className="w-full">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: SPRING }}
        className="mb-8"
      >
        <div className="w-11 h-11 rounded-xl bg-ember/10 flex items-center justify-center mb-5">
          <Building2 size={20} className="text-ember" />
        </div>
        <h1 className="font-display font-semibold text-[var(--ink)] text-[28px] leading-tight tracking-[-0.02em]">
          Create your organization
        </h1>
        <p className="font-sans text-sm text-[var(--dim)] mt-1.5">
          Set up your workspace to start measuring AI visibility.
        </p>
      </motion.div>

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
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.08, ease: SPRING }}
        >
          <label
            htmlFor="name"
            className="block font-sans text-[13px] font-medium text-[var(--ink)] mb-1.5"
          >
            Organization name
          </label>
          <Input
            id="name"
            {...register('name')}
            placeholder="Acme Inc."
            autoFocus
            disabled={isSubmitting}
            error={errors.name?.message}
            className="w-full"
          />
          <p className="font-sans text-[12px] text-[var(--dim)] mt-1.5">
            This will be your workspace name visible to all members.
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.14, ease: SPRING }}
          className="mt-7"
        >
          <Button
            type="submit"
            size="lg"
            loading={isSubmitting}
            disabled={isSubmitting}
            className="w-full bg-ember hover:bg-ember-light active:bg-ember-dark text-paper font-sans font-semibold text-[15px] h-11 rounded-lg shadow-ember transition-colors"
          >
            {isSubmitting ? 'Creating…' : 'Create organization'}
          </Button>
        </motion.div>
      </form>
    </div>
  )
}
