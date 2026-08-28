import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

// ── Encryption helpers ────────────────────────────────────────────────────────

function getEncKey(): Buffer {
  const hex = process.env.ENCRYPTION_KEY ?? ''
  if (hex.length !== 64) throw new Error('ENCRYPTION_KEY must be a 64-char hex string (32 bytes)')
  return Buffer.from(hex, 'hex')
}

export function encryptKey(plaintext: string): string {
  const key = getEncKey()
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${iv.toString('hex')}:${encrypted.toString('hex')}:${tag.toString('hex')}`
}

export function decryptKey(encoded: string): string {
  const key = getEncKey()
  const parts = encoded.split(':')
  if (parts.length !== 3) throw new Error('Invalid encoded key format')
  const iv = Buffer.from(parts[0], 'hex')
  const encrypted = Buffer.from(parts[1], 'hex')
  const tag = Buffer.from(parts[2], 'hex')
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8')
}

// ── Interfaces ────────────────────────────────────────────────────────────────

export interface AIResponse {
  text: string
  model: string
  provider: string
  tokens_in: number
  tokens_out: number
  latency_ms: number
  finish_reason: string
}

export interface AIProvider {
  complete(prompt: string, options?: { systemPrompt?: string; temperature?: number }): Promise<AIResponse>
}

// ── Provider implementations ──────────────────────────────────────────────────

export class OllamaProvider implements AIProvider {
  constructor(private readonly model: string, private readonly _apiKey: string | null) {}

  async complete(prompt: string, options?: { systemPrompt?: string; temperature?: number }): Promise<AIResponse> {
    const start = Date.now()
    const fullPrompt = options?.systemPrompt ? `${options.systemPrompt}\n\n${prompt}` : prompt

    const res = await fetch('http://localhost:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        prompt: fullPrompt,
        stream: false,
        options: options?.temperature !== undefined ? { temperature: options.temperature } : undefined,
      }),
    })

    if (!res.ok) throw new Error(`Ollama error ${res.status}`)
    const data = await res.json() as {
      response: string
      eval_count?: number
      prompt_eval_count?: number
      done_reason?: string
    }

    return {
      text: data.response,
      model: this.model,
      provider: 'ollama',
      tokens_in: data.prompt_eval_count ?? 0,
      tokens_out: data.eval_count ?? 0,
      latency_ms: Date.now() - start,
      finish_reason: data.done_reason ?? 'stop',
    }
  }
}

export class OpenAIProvider implements AIProvider {
  constructor(private readonly model: string, private readonly apiKey: string) {}

  async complete(prompt: string, options?: { systemPrompt?: string; temperature?: number }): Promise<AIResponse> {
    const start = Date.now()
    const messages: Array<{ role: string; content: string }> = []
    if (options?.systemPrompt) messages.push({ role: 'system', content: options.systemPrompt })
    messages.push({ role: 'user', content: prompt })

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        temperature: options?.temperature ?? 0.7,
      }),
    })

    if (!res.ok) {
      const err = await res.text()
      throw Object.assign(new Error(`OpenAI error ${res.status}: ${err}`), { status: res.status })
    }

    const data = await res.json() as {
      choices: Array<{ message: { content: string }; finish_reason: string }>
      usage: { prompt_tokens: number; completion_tokens: number }
      model: string
    }

    return {
      text: data.choices[0].message.content,
      model: data.model ?? this.model,
      provider: 'openai',
      tokens_in: data.usage.prompt_tokens,
      tokens_out: data.usage.completion_tokens,
      latency_ms: Date.now() - start,
      finish_reason: data.choices[0].finish_reason,
    }
  }
}

export class AnthropicProvider implements AIProvider {
  constructor(private readonly model: string, private readonly apiKey: string) {}

  async complete(prompt: string, options?: { systemPrompt?: string; temperature?: number }): Promise<AIResponse> {
    const start = Date.now()
    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    }
    if (options?.systemPrompt) body.system = options.systemPrompt
    if (options?.temperature !== undefined) body.temperature = options.temperature

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const err = await res.text()
      throw Object.assign(new Error(`Anthropic error ${res.status}: ${err}`), { status: res.status })
    }

    const data = await res.json() as {
      content: Array<{ type: string; text: string }>
      usage: { input_tokens: number; output_tokens: number }
      model: string
      stop_reason: string
    }

    const textBlock = data.content.find((b) => b.type === 'text')

    return {
      text: textBlock?.text ?? '',
      model: data.model ?? this.model,
      provider: 'anthropic',
      tokens_in: data.usage.input_tokens,
      tokens_out: data.usage.output_tokens,
      latency_ms: Date.now() - start,
      finish_reason: data.stop_reason ?? 'stop',
    }
  }
}

export class GeminiProvider implements AIProvider {
  constructor(private readonly model: string, private readonly apiKey: string) {}

  async complete(prompt: string, options?: { systemPrompt?: string; temperature?: number }): Promise<AIResponse> {
    const start = Date.now()
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`

    const body: Record<string, unknown> = {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
    }
    if (options?.systemPrompt) {
      body.systemInstruction = { parts: [{ text: options.systemPrompt }] }
    }
    if (options?.temperature !== undefined) {
      body.generationConfig = { temperature: options.temperature }
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const err = await res.text()
      throw Object.assign(new Error(`Gemini error ${res.status}: ${err}`), { status: res.status })
    }

    const data = await res.json() as {
      candidates: Array<{
        content: { parts: Array<{ text: string }> }
        finishReason: string
      }>
      usageMetadata: { promptTokenCount: number; candidatesTokenCount: number }
      modelVersion?: string
    }

    const candidate = data.candidates[0]

    return {
      text: candidate.content.parts.map((p) => p.text).join(''),
      model: data.modelVersion ?? this.model,
      provider: 'gemini',
      tokens_in: data.usageMetadata.promptTokenCount,
      tokens_out: data.usageMetadata.candidatesTokenCount,
      latency_ms: Date.now() - start,
      finish_reason: candidate.finishReason ?? 'STOP',
    }
  }
}

