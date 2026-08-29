'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import { ExternalLink, Save, Trash2, Globe, Palette, Mail, Link2, Building, Sparkles } from 'lucide-react'
import { api, routes } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { spring } from '@/design-system/motion'

// ─── Types ────────────────────────────────────────────────────────────────────

interface WhiteLabelConfig {
  company_name: string
  primary_color: string
  logo_url: string
  custom_domain: string
  support_email: string
}

interface WhiteLabelData {
  config: WhiteLabelConfig
  enabled: boolean
}

// ─── Toggle Switch ────────────────────────────────────────────────────────────

function ToggleSwitch({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label?: string
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-7 w-12 items-center rounded-full transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember focus-visible:ring-offset-2',
        checked ? 'bg-ember' : 'bg-border'
      )}
    >
      <motion.span
        layout
        transition={{ type: 'spring', stiffness: 500, damping: 35 }}
        className={cn(
          'inline-block h-5 w-5 rounded-full bg-paper shadow-sm',
          checked ? 'translate-x-6' : 'translate-x-1'
        )}
      />
    </button>
  )
}

// ─── Status Banner ────────────────────────────────────────────────────────────

function StatusBanner({ enabled }: { enabled: boolean }) {
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={enabled ? 'active' : 'disabled'}
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 8 }}
        transition={{ duration: 0.2 }}
        className={cn(
          'rounded-lg px-5 py-3 text-sm font-sans font-medium flex items-center gap-2',
          enabled
            ? 'bg-ember text-paper'
            : 'bg-surface text-dim border border-border'
        )}
      >
        <span
          className={cn(
            'inline-block w-2 h-2 rounded-full flex-shrink-0',
            enabled ? 'bg-paper animate-pulse' : 'bg-dim'
          )}
        />
        {enabled ? 'White label is ACTIVE' : 'White label is DISABLED'}
      </motion.div>
    </AnimatePresence>
  )
}

// ─── Config Form ──────────────────────────────────────────────────────────────

