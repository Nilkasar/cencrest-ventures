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

// ─── Usage Bar ───────────────────────────────────────────────────────────────
function UsageBar({ label, resource }: { label: string; resource: UsageResource }) {
  const pct = usagePct(resource)
  const variant = pct >= 90 ? 'danger' : pct >= 80 ? 'default' : 'default'
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-sm font-sans">
        <span className="text-paper/80">{label}</span>
        <span className="text-paper font-medium font-mono text-xs">
          {resource.used.toLocaleString()} / {resource.limit.toLocaleString()}
        </span>
      </div>
      <div className="h-2 rounded-full bg-paper/20 overflow-hidden">
        <motion.div
          className={cn(
            'h-full rounded-full',
            pct >= 90 ? 'bg-danger' : pct >= 80 ? 'bg-warning' : 'bg-paper'
          )}
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1], delay: 0.15 }}
        />
      </div>
    </div>
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
        className="inline-flex items-center gap-1.5 text-xs text-dim hover:text-ember transition-colors font-sans"
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

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      {/* Header */}
      <motion.div {...fadeUp(0)} className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-semibold text-ink">Billing &amp; Plan</h1>
      </motion.div>

      {/* Usage alert banner */}
      {usageWarning && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={spring}
          className="flex items-start gap-3 px-4 py-3 rounded-lg bg-warning-muted border border-warning/30"
        >
          <AlertTriangle className="h-4 w-4 text-warning shrink-0 mt-0.5" />
          <p className="text-sm text-ink font-sans">
            You&apos;re approaching your plan limits. Upgrade to avoid service interruption.
          </p>
          <Button size="sm" className="ml-auto shrink-0">Upgrade</Button>
        </motion.div>
      )}

      {/* Current plan card */}
      <motion.div {...fadeUp(1)}>
        {isLoading ? (
          <div className="h-64 rounded-xl bg-surface border border-border animate-pulse" />
        ) : billing ? (
          <div
            className="relative rounded-xl p-6 overflow-hidden"
            style={{ background: 'linear-gradient(135deg, #C2410C 0%, #9a340a 60%, #7c2a08 100%)' }}
          >
            {/* Decorative orb */}
            <div className="absolute -right-12 -top-12 w-48 h-48 rounded-full bg-paper/5 blur-2xl pointer-events-none" />
            <div className="absolute right-6 bottom-6 w-32 h-32 rounded-full bg-paper/5 blur-xl pointer-events-none" />

            <div className="relative flex flex-col md:flex-row md:items-start gap-6">
              {/* Plan info */}
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <Badge variant="ember" size="sm" className="bg-paper/20 text-paper border-paper/30 border">
                    Current Plan
                  </Badge>
                  <Badge variant="ember" size="sm" className="bg-paper/20 text-paper border-paper/30 border capitalize">
                    {billing.plan.billing_period}
                  </Badge>
                </div>
                <h2 className="font-display text-3xl font-semibold text-paper mt-2">
                  {billing.plan.name}
                </h2>
                <p className="text-sm text-paper/70 mt-1 font-sans">
                  Renews on {fmtDate(billing.plan.renewal_date)}
                </p>

                {/* Usage bars */}
                <div className="mt-6 space-y-3 max-w-sm">
                  <UsageBar label="Brands" resource={billing.usage.brands} />
                  <UsageBar label="Runs this month" resource={billing.usage.runs} />
                  <UsageBar label="Keywords tracked" resource={billing.usage.keywords} />
                </div>
              </div>

              {/* Actions */}
              <div className="flex flex-col gap-2 shrink-0">
                {billing.plan.tier !== 'enterprise' && (
                  <Button className="bg-paper text-ember hover:bg-paper/90 border-0 font-semibold" size="md">
                    <ArrowUpRight className="h-4 w-4" />
                    Upgrade Plan
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="md"
                  className="border-paper/30 text-paper hover:bg-paper/10 hover:border-paper/50"
                >
                  Manage Subscription
                </Button>
              </div>
            </div>
          </div>
        ) : null}
      </motion.div>

      {/* Payment method */}
      <motion.div {...fadeUp(2)}>
        <Card>
          <CardHeader>
            <CardTitle>Payment Method</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="h-12 rounded-md bg-surface animate-pulse" />
            ) : billing?.payment_method ? (
              <div className="flex items-center gap-4">
                <div className="w-12 h-8 rounded bg-surface border border-border flex items-center justify-center">
                  <CreditCard className="h-4 w-4 text-dim" />
                </div>
                <div>
                  <p className="text-sm font-sans font-medium text-ink">
                    {billing.payment_method.brand}&ensp;
                    <span className="font-mono text-dim">•••• {billing.payment_method.last4}</span>
                  </p>
                  <p className="text-xs text-dim mt-0.5">
                    Expires {billing.payment_method.expiry}
                  </p>
                </div>
                <Button variant="outline" size="sm" className="ml-auto">
                  Update
                </Button>
              </div>
            ) : (
              <p className="text-sm text-dim">No payment method on file.</p>
            )}
          </CardContent>
        </Card>
      </motion.div>

      {/* Invoices */}
      <motion.div {...fadeUp(3)}>
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
      <motion.div {...fadeUp(4)}>
        <h2 className="font-display text-xl font-semibold text-ink mb-4">Plans</h2>
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
                  'relative flex flex-col rounded-xl border p-5 gap-4 bg-paper',
                  isCurrent ? 'border-ember shadow-md' : 'border-border'
                )}
              >
                {isCurrent && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <Badge variant="ember" size="sm">Current</Badge>
                  </div>
                )}

                {/* Plan header */}
                <div className="flex items-center gap-2">
                  <div className={cn(
                    'w-8 h-8 rounded-lg flex items-center justify-center',
                    isCurrent ? 'bg-ember text-paper' : 'bg-surface text-dim'
                  )}>
                    {plan.icon}
                  </div>
                  <span className="font-display font-semibold text-ink">{plan.name}</span>
                </div>

                {/* Price */}
                <div className="flex items-baseline gap-0.5">
                  <span className="font-display text-3xl font-semibold text-ink">{plan.price}</span>
                  {plan.period && <span className="text-sm text-dim font-sans">{plan.period}</span>}
                </div>

                {/* Features */}
                <ul className="space-y-2 flex-1">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-center gap-2 text-sm text-ink font-sans">
                      <CheckCircle className="h-3.5 w-3.5 text-success shrink-0" />
                      {f}
                    </li>
                  ))}
                </ul>

                {/* CTA */}
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
