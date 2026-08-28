import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { secureHeaders } from 'hono/secure-headers'
import { requestLogger } from './middleware/logger.js'
import health from './routes/health.js'
import version from './routes/version.js'
import forms from './routes/forms.js'
import orgs from './routes/orgs.js'
import auth from './routes/auth.js'
import brands from './routes/brands.js'
import crawl from './routes/crawl.js'

const app = new Hono()

app.use('*', secureHeaders())
app.use('*', cors({
  origin: process.env.NODE_ENV === 'production'
    ? ['https://bebestwith.ai', 'https://www.bebestwith.ai']
    : '*',
  allowMethods: ['GET', 'POST', 'OPTIONS'],
}))
app.use('*', requestLogger)

app.route('/api/health', health)
app.route('/api/version', version)
app.route('/api/forms', forms)
app.route('/api/orgs', orgs)
app.route('/api/auth', auth)
app.route('/api/orgs/:slug/brands', brands)
app.route('/api/orgs/:slug/brands/:brandId/crawl', crawl)

app.notFound((c) => c.json({ error: 'Not found' }, 404))
app.onError((err, c) => {
  console.error(JSON.stringify({ error: err.message, stack: err.stack }))
  return c.json({ error: 'Internal server error' }, 500)
})

export default app
