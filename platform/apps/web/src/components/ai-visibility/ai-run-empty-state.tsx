"use client";

import Link from "next/link";
import { Radar } from "lucide-react";
import { Button, EmptyState } from "@bebest/ui";
import { AiQueryLimitError, AiRunPreconditionError } from "@/data/ai-visibility/client";
import { providerLabel } from "@/data/ai-visibility/labels";

const PROVIDERS = ["openai", "anthropic", "google", "perplexity"];

function describeStartError(err: unknown): { title: string; message: string; action?: { label: string; href: string } } | null {
  if (err instanceof AiQueryLimitError) {
    return { title: "Monthly AI query limit reached", message: err.message };
  }
  if (err instanceof AiRunPreconditionError) {
    if (err.code === "no_active_query_set") {
      return {
        title: "No active query set",
        message: "AI Visibility runs your active query set across every AI assistant. Activate one in Query Universe first.",
        action: { label: "Go to Query Universe", href: "/query-universe" },
      };
    }
    if (err.code === "query_set_empty") {
      return {
        title: "Your active query set is empty",
        message: "Add at least one query to your active query set before running a baseline.",
        action: { label: "Go to Query Universe", href: "/query-universe" },
      };
    }
    return { title: "Brand profile not found", message: err.message };
  }
  return null;
}

/**
 * Before the first run. Per the epic's UI surface note (mirrored from Epic
 * 3's crawl empty state): names the real mechanics — which four assistants,
 * that it runs in the background, real duration — rather than a vague
 * "we'll analyze your brand," and the button is a real trigger.
 */
export function AiRunEmptyState({ starting, startError, onStart }: { starting: boolean; startError: unknown; onStart: () => void }) {
  const errorInfo = describeStartError(startError);

  return (
    <div className="flex flex-col gap-4">
      <EmptyState
        icon={<Radar size={20} />}
        eyebrow="AI Visibility"
        title="No baseline run yet"
        description={`We'll run every query in your active query set against ${PROVIDERS.map(providerLabel).join(", ")} — never a local model, since the product measures what real AI assistants actually say. A full run typically takes 30–60 minutes; you're free to leave this page and come back once it's done.`}
        action={
          <Button variant="primary" size="sm" loading={starting} onClick={onStart}>
            Run baseline
          </Button>
        }
      />
      {errorInfo && (
        <div role="alert" className="flex flex-col gap-2 rounded-xl border border-danger/30 bg-danger-muted px-6 py-5 text-center">
          <p className="font-display text-[15px] font-semibold text-foreground">{errorInfo.title}</p>
          <p className="text-[13px] text-muted-foreground max-w-[60ch] mx-auto">{errorInfo.message}</p>
          {errorInfo.action && (
            <div className="mt-1">
              <Button asChild variant="outline" size="sm">
                <Link href={errorInfo.action.href}>{errorInfo.action.label}</Link>
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
