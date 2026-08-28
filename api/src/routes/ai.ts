import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import type { AppEnv } from '../types/context.js'
import { db } from '../lib/db.js'
import { requireAuth, requireOrgRole } from '../middleware/auth.js'
import { rateLimit } from '../middleware/ratelimit.js'
import { encryptKey, decryptKey, buildProvider } from '../lib/ai-provider.js'

const ai = new Hono<AppEnv>()

// ── GET /providers ─────────────────────────────────────────────────────────────
ai.get('/providers', requireAuth, requireOrgRole('member'), async (c) => {
  const { organizationId } = c.get('org')

  const rows = await db.org_ai_providers.findMany({
    where: { organization_id: organizationId },
    orderBy: [{ priority: 'asc' }, { created_at: 'asc' }],
  })

  const safe = rows.map(({ api_key_enc: _omit, ...rest }) => rest)
  return c.json(safe)
})

// ── POST /providers ────────────────────────────────────────────────────────────
ai.post(
  '/providers',
  requireAuth,
  requireOrgRole('admin'),
  zValidator(
    'json',
    z.object({
      provider_name: z.string().min(1).max(50),
      model: z.string().min(1).max(100),
      api_key: z.string().optional(),
      priority: z.number().int().min(1).optional(),
    }),
  ),
  async (c) => {
    const { organizationId } = c.get('org')
    const body = c.req.valid('json')

    const apiKeyEnc = body.api_key ? encryptKey(body.api_key) : null

    const record = await db.org_ai_providers.create({
      data: {
        organization_id: organizationId,
        provider_name: body.provider_name,
        model: body.model,
        api_key_enc: apiKeyEnc,
        priority: body.priority ?? 1,
      },
    })

    const { api_key_enc: _omit, ...safe } = record
    return c.json(safe, 201)
  },
)

// ── PATCH /providers/:providerId ───────────────────────────────────────────────
ai.patch(
  '/providers/:providerId',
  requireAuth,
  requireOrgRole('admin'),
  zValidator(
    'json',
    z.object({
      model: z.string().min(1).max(100).optional(),
      priority: z.number().int().min(1).optional(),
      is_active: z.boolean().optional(),
    }),
  ),
  async (c) => {
    const { organizationId } = c.get('org')
    const providerId = c.req.param('providerId')
    const body = c.req.valid('json')

    const existing = await db.org_ai_providers.findFirst({
      where: { id: providerId, organization_id: organizationId },
    })
    if (!existing) return c.json({ error: 'Provider not found' }, 404)

    const updated = await db.org_ai_providers.update({
      where: { id: providerId },
      data: { ...body, updated_at: new Date() },
    })

    const { api_key_enc: _omit, ...safe } = updated
    return c.json(safe)
  },
)

// ── DELETE /providers/:providerId ──────────────────────────────────────────────
ai.delete('/providers/:providerId', requireAuth, requireOrgRole('admin'), async (c) => {
  const { organizationId } = c.get('org')
  const providerId = c.req.param('providerId')

  const existing = await db.org_ai_providers.findFirst({
    where: { id: providerId, organization_id: organizationId },
  })
  if (!existing) return c.json({ error: 'Provider not found' }, 404)

  await db.org_ai_providers.delete({ where: { id: providerId } })
  return c.json({ success: true })
})

// ── GET /usage ─────────────────────────────────────────────────────────────────
ai.get('/usage', requireAuth, requireOrgRole('member'), async (c) => {
  const { organizationId } = c.get('org')
  const fromParam = c.req.query('from')
  const toParam = c.req.query('to')
  const providerParam = c.req.query('provider')

  const from = fromParam ? new Date(fromParam) : undefined
  const to = toParam ? new Date(toParam) : undefined

  const where: Record<string, unknown> = { organization_id: organizationId }
  if (from || to) {
    where.recorded_at = {
      ...(from ? { gte: from } : {}),
      ...(to ? { lte: to } : {}),
    }
  }
  if (providerParam) where.provider_name = providerParam

  const rows = await db.ai_usage.findMany({
    where: where as Parameters<typeof db.ai_usage.findMany>[0]['where'],
    orderBy: { recorded_at: 'asc' },
  })

  // Totals
  let totalTokensIn = 0
  let totalTokensOut = 0
  let totalRequests = 0

  // Daily breakdown: key = YYYY-MM-DD
  const dailyMap = new Map<string, { date: string; tokens_in: number; tokens_out: number; requests: number }>()

  for (const row of rows) {
    totalTokensIn += row.tokens_in
    totalTokensOut += row.tokens_out
    totalRequests++

    const day = row.recorded_at.toISOString().slice(0, 10)
    const existing = dailyMap.get(day) ?? { date: day, tokens_in: 0, tokens_out: 0, requests: 0 }
    existing.tokens_in += row.tokens_in
    existing.tokens_out += row.tokens_out
    existing.requests++
    dailyMap.set(day, existing)
  }

  return c.json({
    totals: { tokens_in: totalTokensIn, tokens_out: totalTokensOut, requests: totalRequests },
    daily: Array.from(dailyMap.values()),
  })
})

// ── POST /test ─────────────────────────────────────────────────────────────────
ai.post(
  '/test',
  requireAuth,
  requireOrgRole('member'),
  rateLimit({ max: 5, windowMs: 60_000 }),
  zValidator(
    'json',
    z.object({
      provider_name: z.string().min(1),
    }),
  ),
  async (c) => {
    const { organizationId } = c.get('org')
    const { provider_name } = c.req.valid('json')

    const providerConfig = await db.org_ai_providers.findFirst({
      where: { organization_id: organizationId, provider_name, is_active: true },
    })

    if (!providerConfig) {
      return c.json({ error: 'Provider not found or not active' }, 404)
    }

    let apiKey: string | null = null
    if (providerConfig.api_key_enc) {
      try {
        apiKey = decryptKey(providerConfig.api_key_enc)
      } catch {
        return c.json({ error: 'Failed to decrypt API key' }, 500)
      }
    }

    let provider
    try {
      provider = buildProvider(providerConfig.provider_name, providerConfig.model, apiKey)
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Invalid provider' }, 400)
    }

    const response = await provider.complete('Say hello in one sentence.')

    // Record usage
    await db.ai_usage.create({
      data: {
        organization_id: organizationId,
        provider_name: response.provider,
        model: response.model,
        tokens_in: response.tokens_in,
        tokens_out: response.tokens_out,
        latency_ms: response.latency_ms,
        finish_reason: response.finish_reason,
      },
    })

    return c.json(response)
  },
)

export default ai
