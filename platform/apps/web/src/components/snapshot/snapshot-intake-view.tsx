"use client";

import { useState } from "react";
import { SnapshotIntakeForm } from "./snapshot-intake-form";
import { SnapshotConfirmation } from "./snapshot-confirmation";
import type { SnapshotSubmitResponse } from "@/data/snapshot/types";

/**
 * `docs/epics/17-free-snapshot.md`'s "UI surface": the intake form and the
 * confirmation screen, both on this one route — a successful submit swaps
 * the form out for the confirmation view in place, no navigation, so the
 * visitor never loses the response payload (including the report token)
 * to a page transition.
 */
export function SnapshotIntakeView() {
  const [submitted, setSubmitted] = useState<SnapshotSubmitResponse | undefined>();

  if (submitted) {
    return <SnapshotConfirmation response={submitted} />;
  }

  return (
    <>
      <div className="flex flex-col gap-4 mb-10">
        <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-accent/30 bg-accent/10 px-3 py-1 text-[11px] font-mono font-medium uppercase tracking-[0.12em] text-accent">
          Free · No credit card
        </span>
        <h1 className="font-display text-[32px] sm:text-[40px] font-semibold text-foreground tracking-[-0.02em] leading-[1.1]">
          See why AI recommends<br className="hidden sm:block" /> your competitors.
        </h1>
        <p className="text-[14.5px] text-muted-foreground leading-relaxed max-w-[54ch]">
          We&apos;ll run a real sample: your AI Visibility Score across ChatGPT, Claude, Gemini, and Perplexity,
          a basic SEO pass, and the top gaps worth fixing first.
        </p>
      </div>

      <div className="rounded-2xl border border-border bg-surface shadow-sm p-6 sm:p-8">
        <SnapshotIntakeForm onSubmitted={setSubmitted} />
      </div>
    </>
  );
}
