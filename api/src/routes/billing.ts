import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import type { AppEnv } from '../types/context.js'
import { db } from '../lib/db.js'
import { requireAuth, requireOrgRole } from '../middleware/auth.js'
import { getPlanLimits, checkLimit } from '../lib/plans.js'
import type { UsageMetric } from '../lib/plans.js'

const billing = new Hono<AppEnv>()

const checkoutSchema = z.object({
  plan: z.enum(['starter', 'growth', 'agency']),
  success_url: z.string().url(),
  cancel_url: z.string().url(),
})

// POST /checkout
billing.post('/checkout', requireAuth, requireOrgRole('admin'), zValidator('json', checkoutSchema), async (c) => {
  const { organizationId } = c.get('org')
  const body = c.req.valid('json')
  const stripeKey = process.env.STRIPE_SECRET_KEY

  if (!stripeKey) {
    return c.json({ checkoutUrl: null, message: 'Stripe not configured' }, 200)
  }

  const { default: Stripe } = await import('stripe')
  const stripe = new Stripe(stripeKey)

  const PRICE_IDS: Record<string, string> = {
    starter: process.env.STRIPE_PRICE_STARTER ?? '',
    growth: process.env.STRIPE_PRICE_GROWTH ?? '',
    agency: process.env.STRIPE_PRICE_AGENCY ?? '',
  }

  const priceId = PRICE_IDS[body.plan]

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    line_items: priceId ? [{ price: priceId, quantity: 1 }] : [],
    success_url: body.success_url,
    cancel_url: body.cancel_url,
    metadata: { organization_id: organizationId, plan: body.plan },
  })

  return c.json({ checkoutUrl: session.url })
})

// GET /portal
billing.get('/portal', requireAuth, requireOrgRole('admin'), async (c) => {
  const { organizationId } = c.get('org')
  const stripeKey = process.env.STRIPE_SECRET_KEY

  if (!stripeKey) {
    return c.json({ portalUrl: null })
  }

  const subscription = await db.subscriptions.findUnique({
    where: { organization_id: organizationId },
  })

  if (!subscription?.stripe_customer_id) {
    return c.json({ portalUrl: null })
  }

  const { default: Stripe } = await import('stripe')
  const stripe = new Stripe(stripeKey)

  const session = await stripe.billingPortal.sessions.create({
    customer: subscription.stripe_customer_id,
  })

  return c.json({ portalUrl: session.url })
})

// GET /subscription
billing.get('/subscription', requireAuth, requireOrgRole('viewer'), async (c) => {
  const { organizationId } = c.get('org')

  const subscription = await db.subscriptions.findUnique({
    where: { organization_id: organizationId },
  })

  if (!subscription) {
    return c.json({ plan: 'free', status: 'active' })
  }

  return c.json(subscription)
})

// GET /usage
billing.get('/usage', requireAuth, requireOrgRole('viewer'), async (c) => {
  const { organizationId } = c.get('org')

  const metrics: UsageMetric[] = ['prompt_runs', 'ai_tokens', 'crawl_pages', 'users', 'brands']
  const results: Record<string, { used: number; limit: number }> = {}

  await Promise.all(
    metrics.map(async (metric) => {
      const { used, limit } = await checkLimit(organizationId, metric)
      results[metric] = { used, limit }
    }),
  )

  return c.json(results)
})

// POST /webhooks — no auth required
billing.post('/webhooks', async (c) => {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET
  const stripeKey = process.env.STRIPE_SECRET_KEY

  if (!webhookSecret || !stripeKey) {
    return c.json({ received: true }, 200)
  }

  const { default: Stripe } = await import('stripe')
  const stripe = new Stripe(stripeKey)

  const sig = c.req.header('stripe-signature') ?? ''
  const rawBody = await c.req.text()

  let event: import('stripe').Stripe.Event

  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret)
  } catch {
    return c.json({ error: 'Webhook signature verification failed' }, 400)
  }

  if (
    event.type === 'customer.subscription.created' ||
    event.type === 'customer.subscription.updated'
  ) {
    const sub = event.data.object as import('stripe').Stripe.Subscription
    const orgId = sub.metadata?.organization_id
    if (orgId) {
      const plan = (sub.metadata?.plan as string) ?? 'free'
      await db.subscriptions.upsert({
        where: { organization_id: orgId },
        create: {
          organization_id: orgId,
          stripe_customer_id: typeof sub.customer === 'string' ? sub.customer : null,
          stripe_subscription_id: sub.id,
          plan,
          status: sub.status as never,
          current_period_start: new Date((sub as never as { current_period_start: number }).current_period_start * 1000),
          current_period_end: new Date((sub as never as { current_period_end: number }).current_period_end * 1000),
        },
        update: {
          stripe_subscription_id: sub.id,
          plan,
          status: sub.status as never,
          current_period_start: new Date((sub as never as { current_period_start: number }).current_period_start * 1000),
          current_period_end: new Date((sub as never as { current_period_end: number }).current_period_end * 1000),
          updated_at: new Date(),
        },
      })
    }
  } else if (event.type === 'invoice.payment_failed') {
    const invoice = event.data.object as import('stripe').Stripe.Invoice
    const customerId = typeof invoice.customer === 'string' ? invoice.customer : null
    if (customerId) {
      await db.subscriptions.updateMany({
        where: { stripe_customer_id: customerId },
        data: { status: 'past_due', updated_at: new Date() },
      })
    }
  }

  return c.json({ received: true }, 200)
})

export default billing
