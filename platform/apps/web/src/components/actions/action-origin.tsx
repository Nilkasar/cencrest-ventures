"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Bot, ChevronDown, ChevronUp, FileText, Sparkles } from "lucide-react";
import { Button } from "@bebest/ui";
import type { ActionWithContext } from "@/data/actions/types";
import type { AgentPendingAction } from "@/data/agents/types";
import { contentTypeLabel } from "@/data/content/labels";

/** How much of a long field to show before collapsing behind "Show more" —
 *  long enough that a reviewer usually gets the gist without expanding,
 *  short enough that the pending-approvals list doesn't turn into a wall of
 *  draft body text. */
const PREVIEW_CHARS = 240;

/** A label/value field that collapses past `PREVIEW_CHARS`, same
 *  label styling as `draft-approval-view.tsx`'s own `Field` component, so
 *  the inline card and the full `/content/drafts/:id` screen read as the
 *  same design language rather than two different treatments of the same
 *  data. Expanded by default when the text is already short. */
function ExpandableField({ label, value }: { label: string; value: string }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = value.length > PREVIEW_CHARS;
  const shown = expanded || !isLong ? value : `${value.slice(0, PREVIEW_CHARS).trimEnd()}…`;

  return (
    <div>
      <p className="font-mono text-[9.5px] uppercase tracking-[0.08em] text-subtle-foreground mb-1">{label}</p>
      <p className="text-[12.5px] text-foreground leading-relaxed whitespace-pre-wrap">{shown}</p>
      {isLong && (
        <Button
          type="button"
          variant="link"
          size="sm"
          className="mt-0.5 text-[11.5px]"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? (
            <>
              Show less <ChevronUp size={12} />
            </>
          ) : (
            <>
              Show more <ChevronDown size={12} />
            </>
          )}
        </Button>
      )}
    </div>
  );
}

/**
 * The underlying recommendation/content draft, shown inline — this epic's
 * own literal UI requirement: "pending approvals (with the underlying
 * recommendation/draft visible inline, not just a title)... link
 * forward/backward between screens rather than treating Actions as an
 * isolated list." Reads `contentDraft`/`contentBrief` straight off `GET
 * /brands/me/actions`'s own response (`routes/actions.ts`'s
 * `ACTION_INCLUDE` + `serializeActionWithContext`) — the real linked
 * record, already inlined server-side, never re-fetched or re-typed here.
 * The draft's `body` and the brief's `evidenceSummary` render inline too
 * (collapsed behind "Show more" past `PREVIEW_CHARS`) — a reviewer can see
 * exactly what they're approving without clicking through to
 * `/content/drafts/:id` first; that link stays for the full side-by-side
 * approval screen, not as the only way to see the content.
 *
 * `agentRunId` resolves through `agentRunIdsByPendingActionId`
 * (`data/actions/client.ts`) — a best-effort, bounded join (there is no
 * direct `agentPendingActionId -> agentRunId` field or route anywhere in
 * this codebase). When it can't resolve (the pending action fell outside
 * the scan window), this still links somewhere real — Epic 12's own
 * `/agents` list — rather than a broken or absent link.
 */
export function ActionOrigin({
  action,
  agentRunId,
  agentPendingAction,
}: {
  action: ActionWithContext;
  agentRunId?: string;
  /** The agent-originated pending action's own record, when the bounded
   *  scan behind `agentRunId` resolved one — see `agentRunIdsByPendingActionId`
   *  (`data/actions/client.ts`). `undefined` when the originating pending
   *  action fell outside the scan window; the branch below falls back to
   *  the generic label in that case rather than a broken/empty detail
   *  block. */
  agentPendingAction?: AgentPendingAction;
}) {
  if (action.contentDraft) {
    return (
      <div className="rounded-lg border border-border bg-surface p-3 flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[9.5px] uppercase tracking-[0.08em] text-subtle-foreground mb-1 flex items-center gap-1.5">
              <FileText size={11} /> From content draft
            </p>
            <p className="text-[13px] font-medium text-foreground truncate">
              {action.contentDraft.title ?? action.contentBrief?.title ?? "Untitled draft"}
            </p>
            <p className="text-[12px] text-muted-foreground mt-0.5">
              v{action.contentDraft.version}
              {action.contentBrief ? ` · ${contentTypeLabel(action.contentBrief.contentType)}` : ""}
              {` · ${action.contentDraft.wordCount} words`}
            </p>
          </div>
          <Link
            href={`/content/drafts/${action.contentDraft.id}`}
            className="inline-flex items-center gap-1 text-[12.5px] font-medium text-accent hover:underline shrink-0"
          >
            Review in Content <ArrowRight size={12} />
          </Link>
        </div>

        {action.contentBrief?.evidenceSummary && (
          <ExpandableField label="Evidence" value={action.contentBrief.evidenceSummary} />
        )}

        <ExpandableField label="Draft body" value={action.contentDraft.body} />
      </div>
    );
  }

  if (action.agentPendingActionId) {
    return (
      <div className="rounded-lg border border-border bg-surface p-3 flex flex-col gap-2">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[9.5px] uppercase tracking-[0.08em] text-subtle-foreground mb-1 flex items-center gap-1.5">
              <Bot size={11} /> From a Level 3 agent action
            </p>
            <p className="text-[13px] font-medium text-foreground truncate">
              {agentPendingAction?.title ?? "Agent-proposed action"}
            </p>
          </div>
          <Link
            href={agentRunId ? `/agents/${agentRunId}` : "/agents"}
            className="inline-flex items-center gap-1 text-[12.5px] font-medium text-accent hover:underline shrink-0"
          >
            {agentRunId ? "View agent run" : "View agent activity"} <ArrowRight size={12} />
          </Link>
        </div>
        {agentPendingAction?.description ? (
          <p className="text-[12.5px] text-muted-foreground leading-relaxed">{agentPendingAction.description}</p>
        ) : (
          !agentRunId && (
            <p className="text-[11.5px] text-subtle-foreground">
              This agent run fell outside the recent-activity window, so its full detail isn&apos;t available here — view agent
              activity for the complete history.
            </p>
          )
        )}
      </div>
    );
  }

  if (action.recommendationId) {
    return (
      <div className="rounded-lg border border-border bg-surface p-3 flex items-center justify-between gap-3 flex-wrap">
        <p className="text-[12.5px] text-muted-foreground flex items-center gap-1.5">
          <Sparkles size={13} className="text-subtle-foreground shrink-0" /> From a recommendation
        </p>
        <Link
          href="/recommendations"
          className="inline-flex items-center gap-1 text-[12.5px] font-medium text-accent hover:underline shrink-0"
        >
          View recommendations <ArrowRight size={12} />
        </Link>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-surface p-3">
      <p className="text-[12.5px] text-muted-foreground">Created directly — no linked recommendation or draft.</p>
    </div>
  );
}
