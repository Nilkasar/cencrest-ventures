"use client";

import { useState } from "react";
import { AlertTriangle, RotateCw } from "lucide-react";
import { Badge, Button, Skeleton } from "@bebest/ui";
import { typography } from "@/components/patterns/typography";
import { getOpportunity } from "@/data/opportunities/client";
import type { OpportunityDetail } from "@/data/opportunities/types";
import { sourceTableLabel } from "@/data/opportunities/labels";
import { formatDate } from "@/lib/format";

/**
 * The lazy-fetched `GET /opportunities/:id` evidence trail — shared by the
 * Opportunities list (`opportunity-card.tsx`) and the Recommendations
 * screen (`recommendation-card.tsx`) so both show the same disclosure:
 * same lazy-on-first-open fetch, same states, same rendering.
 */
export type EvidenceState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; error: Error }
  | { status: "success"; data: OpportunityDetail };

export function useEvidenceTrail(opportunityId: string) {
  const [state, setState] = useState<EvidenceState>({ status: "idle" });

  async function load() {
    setState({ status: "loading" });
    try {
      const detail = await getOpportunity(opportunityId);
      setState({ status: "success", data: detail });
    } catch (err) {
      setState({
        status: "error",
        error: err instanceof Error ? err : new Error("Couldn't load evidence."),
      });
    }
  }

  return { state, load };
}

export function EvidenceTrailPanel({ state, onRetry }: { state: EvidenceState; onRetry: () => void }) {
  if (state.status === "loading" || state.status === "idle") {
    return (
      <div className="flex flex-col gap-2" aria-busy="true">
        <span className="sr-only">Loading evidence…</span>
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-4/5" />
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-2 text-[12.5px]">
        <AlertTriangle size={14} className="shrink-0 text-danger" aria-hidden="true" />
        <span className="text-foreground">Evidence didn&rsquo;t load.</span>
        <span className="text-muted-foreground">{state.error.message}</span>
        <Button variant="ghost" size="sm" onClick={onRetry}>
          <RotateCw size={12} aria-hidden="true" /> Try again
        </Button>
      </div>
    );
  }

  return (
    <>
      <p className={`${typography.eyebrow} mb-2.5`}>Evidence behind this score</p>
      <ul className="flex flex-col gap-2.5">
        {state.data.evidence.map((row) => (
          <li key={row.id} className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:gap-3">
            <Badge variant="outline" size="sm" className="w-fit shrink-0">
              {sourceTableLabel(row.sourceTable)}
            </Badge>
            <span className="text-[12.5px] leading-relaxed text-foreground">{row.summary}</span>
          </li>
        ))}
        {state.data.evidence.length === 0 && <li className="text-[12.5px] text-muted-foreground">No evidence rows were recorded for this opportunity.</li>}
      </ul>
      <p className="mt-3 border-t border-border pt-2.5 text-[11.5px] text-muted-foreground">
        Formula v{state.data.scoringFormulaVersion} · last updated {formatDate(state.data.updatedAt)}
      </p>
    </>
  );
}
