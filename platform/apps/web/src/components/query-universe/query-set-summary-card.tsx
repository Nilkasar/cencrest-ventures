"use client";

import { Archive, RefreshCw, Rocket } from "lucide-react";
import { Badge, Button, Card, CardContent } from "@bebest/ui";
import type { QuerySet } from "@/data/query-universe/types";
import { STATUS_BADGE_VARIANT, STATUS_LABEL, describeQueryUpgradePath } from "@/data/query-universe/constants";
import { formatDateTime } from "@/lib/format";

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** The header card for the set currently open in the review screen — status,
 *  version, the plan's cap meter, and the lifecycle actions valid from this
 *  state (regenerate/activate for a draft, archive for an active set). */
export function QuerySetSummaryCard({
  querySet,
  onRegenerate,
  onActivate,
  onArchive,
  busy,
}: {
  querySet: QuerySet;
  onRegenerate: () => void;
  onActivate: () => void;
  onArchive: () => void;
  busy: "generate" | "activate" | "archive" | null;
}) {
  const pctUsed = querySet.planLimit > 0 ? Math.min(100, Math.round((querySet.queryCount / querySet.planLimit) * 100)) : 0;
  const capped = querySet.potentialCount > querySet.planLimit;
  const upgrade = capped ? describeQueryUpgradePath(querySet.planTier) : undefined;

  return (
    <Card>
      <CardContent className="p-5 flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="font-display text-[17px] font-semibold text-foreground">{querySet.name}</h2>
              <Badge variant={STATUS_BADGE_VARIANT[querySet.status]} size="sm">
                {STATUS_LABEL[querySet.status]}
              </Badge>
              <span className="font-mono text-[11px] text-subtle-foreground">v{querySet.version}</span>
            </div>
            {querySet.description && (
              <p className="text-[12.5px] text-muted-foreground mt-1 max-w-[60ch]">{querySet.description}</p>
            )}
            <p className="text-[11.5px] text-subtle-foreground mt-1.5">
              {querySet.status === "active" && querySet.activatedAt
                ? `Activated ${formatDateTime(querySet.activatedAt)}`
                : `Last updated ${formatDateTime(querySet.updatedAt)}`}
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {querySet.status === "draft" && (
              <>
                <Button variant="outline" size="sm" onClick={onRegenerate} loading={busy === "generate"}>
                  <RefreshCw size={13} /> Regenerate
                </Button>
                <Button variant="primary" size="sm" onClick={onActivate} loading={busy === "activate"} disabled={querySet.queryCount === 0}>
                  <Rocket size={13} /> Activate
                </Button>
              </>
            )}
            {querySet.status === "active" && (
              <Button variant="outline" size="sm" onClick={onArchive} loading={busy === "archive"}>
                <Archive size={13} /> Archive
              </Button>
            )}
          </div>
        </div>

        <div>
          <div className="flex items-baseline justify-between gap-2 mb-1.5">
            <p className="text-[12px] text-muted-foreground">
              <span className="font-mono text-foreground font-medium">{querySet.queryCount.toLocaleString()}</span>
              {" "}of{" "}
              <span className="font-mono">{querySet.planLimit.toLocaleString()}</span> queries ·{" "}
              {capitalize(querySet.planTier)} plan
            </p>
            {capped && <span className="text-[11px] text-warning">Capped by plan — {querySet.potentialCount.toLocaleString()} possible</span>}
          </div>
          <div className="h-1.5 w-full rounded-full bg-surface overflow-hidden" role="progressbar" aria-valuenow={pctUsed} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${pctUsed}%` }} />
          </div>
          {capped && upgrade && <p className="text-[11.5px] text-muted-foreground mt-1.5">{upgrade}</p>}
        </div>

        {querySet.status === "active" && (
          <p className="text-[12px] text-muted-foreground border-t border-border pt-3">
            This version is frozen — AI Visibility and SEO Intelligence read these {querySet.queryCount.toLocaleString()} queries as-is.
            Archive it and generate a new draft to change the set.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
