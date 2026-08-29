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
import keywords from './routes/keywords.js'
import journeys from './routes/journeys.js'
import integrations from './routes/integrations.js'
import billing from './routes/billing.js'
import ai from './routes/ai.js'
import runs from './routes/runs.js'
import crm from './routes/crm.js'
import analysis from './routes/analysis.js'
import notifications from './routes/notifications.js'
import competitive from './routes/competitive.js'
import snapshots from './routes/snapshots.js'
import opportunities from './routes/opportunities.js'
import geoGaps from './routes/geo-gaps.js'
import recommendations from './routes/recommendations.js'
import content from './routes/content.js'
import contentGeneration from './routes/content-generation.js'
import geoAgent from './routes/geo-agent.js'
import seoAgent from './routes/seo-agent.js'
import growthAgent from './routes/growth-agent.js'
import actions from './routes/actions.js'
import publishing from './routes/publishing.js'
import experiments from './routes/experiments.js'
import learning from './routes/learning.js'
import reports from './routes/reports.js'
import customerSuccess from './routes/customer-success.js'

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
app.route('/api/orgs/:slug/brands/:brandId/keywords', keywords)
app.route('/api/orgs/:slug/brands/:brandId/journeys', journeys)
app.route('/api/orgs/:slug/integrations', integrations)
app.route('/api/orgs/:slug/billing', billing)
app.route('/api/orgs/:slug/ai', ai)
app.route('/api/orgs/:slug/brands/:brandId/runs', runs)
app.route('/api/admin/crm', crm)
app.route('/api/orgs/:slug/brands/:brandId', analysis)
app.route('/api/notifications', notifications)
app.route('/api/orgs/:slug/brands/:brandId/competitive', competitive)
app.route('/api/snapshots', snapshots)
app.route('/api/orgs/:slug/brands/:brandId/opportunities', opportunities)
app.route('/api/orgs/:slug/brands/:brandId/geo-gaps', geoGaps)
app.route('/api/orgs/:slug/brands/:brandId/recommendations', recommendations)
app.route('/api/orgs/:slug/brands/:brandId/content', content)
app.route('/api/orgs/:slug/brands/:brandId/content-generation', contentGeneration)
app.route('/api/orgs/:slug/brands/:brandId/geo-agent', geoAgent)
app.route('/api/orgs/:slug/brands/:brandId/seo-agent', seoAgent)
app.route('/api/orgs/:slug/brands/:brandId/growth-agent', growthAgent)
app.route('/api/orgs/:slug/brands/:brandId/actions', actions)
app.route('/api/orgs/:slug/brands/:brandId/publishing', publishing)
app.route('/api/orgs/:slug/brands/:brandId/experiments', experiments)
app.route('/api/orgs/:slug/brands/:brandId/learning', learning)
app.route('/api/orgs/:slug/brands/:brandId/reports', reports)
app.route('/api/admin/customer-success', customerSuccess)

app.notFound((c) => c.json({ error: 'Not found' }, 404))
app.onError((err, c) => {
  console.error(JSON.stringify({ error: err.message, stack: err.stack }))
  return c.json({ error: 'Internal server error' }, 500)
})

export default app
