import { getToken } from './auth-storage'

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken()
  const authHeader = token ? { Authorization: `Bearer ${token}` } : {}

  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...authHeader,
      ...init?.headers,
    },
    credentials: 'include',
  })

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }))
    throw new ApiError(res.status, body.error ?? 'Request failed')
  }

  if (res.status === 204) return undefined as T
  return res.json()
}

export const api = {
  get: <T>(path: string, headers?: Record<string, string>) =>
    request<T>(path, { headers }),

  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined }),

  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', body: body ? JSON.stringify(body) : undefined }),

  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PUT', body: body ? JSON.stringify(body) : undefined }),

  delete: <T>(path: string) =>
    request<T>(path, { method: 'DELETE' }),
}

// Typed route builders
export const routes = {
  org: (slug: string) => `/api/orgs/${slug}`,
  brands: (slug: string) => `/api/orgs/${slug}/brands`,
  brand: (slug: string, brandId: string) => `/api/orgs/${slug}/brands/${brandId}`,
  runs: (slug: string, brandId: string) => `/api/orgs/${slug}/brands/${brandId}/runs`,
  keywords: (slug: string, brandId: string) => `/api/orgs/${slug}/brands/${brandId}/keywords`,
  journeys: (slug: string, brandId: string) => `/api/orgs/${slug}/brands/${brandId}/journeys`,
  geoGaps: (slug: string, brandId: string) => `/api/orgs/${slug}/brands/${brandId}/geo-gaps`,
  opportunities: (slug: string, brandId: string) => `/api/orgs/${slug}/brands/${brandId}/opportunities`,
  recommendations: (slug: string, brandId: string) => `/api/orgs/${slug}/brands/${brandId}/recommendations`,
  competitive: (slug: string, brandId: string) => `/api/orgs/${slug}/brands/${brandId}/competitive`,
  content: (slug: string, brandId: string) => `/api/orgs/${slug}/brands/${brandId}/content`,
  contentGen: (slug: string, brandId: string) => `/api/orgs/${slug}/brands/${brandId}/content-generation`,
  actions: (slug: string, brandId: string) => `/api/orgs/${slug}/brands/${brandId}/actions`,
  reports: (slug: string, brandId: string) => `/api/orgs/${slug}/brands/${brandId}/reports`,
  experiments: (slug: string, brandId: string) => `/api/orgs/${slug}/brands/${brandId}/experiments`,
  geoAgent: (slug: string, brandId: string) => `/api/orgs/${slug}/brands/${brandId}/geo-agent`,
  seoAgent: (slug: string, brandId: string) => `/api/orgs/${slug}/brands/${brandId}/seo-agent`,
  growthAgent: (slug: string, brandId: string) => `/api/orgs/${slug}/brands/${brandId}/growth-agent`,
  billing: (slug: string) => `/api/orgs/${slug}/billing`,
  integrations: (slug: string) => `/api/orgs/${slug}/integrations`,
  ai: (slug: string) => `/api/orgs/${slug}/ai`,
  marketing: (slug: string) => `/api/orgs/${slug}/marketing`,
  stories: (slug: string) => `/api/orgs/${slug}/stories`,
  whiteLabel: (slug: string) => `/api/orgs/${slug}/white-label`,
  agency: (slug: string) => `/api/orgs/${slug}/agency`,
}

export { ApiError }
