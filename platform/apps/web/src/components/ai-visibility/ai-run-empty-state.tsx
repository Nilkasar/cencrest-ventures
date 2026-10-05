"use client";

import Link from "next/link";
import { AlertTriangle, Radar } from "lucide-react";
import { Button, EmptyState } from "@bebest/ui";
import { AiQueryLimitError, AiRunPreconditionError } from "@/data/ai-visibility/client";
import { providerLabel } from "@/data/ai-visibility/labels";

const PROVIDERS = ["openai", "anthropic", "google", "perplexity"];

export function describeStartError(err: unknown): { title: string; message: string; action?: { label: string; href: string } } | null {
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

/** Inline, actionable explanation of why a run couldn't start — the same
 *  chrome as a compact `ErrorPanel`, but its fix is a link, not a retry. */
export function StartErrorAlert({ title, message, action }: { title: string; message: string; action?: { label: string; href: string } }) {
  return (
    <div role="alert" className="flex flex-col gap-3 rounded-lg border border-danger/30 bg-danger-muted px-4 py-3 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-foreground">{title}</p>
          <p className="text-[12.5px] text-muted-foreground">{message}</p>
        </div>
      </div>
      {action && (
        <Button asChild variant="outline" size="sm" className="shrink-0 self-start sm:self-auto">
          <Link href={action.href}>{action.label}</Link>
        </Button>
      )}
    </div>
  );
}

/**
 * Before the first run: names the real mechanics (which four assistants,
 * that it runs in the background, real duration) and the button is the
 * real trigger.
 */
export function AiRunEmptyState({ starting, startError, onStart }: { starting: boolean; startError: unknown; onStart: () => void }) {
  const errorInfo = describeStartError(startError);

  return (
    <div className="flex flex-col gap-4">
      {errorInfo && <StartErrorAlert {...errorInfo} />}
      <EmptyState
        icon={<Radar size={20} />}
        title="No baseline run yet"
        description={`Your first run asks every query in your active query set to ${PROVIDERS.map(providerLabel).join(", ")}, then reads each answer for your brand. It takes about 30–60 minutes in the background — leave this page and come back any time.`}
        action={
          <Button variant="primary" loading={starting} onClick={onStart}>
            <Radar size={14} aria-hidden="true" /> Run baseline
          </Button>
        }
        secondaryAction={
          <Button asChild variant="ghost">
            <Link href="/query-universe">Review queries first</Link>
          </Button>
        }
      />
    </div>
  );
}
