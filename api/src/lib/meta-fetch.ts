interface SiteMeta {
  name: string | null
  description: string | null
  logoUrl: string | null
}

export async function fetchSiteMeta(domain: string): Promise<SiteMeta> {
  const url = domain.startsWith('http') ? domain : `https://${domain}`

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 5000)

    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'BeBestBot/1.0 (+https://bebestwith.ai)' },
    })
    clearTimeout(timer)

    const html = await res.text()

    const name =
      html.match(/<meta[^>]+property="og:site_name"[^>]+content="([^"]+)"/i)?.[1] ??
      html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.split(/[|\-–]/)[0].trim() ??
      null

    const description =
      html.match(/<meta[^>]+property="og:description"[^>]+content="([^"]+)"/i)?.[1] ??
      html.match(/<meta[^>]+name="description"[^>]+content="([^"]+)"/i)?.[1] ??
      null

    const ogImage = html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i)?.[1] ?? null
    const favicon = ogImage ?? `https://www.google.com/s2/favicons?domain=${domain}&sz=128`

    return { name: name ?? null, description: description ?? null, logoUrl: favicon }
  } catch {
    return { name: null, description: null, logoUrl: null }
  }
}

export function isPrivateIp(host: string): boolean {
  return /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|127\.|0\.|localhost|metadata\.)/i.test(host)
}

export function validateDomain(raw: string): string | null {
  try {
    const url = raw.startsWith('http') ? new URL(raw) : new URL(`https://${raw}`)
    if (isPrivateIp(url.hostname)) return null
    return url.hostname
  } catch {
    return null
  }
}
