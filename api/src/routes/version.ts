import { Hono } from 'hono'

const version = new Hono()

version.get('/', (c) => {
  return c.json({
    version: process.env.npm_package_version ?? '0.1.0',
    gitSha: process.env.GIT_SHA ?? 'local',
    deployedAt: process.env.DEPLOYED_AT ?? new Date().toISOString(),
    nodeVersion: process.version,
  })
})

export default version
