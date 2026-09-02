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
import { SPRING_CURVE } from '@/lib/motion'

const schema = z.object({
  name: z.string().min(2, 'Organization name must be at least 2 characters').max(100),
})
type FormData = z.infer<typeof schema>


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
        transition={{ duration: 0.4, ease: SPRING_CURVE }}
        className="mb-8"
      >
        <div className="w-11 h-11 rounded-xl bg-ember/10 flex items-center justify-center mb-5">
          <Building2 size={20} className="text-ember" />
        </div>
        <h1 className="font-display font-semibold text-ink text-[32px] leading-tight tracking-tight">
          Create your organization
        </h1>
        <p className="font-sans text-[15px] text-dim mt-2.5">
          Set up your workspace to start measuring AI visibility.
        </p>
      </motion.div>

      {error && (
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-5 flex items-start gap-2.5 rounded-lg border-l-[3px] border-danger bg-danger/[0.06] px-4 py-3.5"
        >
          <TriangleAlert size={14} className="text-danger shrink-0 mt-0.5" />
          <span className="font-sans text-[13px] text-danger leading-snug">{error}</span>
        </motion.div>
      )}

      <form onSubmit={handleSubmit(onSubmit)} noValidate>
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.08, ease: SPRING_CURVE }}
        >
          <Input
            label="Organization name"
            id="name"
            {...register('name')}
            placeholder="Acme Inc."
            autoFocus
            disabled={isSubmitting}
            error={errors.name?.message}
            hint="This is what appears in your workspace URL and reports"
            className="w-full"
          />
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.14, ease: SPRING_CURVE }}
          className="mt-8"
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
