"use client";

import { useState } from "react";
import { FileWarning } from "lucide-react";
import { Button, Skeleton } from "@bebest/ui";
import { getOpportunity } from "@/data/opportunities/client";
import type { OpportunityDetail } from "@/data/opportunities/types";
import { sourceTableLabel } from "@/data/opportunities/labels";
import { formatDate } from "@/lib/format";

/**
 * The lazy-fetched `GET /opportunities/:id` evidence trail — factored out of
 * `opportunity-card.tsx` so Epic 10's standalone Recommendations screen
 * (`recommendation-card.tsx`) can show the exact same "link to its source
 * opportunity's evidence" disclosure without a second, drifting copy of the
 * fetch/loading/error/render logic. Same shape, same lazy-on-first-open
 * behavior, same styling, in both places.
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
  if (state.status === "loading") {
    return (
      <div className="flex flex-col gap-2">
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-4/5" />
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="flex items-center gap-2 text-[12.5px] text-danger">
        <FileWarning size={14} className="shrink-0" />
        {state.error.message}
        <Button variant="ghost" size="sm" onClick={onRetry}>
          Retry
        </Button>
      </div>
    );
  }

  if (state.status === "success") {
    return (
      <>
        <ul className="flex flex-col gap-2.5">
          {state.data.evidence.map((row) => (
            <li key={row.id} className="text-[12.5px] leading-relaxed">
              <span className="font-mono text-[9.5px] uppercase tracking-[0.08em] text-subtle-foreground mr-2">
                {sourceTableLabel(row.sourceTable)}
              </span>
              <span className="text-foreground">{row.summary}</span>
            </li>
          ))}
          {state.data.evidence.length === 0 && (
            <li className="text-[12.5px] text-muted-foreground">No evidence rows recorded for this opportunity.</li>
          )}
        </ul>
        <p className="text-[11px] text-subtle-foreground mt-2.5 pt-2.5 border-t border-border">
          Formula v{state.data.scoringFormulaVersion} · last updated {formatDate(state.data.updatedAt)}
        </p>
      </>
    );
  }

  return null;
}
