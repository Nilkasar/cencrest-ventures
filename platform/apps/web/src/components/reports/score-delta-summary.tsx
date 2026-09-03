import { AlertTriangle } from "lucide-react";
import type { ScoreDeltaResult } from "@/data/reporting/types";

const BASIS_LABEL: Record<ScoreDeltaResult["basis"], string> = {
  geo: "AI Visibility Score",
  seo: "SEO Health Score",
  none: "No comparable score",
};

/**
 * The headline number of a `baseline_comparison` report — `after - before`
 * on whichever basis `computeScoreDelta` picked (GEO preferred over SEO
 * whenever both sides have one, per that function's own precedent, since
 * AI visibility is this product's headline metric). This IS the "score
 * must land emotionally" first-value-moment number
 * `docs/09-ux/CUSTOMER_JOURNEY.md` calls for — shown large, signed, and
 * colored, but always labeled with which basis produced it so it's never
 * an opaque number.
 */
export function ScoreDeltaSummary({ scoreDelta }: { scoreDelta: ScoreDeltaResult }) {
  const tone = scoreDelta.delta === null ? "text-muted-foreground" : scoreDelta.delta > 0 ? "text-success" : scoreDelta.delta < 0 ? "text-danger" : "text-muted-foreground";
  const sign = scoreDelta.delta !== null && scoreDelta.delta > 0 ? "+" : "";

  return (
    <div className="flex flex-col items-center text-center gap-1.5 rounded-xl border border-border bg-surface py-8 px-6">
      <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-subtle-foreground">Change since baseline</p>
      <p className={`font-mono text-[56px] font-semibold leading-none ${tone}`}>
        {scoreDelta.delta !== null ? `${sign}${scoreDelta.delta.toFixed(1)}` : "—"}
      </p>
      <p className="text-[13px] text-muted-foreground">{BASIS_LABEL[scoreDelta.basis]}</p>
      {scoreDelta.formulaVersionsMatch === false && (
        <p className="mt-2 flex items-center gap-1.5 text-[11.5px] text-warning">
          <AlertTriangle size={12} aria-hidden="true" /> Scoring formula changed between baseline and now — treat this as directional.
        </p>
      )}
    </div>
  );
}