export class PerplexityProvider implements AIProvider {
  constructor(private readonly model: string, private readonly apiKey: string) {}

  async complete(prompt: string, options?: { systemPrompt?: string; temperature?: number }): Promise<AIResponse> {
    const start = Date.now()
    const messages: Array<{ role: string; content: string }> = []
    if (options?.systemPrompt) messages.push({ role: 'system', content: options.systemPrompt })
    messages.push({ role: 'user', content: prompt })

    const res = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        temperature: options?.temperature ?? 0.7,
      }),
    })

    if (!res.ok) {
      const err = await res.text()
      throw Object.assign(new Error(`Perplexity error ${res.status}: ${err}`), { status: res.status })
    }

    const data = await res.json() as {
      choices: Array<{ message: { content: string }; finish_reason: string }>
      usage: { prompt_tokens: number; completion_tokens: number }
      model: string
    }

    return {
      text: data.choices[0].message.content,
      model: data.model ?? this.model,
      provider: 'perplexity',
      tokens_in: data.usage.prompt_tokens,
      tokens_out: data.usage.completion_tokens,
      latency_ms: Date.now() - start,
      finish_reason: data.choices[0].finish_reason,
    }
  }
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function buildProvider(name: string, model: string, apiKey: string | null): AIProvider {
  switch (name.toLowerCase()) {
    case 'ollama':
      return new OllamaProvider(model, apiKey)
    case 'openai':
      if (!apiKey) throw new Error('OpenAI requires an API key')
      return new OpenAIProvider(model, apiKey)
    case 'anthropic':
      if (!apiKey) throw new Error('Anthropic requires an API key')
      return new AnthropicProvider(model, apiKey)
    case 'gemini':
      if (!apiKey) throw new Error('Gemini requires an API key')
      return new GeminiProvider(model, apiKey)
    case 'perplexity':
      if (!apiKey) throw new Error('Perplexity requires an API key')
      return new PerplexityProvider(model, apiKey)
    default:
      throw new Error(`Unknown provider: ${name}`)
  }
}

// ── Fallback orchestration ────────────────────────────────────────────────────

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504])

export async function completeWithFallback(
  providers: Array<{ name: string; model: string; apiKeyEnc: string | null }>,
  prompt: string,
  options?: { systemPrompt?: string; temperature?: number },
): Promise<AIResponse> {
  if (providers.length === 0) throw new Error('No providers configured')

  let lastError: Error = new Error('All providers failed')

  for (const cfg of providers) {
    let apiKey: string | null = null
    if (cfg.apiKeyEnc) {
      try {
        apiKey = decryptKey(cfg.apiKeyEnc)
      } catch {
        lastError = new Error(`Failed to decrypt key for provider ${cfg.name}`)
        continue
      }
    }

    try {
      const provider = buildProvider(cfg.name, cfg.model, apiKey)
      return await provider.complete(prompt, options)
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
      const status = (err as { status?: number }).status
      if (status !== undefined && !RETRYABLE_STATUSES.has(status)) {
        throw lastError
      }
      // retryable — try next provider
    }
  }

  throw lastError
}
