"use client";

import Link from "next/link";
import { useState } from "react";
import { ChevronDown, ChevronRight, Sparkles } from "lucide-react";
import { Badge, Button } from "@bebest/ui";
import type { ContentBrief, ContentDraft } from "@/data/content/types";
import { BRIEF_STATUS_BADGE_VARIANT, BRIEF_STATUS_LABEL, DRAFT_STATUS_BADGE_VARIANT, DRAFT_STATUS_LABEL, contentTypeLabel, splitImplementationNotes } from "@/data/content/labels";
import { formatDate } from "@/lib/format";

/**
 * One row in the "Active briefs" list — `docs/epics/11-content-intelligence-
 * generation.md`'s UI surface. Every brief carries forward its source
 * recommendation's dual SEO+GEO requirement VERBATIM (`implementationNotes`
 * — this epic's explicit "not a stripped-down summary" DoD), shown here as
 * two visibly distinct blocks behind a disclosure toggle, same convention
 * `next-action-panel.tsx`'s "Show implementation brief" already sets for
 * Epic 10.
 *
 * `drafts` is `undefined` while the per-brief detail fetch (`GET
 * /content-briefs/:id`, which is what actually carries the draft list) is
 * still in flight — distinct from an empty array (fetched, zero drafts
 * yet).
 */
export function BriefRow({
  brief,
  drafts,
  generating,
  onGenerateDraft,
}: {
  brief: ContentBrief;
  drafts: ContentDraft[] | undefined;
  generating: boolean;
  onGenerateDraft: (brief: ContentBrief) => void;
}) {
  const [showDetails, setShowDetails] = useState(false);
  const notes = splitImplementationNotes(brief.implementationNotes);
  const hasDrafts = (drafts?.length ?? 0) > 0;

  return (
    <div className="p-5 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-[14px] font-medium text-foreground">{brief.title}</p>
            <Badge variant="outline" size="sm">
              {contentTypeLabel(brief.contentType)}
            </Badge>
            <Badge variant={BRIEF_STATUS_BADGE_VARIANT[brief.status]} size="sm">
              {BRIEF_STATUS_LABEL[brief.status]}
            </Badge>
          </div>
          {brief.targetQuery && <p className="text-[12.5px] text-muted-foreground mt-1 truncate">Target: “{brief.targetQuery}”</p>}
          <button
            type="button"
            onClick={() => setShowDetails((v) => !v)}
            className="mt-2 inline-flex items-center gap-1 text-[12px] text-accent hover:underline underline-offset-4"
          >
            {showDetails ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            {showDetails ? "Hide brief" : "Show brief"}
          </button>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <p className="text-[11.5px] text-subtle-foreground">{formatDate(brief.createdAt)}</p>
          <Button variant="outline" size="sm" loading={generating} onClick={() => onGenerateDraft(brief)}>
            <Sparkles size={13} /> {hasDrafts ? "Regenerate draft" : "Generate draft"}
          </Button>
        </div>
      </div>

      {showDetails && (
        <div className="rounded-lg border border-border bg-surface p-3 flex flex-col gap-3">
          <p className="text-[12.5px] text-foreground leading-relaxed">{brief.evidenceSummary}</p>
          {notes ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <p className="font-mono text-[9.5px] uppercase tracking-[0.08em] text-subtle-foreground mb-1">SEO requirements</p>
                <p className="text-[12px] text-foreground leading-relaxed">{notes.seo}</p>
              </div>
              <div>
                <p className="font-mono text-[9.5px] uppercase tracking-[0.08em] text-subtle-foreground mb-1">GEO requirements</p>
                <p className="text-[12px] text-foreground leading-relaxed">{notes.geo}</p>
              </div>
            </div>
          ) : (
            <p className="text-[12px] text-foreground leading-relaxed whitespace-pre-line">{brief.implementationNotes}</p>
          )}
          {brief.keywords.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {brief.keywords.map((kw) => (
                <Badge key={kw} variant="neutral" size="sm">
                  {kw}
                </Badge>
              ))}
            </div>
          )}
        </div>
      )}

      {drafts === undefined && <p className="text-[11.5px] text-subtle-foreground">Loading versions…</p>}

      {hasDrafts && (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-[11px] font-mono uppercase tracking-[0.08em] text-subtle-foreground">Versions</p>
          {drafts!
            .slice()
            .sort((a, b) => b.version - a.version)
            .map((draft) => (
              <Link
                key={draft.id}
                href={`/content/drafts/${draft.id}`}
                className="inline-flex items-center gap-1.5 rounded-full border border-border-strong px-2.5 h-6 text-[11.5px] text-foreground hover:bg-surface transition-colors"
              >
                v{draft.version}
                <Badge variant={DRAFT_STATUS_BADGE_VARIANT[draft.status]} size="sm">
                  {DRAFT_STATUS_LABEL[draft.status]}
                </Badge>
              </Link>
            ))}
        </div>
      )}
    </div>
  );
}
