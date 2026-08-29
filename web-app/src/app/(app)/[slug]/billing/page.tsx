'use client'

import * as React from 'react'
import { useParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import {
  CreditCard,
  Download,
  AlertTriangle,
  CheckCircle,
  CheckCircle2,
  XCircle,
  Clock,
  ArrowUpRight,
  Zap,
  Building2,
  Rocket,
} from 'lucide-react'
import { api, routes } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { DataTable, type Column } from '@/components/ui/data-table'
import { spring } from '@/design-system/motion'

// ─── Types ───────────────────────────────────────────────────────────────────
interface UsageResource { used: number; limit: number }

interface BillingData {
  plan: {
    name: string
    tier: 'starter' | 'growth' | 'enterprise'
    billing_period: 'monthly' | 'annual'
    renewal_date: string
  }
  usage: {
    brands: UsageResource
    runs: UsageResource
    keywords: UsageResource
  }
  payment_method: {
    last4: string
    brand: string
    expiry: string
  }
  invoices: Array<{
    id: string
    date: string
    amount: number
    status: 'paid' | 'pending' | 'failed'
    pdf_url: string
  }>
}

// ─── Plan config ─────────────────────────────────────────────────────────────
const PLANS = [
  {
    key: 'starter',
    name: 'Starter',
    price: '$299',
    period: '/mo',
    icon: <Rocket className="h-5 w-5" />,
    features: [
      '3 brands',
      '50 runs / month',
      '500 keywords',
      'Weekly reports',
      'Email support',
    ],
    cta: 'Upgrade to Starter',
    ctaVariant: 'outline' as const,
  },
  {
    key: 'growth',
    name: 'Growth',
    price: '$799',
    period: '/mo',
    icon: <Zap className="h-5 w-5" />,
    features: [
      '10 brands',
      '200 runs / month',
      '2,000 keywords',
      'Daily reports',
      'Priority support',
      'API access',
    ],
    cta: 'Upgrade to Growth',
    ctaVariant: 'default' as const,
  },
  {
    key: 'enterprise',
    name: 'Enterprise',
    price: 'Custom',
    period: '',
    icon: <Building2 className="h-5 w-5" />,
    features: [
      'Unlimited brands',
      'Unlimited runs',
      'Unlimited keywords',
      'Real-time reports',
      'Dedicated CSM',
      'White-label',
      'SLA guarantee',
    ],
    cta: 'Contact Sales',
    ctaVariant: 'outline' as const,
  },
]

const PLAN_FEATURES: Record<string, string[]> = {
  starter: ['3 brands', '50 runs / month', '500 keywords', 'Weekly reports', 'Email support'],
  growth: ['10 brands', '200 runs / month', '2,000 keywords', 'Daily reports', 'Priority support', 'API access'],
  enterprise: ['Unlimited brands', 'Unlimited runs', 'Unlimited keywords', 'Real-time reports', 'Dedicated CSM', 'White-label', 'SLA guarantee'],
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function usagePct(r: UsageResource) {
  return r.limit === 0 ? 0 : Math.round((r.used / r.limit) * 100)
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmtAmount(cents: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100)
}

function StatusBadge({ status }: { status: 'paid' | 'pending' | 'failed' }) {
  const map = {
    paid:    { variant: 'success' as const, icon: <CheckCircle className="h-3 w-3" /> },
    pending: { variant: 'warning' as const, icon: <Clock className="h-3 w-3" /> },
    failed:  { variant: 'danger'  as const, icon: <XCircle className="h-3 w-3" /> },
  }
  const { variant, icon } = map[status]
  return (
    <Badge variant={variant} size="sm" className="gap-1">
      {icon}
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </Badge>
  )
}

// ─── Invoice columns ─────────────────────────────────────────────────────────
type InvoiceRow = BillingData['invoices'][number]

const invoiceColumns: Column<InvoiceRow>[] = [
  {
    key: 'date',
    header: 'Date',
    render: (v) => fmtDate(v as string),
  },
  {
    key: 'amount',
    header: 'Amount',
    render: (v) => (
      <span className="font-mono text-sm">{fmtAmount(v as number)}</span>
    ),
  },
  {
    key: 'status',
    header: 'Status',
    render: (v) => <StatusBadge status={v as 'paid' | 'pending' | 'failed'} />,
  },
  {
    key: 'pdf_url',
    header: '',
    className: 'text-right',
    render: (v) => (
      <a
        href={v as string}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1.5 text-xs text-[var(--dim)] hover:text-[var(--ember)] transition-colors font-sans"
        onClick={(e) => e.stopPropagation()}
      >
        <Download className="h-3.5 w-3.5" />
        PDF
      </a>
    ),
  },
]

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function BillingPage() {
  const { slug } = useParams<{ slug: string }>()

  const { data, isLoading } = useQuery({
    queryKey: ['billing', slug],
    queryFn: () => api.get<BillingData>(routes.billing(slug)),
  })

  const billing = data as BillingData | undefined

  const usageWarning = billing
    ? Object.values(billing.usage).some((r) => usagePct(r) >= 80)
    : false

  const fadeUp = (i: number) => ({
    initial: { opacity: 0, y: 16 },
    animate: { opacity: 1, y: 0 },
    transition: { ...spring, delay: i * 0.07 },
  })

  const invoiceData: InvoiceRow[] = billing?.invoices ?? []
  const currentFeatures = billing?.plan.tier ? (PLAN_FEATURES[billing.plan.tier] ?? []) : []

  return (
    <div className="max-w-4xl mx-auto space-y-8 pb-12">
      {/* Header */}
      <motion.div {...fadeUp(0)} className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-semibold text-[var(--ink)]">Billing &amp; Plan</h1>
      </motion.div>

      {/* Usage alert banner */}
      {usageWarning && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={spring}
          className="flex items-start gap-3 px-4 py-3 rounded-lg bg-[var(--warning)]/10 border border-[var(--warning)]/30"
        >
          <AlertTriangle className="h-4 w-4 text-[var(--warning)] shrink-0 mt-0.5" />
          <p className="text-sm text-[var(--ink)] font-sans">
            You&apos;re approaching your plan limits. Upgrade to avoid service interruption.
          </p>
          <Button size="sm" className="ml-auto shrink-0">Upgrade</Button>
        </motion.div>
      )}

      {/* Current plan card */}
      <motion.div {...fadeUp(1)}>
        {isLoading ? (
          <div className="h-48 rounded-2xl bg-[var(--surface)] border border-[var(--border)] animate-pulse" />
        ) : billing ? (
          <div className="rounded-2xl border border-[var(--border)] bg-white/70 p-8 mb-6 flex flex-col md:flex-row gap-8">
            {/* Left */}
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-display text-2xl font-semibold text-[var(--ink)]">{billing.plan.name}</span>
                <Badge variant="ember" size="sm" className="capitalize">{billing.plan.tier}</Badge>
              </div>
              <p className="text-xs text-[var(--dim)] font-sans mb-4">
                Renews on {fmtDate(billing.plan.renewal_date)} · {billing.plan.billing_period}
              </p>
              <ul className="space-y-2 mt-4">
                {currentFeatures.map((f) => (
                  <li key={f} className="flex items-center gap-2 text-sm text-[var(--ink)] font-sans">
                    <CheckCircle2 className="h-4 w-4 shrink-0" style={{ color: 'var(--success)' }} />
                    {f}
                  </li>
                ))}
              </ul>
            </div>
            {/* Right */}
            <div className="ml-auto shrink-0 flex items-start">
              {billing.plan.tier !== 'enterprise' && (
                <Button>
                  <ArrowUpRight className="h-4 w-4" />
                  Upgrade Plan
                </Button>
              )}
            </div>
          </div>
        ) : null}
      </motion.div>

      {/* Usage section */}
      <motion.div {...fadeUp(2)}>
        <h2 className="font-display text-xl font-semibold text-[var(--ink)] mb-4">Usage this month</h2>
        {isLoading ? (
          <div className="space-y-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-10 rounded-md bg-[var(--surface)] animate-pulse" />
            ))}
          </div>
        ) : billing ? (
          <div className="space-y-5">
            {[
              { label: 'Brands', resource: billing.usage.brands },
              { label: 'Runs', resource: billing.usage.runs },
              { label: 'Keywords', resource: billing.usage.keywords },
            ].map(({ label, resource }) => {
              const pct = usagePct(resource)
              const variant: 'danger' | 'warning' | 'default' =
                pct > 90 ? 'danger' : pct > 70 ? 'warning' : 'default'
              return (
                <div key={label}>
                  <div className="flex justify-between text-sm mb-1.5">
                    <span className="text-[var(--ink)] font-sans">{label}</span>
                    <span className="text-[var(--dim)] font-sans font-mono text-xs">
                      {resource.used.toLocaleString()} of {resource.limit.toLocaleString()}
                    </span>
                  </div>
                  <Progress value={pct} variant={variant} />
                </div>
              )
            })}
          </div>
        ) : null}
      </motion.div>

      {/* Payment method */}
      <motion.div {...fadeUp(3)}>
        <Card>
          <CardHeader>
            <CardTitle>Payment Method</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="h-12 rounded-md bg-[var(--surface)] animate-pulse" />
            ) : billing?.payment_method ? (
              <div className="flex items-center gap-4">
                <div className="w-12 h-8 rounded bg-[var(--surface)] border border-[var(--border)] flex items-center justify-center">
                  <CreditCard className="h-4 w-4 text-[var(--dim)]" />
                </div>
                <div>
                  <p className="text-sm font-sans font-medium text-[var(--ink)]">
                    {billing.payment_method.brand}&ensp;
                    <span className="font-mono text-[var(--dim)]">•••• {billing.payment_method.last4}</span>
                  </p>
                  <p className="text-xs text-[var(--dim)] mt-0.5">
                    Expires {billing.payment_method.expiry}
                  </p>
                </div>
                <Button variant="outline" size="sm" className="ml-auto">
                  Update
                </Button>
              </div>
            ) : (
              <p className="text-sm text-[var(--dim)]">No payment method on file.</p>
            )}
          </CardContent>
        </Card>
      </motion.div>

      {/* Invoices */}
      <motion.div {...fadeUp(4)}>
        <Card>
          <CardHeader>
            <CardTitle>Invoices</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <DataTable
              data={invoiceData as unknown as Record<string, unknown>[]}
              columns={invoiceColumns as unknown as Column<Record<string, unknown>>[]}
              loading={isLoading}
              emptyMessage="No invoices yet."
              rowKey={(row) => String(row.id)}
              pageSize={8}
            />
          </CardContent>
        </Card>
      </motion.div>

      {/* Plan comparison */}
      <motion.div {...fadeUp(5)}>
        <h2 className="font-display text-xl font-semibold text-[var(--ink)] mb-4">Plans</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {PLANS.map((plan, i) => {
            const isCurrent = billing?.plan.tier === plan.key
            return (
              <motion.div
                key={plan.key}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ ...spring, delay: 0.28 + i * 0.08 }}
                className={cn(
                  'relative flex flex-col rounded-xl border p-5 gap-4 bg-[var(--paper)]',
                  isCurrent ? 'border-[var(--ember)] shadow-md' : 'border-[var(--border)]'
                )}
              >
                {isCurrent && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <Badge variant="ember" size="sm">Current</Badge>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <div className={cn(
                    'w-8 h-8 rounded-lg flex items-center justify-center',
                    isCurrent ? 'bg-[var(--ember)] text-[var(--paper)]' : 'bg-[var(--surface)] text-[var(--dim)]'
                  )}>
                    {plan.icon}
                  </div>
                  <span className="font-display font-semibold text-[var(--ink)]">{plan.name}</span>
                </div>
                <div className="flex items-baseline gap-0.5">
                  <span className="font-display text-3xl font-semibold text-[var(--ink)]">{plan.price}</span>
                  {plan.period && <span className="text-sm text-[var(--dim)] font-sans">{plan.period}</span>}
                </div>
                <ul className="space-y-2 flex-1">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-center gap-2 text-sm text-[var(--ink)] font-sans">
                      <CheckCircle className="h-3.5 w-3.5 text-[var(--success)] shrink-0" />
                      {f}
                    </li>
                  ))}
                </ul>
                <Button
                  variant={isCurrent ? 'ghost' : plan.ctaVariant}
                  size="md"
                  className="w-full"
                  disabled={isCurrent}
                >
                  {isCurrent ? 'Current plan' : plan.cta}
                </Button>
              </motion.div>
            )
          })}
        </div>
      </motion.div>
    </div>
  )
}
