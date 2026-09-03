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
      <div className="flex flex-col gap-3 mb-10">
        <p className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-subtle-foreground">
          Free AI + SEO Growth Snapshot
        </p>
        <h1 className="font-display text-[32px] sm:text-[38px] font-semibold text-foreground tracking-[-0.02em] leading-tight">
          See why AI recommends your competitors.
        </h1>
        <p className="text-[14.5px] text-muted-foreground leading-relaxed max-w-[56ch]">
          We&apos;ll run a real, computed sample: your AI Visibility Score across ChatGPT, Claude, Gemini, and
          Perplexity, a basic SEO pass on your site, and the top gaps and priorities worth fixing first. Free, no
          credit card.
        </p>
      </div>
      <SnapshotIntakeForm onSubmitted={setSubmitted} />
    </>
  );
}
