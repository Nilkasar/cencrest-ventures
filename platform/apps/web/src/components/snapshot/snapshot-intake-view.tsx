"use client";

import { useState } from "react";
import { SnapshotIntakeForm } from "./snapshot-intake-form";
import { SnapshotConfirmation } from "./snapshot-confirmation";
import type { SnapshotSubmitResponse } from "@/data/snapshot/types";

/**
 * Right-panel content for the snapshot intake split-panel layout.
 * Layout owns the split; this component renders only the form content.
 */
export function SnapshotIntakeView() {
  const [submitted, setSubmitted] = useState<SnapshotSubmitResponse | undefined>();

  if (submitted) {
    return <SnapshotConfirmation response={submitted} />;
  }

  return (
    <div className="flex flex-col gap-6 w-full">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo-mark.png" alt="BeBest" className="size-10 object-contain mx-auto" />
      <div className="flex flex-col gap-2 text-center">
        <h1 className="font-display text-[36px] font-semibold text-foreground tracking-tight leading-[1.1]">
          Get your free snapshot.
        </h1>
        <p className="text-[14px] text-muted-foreground leading-relaxed">
          We run real queries across 4 AI models and email you the results.
        </p>
      </div>
      <SnapshotIntakeForm onSubmitted={setSubmitted} />
    </div>
  );
}
