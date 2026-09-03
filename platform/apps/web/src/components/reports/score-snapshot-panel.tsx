import { Badge } from "@bebest/ui";
import { SCORE_COMPONENT_LABEL } from "@/data/ai-visibility/labels";
import type { ScoreComponentKey } from "@/data/ai-visibility/types";
import type { ScoreSnapshot } from "@/data/reporting/types";
import { formatDate } from "@/lib/format";

const COMPONENT_ORDER: ScoreComponentKey[] = ["mentionScore", "recommendationScore", "positionScore", "coverageScore"];

/**
 * One side of a baseline-vs-current comparison (`ScoreSnapshotPanel
 * baseline={...}` / `current={...}` in `report-detail-view.tsx`) — renders
 * both the GEO (AI Visibility) and SEO components a `ScoreSnapshot` can
 * carry, each independently `null` when that signal has no data yet
 * (never coerced to a misleading 0, per the backend's own convention).
 * "Shows its work" per this epic's non-negotiable: the headline number is
 * never presented alone — its four GEO sub-components (or SEO's
 * technical/content split) sit right below it, labeled with the same
 * vocabulary the AI Visibility screen (`score-panel.tsx`) uses, so a
 * reader who already knows that screen recognizes these numbers instantly.
 */
export function ScoreSnapshotPanel({ label, snapshot }: { label: string; snapshot: ScoreSnapshot }) {
  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="font-mono text-[10.5px] font-medium uppercase tracking-[0.1em] text-subtle-foreground">{label}</p>
        <p className="text-[11px] text-subtle-foreground">as of {formatDate(snapshot.capturedAt)}</p>
      </div>

      {snapshot.geo && (
        <div>
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-[11px] font-medium text-muted-foreground">AI Visibility Score</p>
            <Badge variant="outline" size="sm">
              Formula v{snapshot.geo.formulaVersion}
            </Badge>
          </div>
          <p className="font-mono text-[32px] font-semibold text-foreground leading-none mt-1">
            {snapshot.geo.aiVisibilityScore.toFixed(1)}
            <span className="text-[14px] text-muted-foreground font-normal">/100</span>
          </p>
          <div className="grid grid-cols-2 gap-2 mt-3">
            {COMPONENT_ORDER.map((key) => (
              <div key={key} className="rounded-md bg-surface px-2.5 py-2">
                <p className="text-[10.5px] text-muted-foreground">{SCORE_COMPONENT_LABEL[key]}</p>
                <p className="font-mono text-[15px] font-semibold text-foreground">{snapshot.geo![key].toFixed(1)}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {snapshot.seo && (
        <div className={snapshot.geo ? "pt-3 border-t border-border" : ""}>
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-[11px] font-medium text-muted-foreground">SEO Health Score</p>
            <p className="text-[11px] text-subtle-foreground">{snapshot.seo.pagesAnalyzed} pages analyzed</p>
          </div>
          <p className="font-mono text-[32px] font-semibold text-foreground leading-none mt-1">
            {snapshot.seo.overallScore.toFixed(1)}
            <span className="text-[14px] text-muted-foreground font-normal">/100</span>
          </p>
          <div className="grid grid-cols-2 gap-2 mt-3">
            <div className="rounded-md bg-surface px-2.5 py-2">
              <p className="text-[10.5px] text-muted-foreground">Technical</p>
              <p className="font-mono text-[15px] font-semibold text-foreground">
                {snapshot.seo.technicalScore !== null ? snapshot.seo.technicalScore.toFixed(1) : "—"}
              </p>
            </div>
            <div className="rounded-md bg-surface px-2.5 py-2">
              <p className="text-[10.5px] text-muted-foreground">Content</p>
              <p className="font-mono text-[15px] font-semibold text-foreground">
                {snapshot.seo.contentScore !== null ? snapshot.seo.contentScore.toFixed(1) : "—"}
              </p>
            </div>
          </div>
        </div>
      )}

      {!snapshot.geo && !snapshot.seo && (
        <p className="text-[12.5px] text-muted-foreground">No score data captured yet for this point in time.</p>
      )}
    </div>
  );
}
