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
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-16 items-center">
      {/* Left — headline + value props */}
      <div className="flex flex-col gap-5">
        <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-accent/30 bg-accent/10 px-3 py-1 text-[11px] font-mono font-medium uppercase tracking-[0.12em] text-accent">
          Free · No credit card
        </span>
        <h1 className="font-display text-[36px] sm:text-[44px] font-semibold text-foreground tracking-[-0.025em] leading-[1.08]">
          See why AI recommends your competitors.
        </h1>
        <p className="text-[15px] text-muted-foreground leading-relaxed max-w-[46ch]">
          We run real AI queries across ChatGPT, Claude, Gemini, and Perplexity — then show you your score, how you
          compare, and the gaps worth closing first.
        </p>
        <ul className="flex flex-col gap-2.5 mt-1">
          {[
            "AI Visibility Score across 4 models",
            "Competitor comparison included",
            "Top gaps & priorities — prioritised",
            "Delivered to your inbox in 24 hrs",
          ].map((item) => (
            <li key={item} className="flex items-center gap-2.5 text-[13.5px] text-muted-foreground">
              <span className="size-1.5 rounded-full bg-accent shrink-0" />
              {item}
            </li>
          ))}
        </ul>
      </div>

      {/* Right — form card */}
      <div className="rounded-2xl border border-border bg-surface shadow-sm p-6 sm:p-8">
        <SnapshotIntakeForm onSubmitted={setSubmitted} />
      </div>
    </div>
  );
}
