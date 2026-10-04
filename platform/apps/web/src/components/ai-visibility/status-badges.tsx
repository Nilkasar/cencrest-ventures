import { Badge, type BadgeProps } from "@bebest/ui";
import type { AiRunStatus, BrandSentiment, ExtractionStatus } from "@/data/ai-visibility/types";
import { EXTRACTION_STATUS_LABEL, RUN_STATUS_LABEL, SENTIMENT_LABEL } from "@/data/ai-visibility/labels";

/**
 * The AI Visibility domain's status → tone map, in one place (README §6).
 * Tones by meaning: a running run is "info" (in motion, nobody needs to
 * act), never accent. Sentiment is an outcome, so it borrows the outcome
 * tones; each badge carries its label, so tone is never the only signal.
 */
type Variant = NonNullable<BadgeProps["variant"]>;

const RUN_TONE: Record<AiRunStatus, Variant> = {
  queued: "neutral",
  running: "info",
  completed: "success",
  failed: "danger",
};

const EXTRACTION_TONE: Record<ExtractionStatus, Variant> = {
  pending: "info",
  completed: "success",
  failed: "danger",
};

export const SENTIMENT_TONE: Record<BrandSentiment, Variant> = {
  positive: "success",
  neutral: "neutral",
  mixed: "warning",
  negative: "danger",
};

type Size = "sm" | "md";

export function RunStatusBadge({ status, size = "sm" }: { status: AiRunStatus; size?: Size }) {
  return (
    <Badge variant={RUN_TONE[status]} size={size} dot>
      {RUN_STATUS_LABEL[status]}
    </Badge>
  );
}

export function ExtractionBadge({ status, size = "sm" }: { status: ExtractionStatus; size?: Size }) {
  return (
    <Badge variant={EXTRACTION_TONE[status]} size={size} dot>
      {EXTRACTION_STATUS_LABEL[status]}
    </Badge>
  );
}

export function SentimentBadge({ sentiment, size = "sm" }: { sentiment: BrandSentiment; size?: Size }) {
  return (
    <Badge variant={SENTIMENT_TONE[sentiment]} size={size} dot>
      {SENTIMENT_LABEL[sentiment]}
    </Badge>
  );
}

/** Short model names for dense contexts (table cells, bar labels); the
 *  full "ChatGPT (OpenAI)" label stays in dialogs and tooltips. */
const SHORT_PROVIDER: Record<string, string> = {
  openai: "ChatGPT",
  anthropic: "Claude",
  google: "Gemini",
  perplexity: "Perplexity",
};

export function shortProviderLabel(provider: string): string {
  return SHORT_PROVIDER[provider] ?? provider.charAt(0).toUpperCase() + provider.slice(1);
}