function ConfigForm({
  config,
  slug,
  onChange,
}: {
  config: WhiteLabelConfig
  slug: string
  onChange: (c: WhiteLabelConfig) => void
}) {
  const qc = useQueryClient()
  const [form, setForm] = useState<WhiteLabelConfig>(config)

  useEffect(() => { setForm(config) }, [config])

  const update = (key: keyof WhiteLabelConfig) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = { ...form, [key]: e.target.value }
    setForm(next)
    onChange(next)
  }

  const saveMutation = useMutation({
    mutationFn: () => api.put(`${routes.whiteLabel(slug)}`, form),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['white-label', slug] }),
  })

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`${routes.whiteLabel(slug)}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['white-label', slug] }),
  })

  return (
    <Card className="h-fit">
      <CardHeader>
        <CardTitle>Configuration</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Company Name */}
        <div className="flex items-center gap-2">
          <Building className="h-4 w-4 text-dim flex-shrink-0" />
          <div className="flex-1">
            <Input
              label="Company name"
              value={form.company_name}
              onChange={update('company_name')}
              placeholder="Acme Corp"
            />
          </div>
        </div>

        {/* Primary Color */}
        <div>
          <label className="text-sm font-medium text-ink font-sans block mb-1.5">Primary color</label>
          <div className="flex items-center gap-3">
            <div className="relative">
              <input
                type="color"
                value={form.primary_color || '#C2410C'}
                onChange={(e) => {
                  const next = { ...form, primary_color: e.target.value }
                  setForm(next)
                  onChange(next)
                }}
                className="w-10 h-10 rounded-lg border border-border cursor-pointer p-0.5 bg-paper"
                aria-label="Pick primary color"
              />
            </div>
            <div className="flex-1">
              <input
                type="text"
                value={form.primary_color}
                onChange={(e) => {
                  const next = { ...form, primary_color: e.target.value }
                  setForm(next)
                  onChange(next)
                }}
                placeholder="#C2410C"
                className={cn(
                  'h-10 w-full rounded-md border border-border bg-paper px-3 py-2 text-sm font-mono text-ink placeholder:text-dim',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember focus-visible:border-ember',
                )}
              />
            </div>
          </div>
        </div>

        {/* Logo URL */}
        <div className="flex items-start gap-2">
          <Palette className="h-4 w-4 text-dim flex-shrink-0 mt-6" />
          <div className="flex-1 space-y-2">
            <Input
              label="Logo URL"
              value={form.logo_url}
              onChange={update('logo_url')}
              placeholder="https://cdn.example.com/logo.svg"
            />
            <AnimatePresence>
              {form.logo_url && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden"
                >
                  <div className="h-14 rounded-lg border border-border bg-surface flex items-center justify-center px-4">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={form.logo_url}
                      alt="Logo preview"
                      className="max-h-10 max-w-full object-contain"
                      onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
                    />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Custom Domain */}
        <div className="flex items-center gap-2">
          <Globe className="h-4 w-4 text-dim flex-shrink-0" />
          <div className="flex-1">
            <Input
              label="Custom domain"
              value={form.custom_domain}
              onChange={update('custom_domain')}
              placeholder="app.yourcompany.com"
            />
          </div>
        </div>

        {/* Support Email */}
        <div className="flex items-center gap-2">
          <Mail className="h-4 w-4 text-dim flex-shrink-0" />
          <div className="flex-1">
            <Input
              label="Support email"
              type="email"
              value={form.support_email}
              onChange={update('support_email')}
              placeholder="support@yourcompany.com"
            />
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-3 pt-2">
          <Button
            className="flex-1"
            onClick={() => saveMutation.mutate()}
            loading={saveMutation.isPending}
          >
            <Save className="h-4 w-4" />
            Save Configuration
          </Button>
          <Button
            variant="danger"
            size="icon"
            onClick={() => deleteMutation.mutate()}
            loading={deleteMutation.isPending}
            aria-label="Delete configuration"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

// ─── Live Preview Panel ───────────────────────────────────────────────────────

function LivePreview({
  config,
  slug,
}: {
  config: WhiteLabelConfig
  slug: string
}) {
  const color = config.primary_color || '#C2410C'

  const previewMutation = useMutation({
    mutationFn: () => api.get<{ url: string }>(`${routes.whiteLabel(slug)}/preview`),
    onSuccess: (data) => {
      const d = data as { url?: string } | undefined
      if (d?.url) window.open(d.url, '_blank')
    },
  })

  return (
    <Card className="h-fit">
      <CardHeader>
        <CardTitle>Live Preview</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Browser Chrome Mockup */}
        <div className="rounded-xl border border-border overflow-hidden shadow-md">
          {/* Browser Bar */}
          <div className="bg-surface border-b border-border px-3 py-2.5 flex items-center gap-2">
            {/* Traffic lights */}
            <div className="flex gap-1.5">
              <span className="w-3 h-3 rounded-full bg-danger/60" />
              <span className="w-3 h-3 rounded-full bg-warning/60" />
              <span className="w-3 h-3 rounded-full bg-success/60" />
            </div>
            {/* URL bar */}
            <div className="flex-1 mx-2 bg-paper rounded-md px-3 py-1 flex items-center gap-1.5 border border-border">
              <Link2 className="h-3 w-3 text-dim flex-shrink-0" />
              <span className="text-xs text-dim font-mono truncate">
                {config.custom_domain || 'app.yourcompany.com'}
              </span>
            </div>
          </div>

          {/* Simulated Dashboard */}
          <div
            className="p-4 space-y-3"
            style={{ '--preview-color': color } as React.CSSProperties}
          >
            {/* Topbar simulation */}
            <div
              className="rounded-lg px-4 py-2.5 flex items-center gap-3"
              style={{ backgroundColor: color }}
            >
              {config.logo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={config.logo_url} alt="" className="h-5 object-contain" />
              ) : (
                <div className="text-paper font-display font-semibold text-sm">
                  {config.company_name || 'YourBrand'}
                </div>
              )}
              <div className="flex-1" />
              <div className="w-6 h-6 rounded-full bg-paper/20" />
            </div>

            {/* Stat row */}
            <div className="grid grid-cols-3 gap-2">
              {['Score', 'Brands', 'Runs'].map((label, i) => (
                <div key={label} className="bg-paper rounded-lg p-2.5 border border-border/50">
                  <div className="text-xs text-dim font-sans">{label}</div>
                  <div
                    className="font-display text-lg font-semibold mt-0.5"
                    style={{ color }}
                  >
                    {[74, 6, 23][i]}
                  </div>
                </div>
              ))}
            </div>

            {/* Graph bar simulation */}
            <div className="bg-paper rounded-lg p-3 border border-border/50 space-y-1.5">
              {[65, 80, 55, 90, 72].map((w, i) => (
                <div key={i} className="flex items-center gap-2">
                  <div className="w-16 h-1.5 bg-surface rounded-full overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${w}%` }}
                      transition={{ delay: i * 0.07, duration: 0.5, ease: 'easeOut' }}
                      className="h-full rounded-full"
                      style={{ backgroundColor: color }}
                    />
                  </div>
                  <span className="text-xs text-dim font-mono">{w}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <Button
          variant="outline"
          className="w-full"
          onClick={() => previewMutation.mutate()}
          loading={previewMutation.isPending}
        >
          <ExternalLink className="h-4 w-4" />
          Preview as Client
        </Button>
      </CardContent>
    </Card>
  )
}

