import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../lib/db.js'
import { rateLimit } from '../middleware/ratelimit.js'

const forms = new Hono()

const ALLOWED_FORM_IDS = ['apply', 'contact', 'snapshot'] as const
type FormId = (typeof ALLOWED_FORM_IDS)[number]

const submissionSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(255).optional(),
  company: z.string().max(255).optional(),
  website: z.string().url().optional().or(z.literal('')),
  message: z.string().max(5000).optional(),
  data: z.record(z.unknown()).optional(),
})

forms.post(
  '/:formId',
  rateLimit({ max: 5, windowMs: 60 * 60 * 1000 }),
  async (c) => {
    const formId = c.req.param('formId') as FormId

    if (!ALLOWED_FORM_IDS.includes(formId)) {
      return c.json({ error: 'Unknown form' }, 404)
    }

    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'Invalid JSON' }, 400)
    }

    const parsed = submissionSchema.safeParse(body)
    if (!parsed.success) {
      return c.json({ error: 'Validation failed', issues: parsed.error.issues }, 422)
    }

    const { email, name, company, website, message, data } = parsed.data

    const submission = await db.form_submissions.create({
      data: {
        form_id: formId,
        email,
        payload: {
          name,
          company,
          website: website || undefined,
          message,
          ...data,
        },
      },
    })

    return c.json({ success: true, id: submission.id }, 201)
  },
)

export default forms
