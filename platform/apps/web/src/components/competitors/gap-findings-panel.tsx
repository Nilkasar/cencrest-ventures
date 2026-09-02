"use client";

import { useMemo, useState } from "react";
import { AlertCircle } from "lucide-react";
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  Tabs,
  TabsList,
  TabsTrigger,
} from "@bebest/ui";
import {
  GAP_SEVERITY_BADGE_VARIANT,
  GAP_SEVERITY_LABEL,
  GAP_TYPE_BADGE_VARIANT,
  GAP_TYPE_DESCRIPTION,
  GAP_TYPE_LABEL,
} from "@/data/competitive-intelligence/labels";
import type { CompetitiveGapsResponse, GapFinding, GapType } from "@/data/competitive-intelligence/types";

type FilterValue = "all" | GapType;

const GAP_TYPE_ORDER: GapType[] = ["intent_gap", "content_gap", "entity_gap", "source_gap"];

/**
 * The four independently-`gapType`-tagged findings
 * (`docs/epics/08-competitive-intelligence.md`: "each is a distinct,
 * labeled finding, not a single generic 'you're behind' signal") — this is
 * what Epic 9's Opportunity Engine consumes directly, so the UI mirrors
 * that same structure rather than flattening it into one undifferentiated
 * list.
 */
export function GapFindingsPanel({ gaps }: { gaps: CompetitiveGapsResponse }) {
  const [filter, setFilter] = useState<FilterValue>("all");

  const counts = useMemo(() => {
    const c: Record<GapType, number> = { intent_gap: 0, content_gap: 0, entity_gap: 0, source_gap: 0 };
    for (const g of gaps.gaps) c[g.gapType]++;
    return c;
  }, [gaps.gaps]);

  const filtered = filter === "all" ? gaps.gaps : gaps.gaps.filter((g) => g.gapType === filter);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Gap findings</CardTitle>
        <CardDescription>Every query, category, and cited domain a competitor wins that you don&apos;t — classified, not vague.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {gaps.gaps.length === 0 ? (
          <EmptyState
            compact
            icon={<AlertCircle size={18} />}
            title={gaps.computed ? "No gaps found yet" : "Nothing to classify yet"}
            description={
              gaps.computed
                ? "Once competitors have completed runs on your active query set, any gap they win over you shows up here."
                : "Run your AI Visibility baseline, then run at least one competitor, to see classified gaps."
            }
          />
        ) : (
          <>
            <Tabs value={filter} onValueChange={(v) => setFilter(v as FilterValue)}>
              <TabsList>
                <TabsTrigger value="all">All ({gaps.gaps.length})</TabsTrigger>
                {GAP_TYPE_ORDER.map((type) => (
                  <TabsTrigger key={type} value={type} disabled={counts[type] === 0}>
                    {GAP_TYPE_LABEL[type]} ({counts[type]})
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>

            <div className="flex flex-col gap-2">
              {filtered.map((finding, i) => (
                <GapFindingRow key={`${finding.gapType}-${i}`} finding={finding} />
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function GapFindingRow({ finding }: { finding: GapFinding }) {
  return (
    <div className="rounded-lg border border-border px-4 py-3 flex flex-col gap-1.5">
      <div className="flex items-center gap-2 flex-wrap">
        <Badge variant={GAP_TYPE_BADGE_VARIANT[finding.gapType]} size="sm">
          {GAP_TYPE_LABEL[finding.gapType]}
        </Badge>
        <Badge variant={GAP_SEVERITY_BADGE_VARIANT[finding.severity]} size="sm">
          {GAP_SEVERITY_LABEL[finding.severity]}
        </Badge>
      </div>

      {finding.gapType === "intent_gap" && (
        <>
          <p className="text-[13px] text-foreground leading-relaxed">
            &ldquo;{finding.queryText}&rdquo; — you appear in {finding.yourMentionRatePct}% of responses.{" "}
            {finding.competitors.map((c) => `${c.competitorName} appears in ${c.mentionRatePct}%`).join("; ")}.
          </p>
        </>
      )}

      {finding.gapType === "content_gap" && (
        <p className="text-[13px] text-foreground leading-relaxed">
          &ldquo;{finding.queryText}&rdquo; — AI cites {finding.citedDomains.length === 1 ? "a domain" : "domains"} you have no content on:{" "}
          <span className="font-mono text-[12px]">{finding.citedDomains.join(", ")}</span>.
        </p>
      )}

      {finding.gapType === "entity_gap" && (
        <p className="text-[13px] text-foreground leading-relaxed">
          Category &ldquo;{finding.category}&rdquo; — you have {finding.yourPresencePct}% presence.{" "}
          {finding.competitors.map((c) => `${c.competitorName} has ${c.presencePct}%`).join("; ")}.
        </p>
      )}

      {finding.gapType === "source_gap" && (
        <p className="text-[13px] text-foreground leading-relaxed">
          <span className="font-mono text-[12px]">{finding.domain}</span> is cited for your query set but never for your brand.{" "}
          {finding.citedByCompetitors.map((c) => `${c.competitorName} is cited there ${c.citationRatePct}% of the time`).join("; ")}.
        </p>
      )}

      <p className="text-[11.5px] text-subtle-foreground">{GAP_TYPE_DESCRIPTION[finding.gapType]}</p>
    </div>
  );
}