// ─── Disabled State ───────────────────────────────────────────────────────────

function DisabledView({ onEnable }: { onEnable: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={spring}
      className="flex justify-center"
    >
      <div className="max-w-md w-full bg-surface border border-border rounded-2xl p-10 text-center shadow-sm">
        <div className="w-16 h-16 rounded-full bg-ember/10 flex items-center justify-center mx-auto mb-5">
          <Sparkles className="h-8 w-8 text-ember" />
        </div>
        <h2 className="font-display text-2xl font-semibold text-ink mb-3">
          White Label Your Platform
        </h2>
        <p className="text-sm text-dim font-sans leading-relaxed mb-2">
          Give your clients a fully branded experience with your own logo, colors, and domain.
        </p>
        <ul className="text-sm text-dim text-left space-y-2 mb-8 mt-4">
          {[
            'Custom domain & branding',
            'Your logo and color palette',
            'Branded client portal',
            'Custom support email',
          ].map((item) => (
            <li key={item} className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-ember flex-shrink-0" />
              {item}
            </li>
          ))}
        </ul>
        <Button className="w-full" onClick={onEnable}>
          Enable White Label
        </Button>
      </div>
    </motion.div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function WhiteLabelPage() {
  const { slug } = useParams<{ slug: string }>()
  const qc = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['white-label', slug],
    queryFn: () => api.get<WhiteLabelData>(routes.whiteLabel(slug)),
  })

  const wl = data as WhiteLabelData | undefined
  const enabled = wl?.enabled ?? false

  const [liveConfig, setLiveConfig] = useState<WhiteLabelConfig>({
    company_name: '',
    primary_color: '#C2410C',
    logo_url: '',
    custom_domain: '',
    support_email: '',
  })

  useEffect(() => {
    if (wl?.config) setLiveConfig(wl.config)
  }, [wl?.config])

  const toggleMutation = useMutation({
    mutationFn: () => api.patch(`${routes.whiteLabel(slug)}/toggle`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['white-label', slug] }),
  })

  if (isLoading) {
    return (
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="h-12 rounded-lg bg-surface border border-border animate-pulse" />
        <div className="h-96 rounded-xl bg-surface border border-border animate-pulse" />
      </div>
    )
  }

  return (
    <div className="max-w-7xl mx-auto">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
        className="flex items-center justify-between mb-6"
      >
        <div>
          <h1 className="font-display text-3xl font-semibold text-ink">White Label</h1>
          <p className="text-sm text-dim font-sans mt-1">Brand the platform as your own</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm font-sans text-dim">
            {enabled ? 'Enabled' : 'Disabled'}
          </span>
          <ToggleSwitch
            checked={enabled}
            onChange={() => toggleMutation.mutate()}
            label="Toggle white label"
          />
        </div>
      </motion.div>

      {/* Status Banner */}
      <div className="mb-8">
        <StatusBanner enabled={enabled} />
      </div>

      {/* Content */}
      <AnimatePresence mode="wait">
        {enabled ? (
          <motion.div
            key="enabled"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            className="grid grid-cols-1 lg:grid-cols-2 gap-6"
          >
            <ConfigForm
              config={liveConfig}
              slug={slug}
              onChange={setLiveConfig}
            />
            <LivePreview config={liveConfig} slug={slug} />
          </motion.div>
        ) : (
          <motion.div
            key="disabled"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
          >
            <DisabledView onEnable={() => toggleMutation.mutate()} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
