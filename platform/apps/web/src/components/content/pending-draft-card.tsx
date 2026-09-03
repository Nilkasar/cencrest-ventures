import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Badge, Button } from "@bebest/ui";
import type { ContentBrief, ContentDraft, ContentQualityCheck } from "@/data/content/types";
import { contentTypeLabel } from "@/data/content/labels";
import { QualityCheckList } from "./quality-check-list";

/**
 * One draft awaiting approval — `docs/epics/11-content-intelligence-
 * generation.md`'s UI surface, verbatim: "drafts awaiting approval (with
 * the quality-check results visible, not hidden behind a click)." All 5
 * quality-check results render inline, right here, rather than behind a
 * disclosure toggle — the ONE thing on this whole screen that is
 * deliberately never collapsed. The actual Approve action lives on the
 * dedicated `/content/drafts/:id` screen, which puts this draft next to its
 * brief's full original requirements — approving from this list, without
 * that side-by-side view, is exactly the "approving blind" the epic spec
 * calls out.
 */
export function PendingDraftCard({ brief, draft, checks }: { brief: ContentBrief; draft: ContentDraft; checks: ContentQualityCheck[] }) {
  return (
    <div className="p-5 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-[14px] font-medium text-foreground">{draft.title ?? brief.title}</p>
            <Badge variant="outline" size="sm">
              v{draft.version}
            </Badge>
            <Badge variant="outline" size="sm">
              {contentTypeLabel(brief.contentType)}
            </Badge>
          </div>
          <p className="text-[12.5px] text-muted-foreground mt-1">
            From brief “{brief.title}” · {draft.wordCount} words · {draft.providerName}
            {draft.modelName ? ` / ${draft.modelName}` : ""}
          </p>
        </div>
        <Button asChild variant="primary" size="sm">
          <Link href={`/content/drafts/${draft.id}`}>
            Review &amp; approve <ArrowRight size={13} />
          </Link>
        </Button>
      </div>

      <div className="rounded-lg border border-border bg-surface p-3">
        <QualityCheckList checks={checks} />
      </div>
    </div>
  );
}
