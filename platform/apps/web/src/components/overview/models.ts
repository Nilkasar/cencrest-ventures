/**
 * Display identity for the four AI assistants the GEO engine queries —
 * the same names, glyphs and tints the snapshot hero's signal field uses
 * (`components/brand-hero/signal-field.tsx`), so a model is recognisably
 * "the same node" across the funnel and the portal. Tints are brand
 * identity, used only on marks (rings, dots, comets) — never on text, which
 * always wears the theme's text tokens. Every mark is also direct-labelled
 * with the model's name, so identity never rests on colour alone.
 *
 * Keyed by the provider slug the API returns (`AiRun.providers`); an
 * unrecognised provider still renders, title-cased with a neutral tint.
 */
export interface ModelMeta {
  name: string;
  vendor: string;
  glyph: string;
  tint: string;
}

const MODELS: Record<string, ModelMeta> = {
  openai: { name: "ChatGPT", vendor: "OpenAI", glyph: "G", tint: "#10a37f" },
  anthropic: { name: "Claude", vendor: "Anthropic", glyph: "C", tint: "#d97757" },
  google: { name: "Gemini", vendor: "Google", glyph: "G", tint: "#4f8df5" },
  perplexity: { name: "Perplexity", vendor: "Perplexity AI", glyph: "P", tint: "#3fb6c6" },
};

export const DEFAULT_PROVIDERS = ["openai", "anthropic", "google", "perplexity"];

export function modelMeta(provider: string): ModelMeta {
  const known = MODELS[provider];
  if (known) return known;
  const name = provider.charAt(0).toUpperCase() + provider.slice(1);
  return { name, vendor: name, glyph: name.charAt(0), tint: "#8a7d63" };
}
