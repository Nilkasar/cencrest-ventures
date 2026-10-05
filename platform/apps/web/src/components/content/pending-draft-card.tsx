import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Badge, Button } from "@bebest/ui";
import type { ContentBrief, ContentDraft, ContentQualityCheck } from "@/data/content/types";
import { contentTypeLabel } from "@/data/content/labels";
import { formatDateTime, formatNumber, formatRelativeTime } from "@/lib/format";
import { QualityCheckList, QualitySummary } from "./quality-check-list";

/**
 * One draft in the review queue. All five quality-check results render
 * inline — Epic 11: "with the quality-check results visible, not hidden
 * behind a click" — with a one-line verdict on top so the queue can be
 * scanned. Approving happens on `/content/drafts/:id`, which puts the
 * draft next to its brief's original requirements; approving from this
 * list would be the "approving blind" the spec rules out.
 */
export function PendingDraftCard({ brief, draft, checks }: { brief: ContentBrief; draft: ContentDraft; checks: ContentQualityCheck[] }) {
  return (
    <article className="flex flex-col gap-3 px-5 py-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h3 className="text-[14px] font-medium text-foreground">{draft.title ?? brief.title}</h3>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1.5">
            <Badge variant="outline" size="sm">
              v{draft.version}
            </Badge>
            <Badge variant="outline" size="sm">
              {contentTypeLabel(brief.contentType)}
            </Badge>
            <span className="text-[12px] text-muted-foreground">
              {formatNumber(draft.wordCount)} words · <span title={formatDateTime(draft.generatedAt)}>generated {formatRelativeTime(draft.generatedAt)}</span>
            </span>
          </div>
          <p className="mt-1.5 truncate text-[12.5px] text-muted-foreground">From brief &ldquo;{brief.title}&rdquo;</p>
        </div>
        <Button asChild variant="primary" size="sm" className="shrink-0 self-start">
          <Link href={`/content/drafts/${draft.id}`}>
            Review &amp; approve <ArrowRight size={13} aria-hidden="true" />
          </Link>
        </Button>
      </div>

      <div className="rounded-lg border border-border bg-surface/60 px-4 pt-3">
        <QualitySummary checks={checks} className="border-b border-border pb-3" />
        <QualityCheckList checks={checks} columns={2} />
      </div>
    </article>
  );
}
