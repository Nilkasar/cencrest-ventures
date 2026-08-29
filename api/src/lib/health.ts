import { db } from './db.js'

export interface HealthStatus {
  status: 'ok' | 'degraded' | 'error'
  db: 'ok' | 'error'
  env: 'ok' | 'error'
  uptime: number
  timestamp: string
}

export interface Metrics {
  memory: NodeJS.MemoryUsage
  uptime: number
  node_version: string
  env: string
}

export async function deepHealthCheck(): Promise<HealthStatus> {
  let dbStatus: 'ok' | 'error' = 'ok'

  try {
    await db.$queryRaw`SELECT 1`
  } catch {
    dbStatus = 'error'
  }

  const requiredEnvVars = ['DATABASE_URL', 'NODE_ENV']
  const envStatus: 'ok' | 'error' = requiredEnvVars.every((v) => process.env[v])
    ? 'ok'
    : 'error'

  const status: 'ok' | 'degraded' | 'error' = dbStatus === 'error' ? 'degraded' : 'ok'

  return {
    status,
    db: dbStatus,
    env: envStatus,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  }
}

export async function getSystemMetrics(): Promise<Metrics> {
  return {
    memory: process.memoryUsage(),
    uptime: process.uptime(),
    node_version: process.version,
    env: process.env.NODE_ENV ?? 'unknown',
  }
}
