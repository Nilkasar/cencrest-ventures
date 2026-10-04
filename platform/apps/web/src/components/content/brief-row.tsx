"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { Sparkles } from "lucide-react";
import { Badge, Button, cn } from "@bebest/ui";
import type { ContentBrief, ContentDraft } from "@/data/content/types";
import { BRIEF_STATUS_BADGE_VARIANT, BRIEF_STATUS_LABEL, contentTypeLabel, splitImplementationNotes } from "@/data/content/labels";
import { DisclosureButton, RequirementsGrid } from "@/components/recommendations/level-meter";
import { formatDateTime, formatRelativeTime } from "@/lib/format";

/**
 * One brief in the Briefs list. Every brief carries its source
 * recommendation's dual SEO + GEO requirement verbatim (Epic 11's "not a
 * stripped-down summary" DoD), one click away so the list stays
 * scannable. The version chips are real links to each draft's review
 * screen; the one action — generate (or regenerate) a draft — sits right.
 *
 * `drafts` is `undefined` while the per-brief detail fetch is in flight,
 * distinct from `[]` (fetched, no drafts yet).
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
  const detailsId = useId();
  const notes = splitImplementationNotes(brief.implementationNotes);
  const sorted = drafts?.slice().sort((a, b) => b.version - a.version) ?? [];
  const hasDrafts = sorted.length > 0;

  return (
    <article className="flex flex-col gap-3 px-5 py-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h3 className="text-[14px] font-medium text-foreground">{brief.title}</h3>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1.5">
            <Badge variant={BRIEF_STATUS_BADGE_VARIANT[brief.status]} size="sm" dot>
              {BRIEF_STATUS_LABEL[brief.status]}
            </Badge>
            <Badge variant="outline" size="sm">
              {contentTypeLabel(brief.contentType)}
            </Badge>
            <span className="text-[12px] text-muted-foreground" title={formatDateTime(brief.createdAt)}>
              Created {formatRelativeTime(brief.createdAt)}
            </span>
          </div>
          {brief.targetQuery && (
            <p className="mt-2 text-[13px] text-muted-foreground">
              Target query <span className="text-foreground">&ldquo;{brief.targetQuery}&rdquo;</span>
            </p>
          )}
        </div>
        <Button variant={hasDrafts ? "secondary" : "primary"} size="sm" loading={generating} onClick={() => onGenerateDraft(brief)} className="shrink-0 self-start">
          <Sparkles size={13} aria-hidden="true" /> {hasDrafts ? "Regenerate draft" : "Generate draft"}
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <DisclosureButton expanded={showDetails} onClick={() => setShowDetails((v) => !v)} controls={detailsId}>
          Brief
        </DisclosureButton>
        {drafts === undefined && <span className="text-[12px] text-subtle-foreground">Loading versions…</span>}
        {drafts !== undefined && !hasDrafts && <span className="text-[12px] text-subtle-foreground">No drafts yet</span>}
        {hasDrafts && (
          <nav aria-label={`Draft versions of ${brief.title}`} className="flex flex-wrap items-center gap-1.5">
            <span className="text-[12px] text-muted-foreground">Drafts</span>
            {sorted.map((draft) => {
              const awaiting = draft.status === "generated";
              return (
                <Link
                  key={draft.id}
                  href={`/content/drafts/${draft.id}`}
                  title={awaiting ? "Awaiting approval" : "Approved"}
                  className={cn(
                    "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 font-mono text-[11.5px] tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    "border-border bg-surface-raised text-foreground hover:border-border-strong hover:bg-surface",
                  )}
                >
                  <span className={cn("size-1.5 rounded-full", awaiting ? "bg-warning" : "bg-success")} aria-hidden="true" />
                  v{draft.version}
                  <span className="sr-only">{awaiting ? "awaiting approval" : "approved"}</span>
                </Link>
              );
            })}
          </nav>
        )}
      </div>

      {showDetails && (
        <div id={detailsId} className="flex flex-col gap-3">
          <blockquote className="border-l-2 border-border-strong pl-3 text-[13px] leading-relaxed text-foreground">
            <span className="sr-only">Evidence: </span>
            {brief.evidenceSummary}
          </blockquote>
          {notes ? (
            <RequirementsGrid seo={notes.seo} geo={notes.geo} />
          ) : (
            <p className="whitespace-pre-line rounded-lg border border-border bg-surface/60 p-4 text-[13px] leading-relaxed text-foreground">{brief.implementationNotes}</p>
          )}
          {brief.keywords.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-[12px] text-muted-foreground">Keywords</span>
              {brief.keywords.map((kw) => (
                <Badge key={kw} variant="outline" size="sm">
                  {kw}
                </Badge>
              ))}
            </div>
          )}
        </div>
      )}
    </article>
  );
}
