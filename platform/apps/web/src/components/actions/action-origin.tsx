"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, Bot, FileText, Sparkles } from "lucide-react";
import { Button } from "@bebest/ui";
import type { ActionWithContext } from "@/data/actions/types";
import type { AgentPendingAction } from "@/data/agents/types";
import { contentTypeLabel } from "@/data/content/labels";
import { formatNumber } from "@/lib/format";

/** How much of a long field to show before "Show more" — enough for the
 *  gist without turning the approvals list into a wall of draft text. */
const PREVIEW_CHARS = 240;

function ExpandableField({ label, value }: { label: string; value: string }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = value.length > PREVIEW_CHARS;
  const shown = expanded || !isLong ? value : `${value.slice(0, PREVIEW_CHARS).trimEnd()}…`;

  return (
    <div>
      <p className="mb-1 font-mono text-[10.5px] font-medium uppercase tracking-[0.12em] text-subtle-foreground">{label}</p>
      <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-foreground">{shown}</p>
      {isLong && (
        <Button type="button" variant="link" size="sm" className="mt-1 text-[12px]" aria-expanded={expanded} onClick={() => setExpanded((v) => !v)}>
          {expanded ? "Show less" : "Show more"}
        </Button>
      )}
    </div>
  );
}

function OriginShell({
  icon,
  label,
  title,
  meta,
  link,
  children,
}: {
  icon: ReactNode;
  label: string;
  title?: ReactNode;
  meta?: ReactNode;
  link?: { href: string; label: string };
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface/60 px-3.5 py-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md bg-surface-raised text-muted-foreground shadow-xs" aria-hidden="true">
            {icon}
          </span>
          <div className="min-w-0">
            <p className="text-[12px] text-muted-foreground">{label}</p>
            {title && <p className="truncate text-[13px] font-medium text-foreground">{title}</p>}
            {meta && <p className="text-[12px] text-muted-foreground">{meta}</p>}
          </div>
        </div>
        {link && (
          <Button variant="ghost" size="sm" asChild className="shrink-0 self-start">
            <Link href={link.href}>
              {link.label} <ArrowRight size={13} aria-hidden="true" />
            </Link>
          </Button>
        )}
      </div>
      {children}
    </div>
  );
}

/**
 * Where an action came from, shown inline so a reviewer sees exactly what
 * they're approving — Epic 13's "the underlying recommendation/draft
 * visible inline, not just a title… link forward/backward between screens".
 * Reads `contentDraft`/`contentBrief` straight off `GET /brands/me/actions`
 * (already inlined server-side). `agentRunId` comes from the bounded
 * `agentRunIdsByPendingActionId` join; when it can't resolve, this still
 * links somewhere real — the `/agents` list.
 */
export function ActionOrigin({
  action,
  agentRunId,
  agentPendingAction,
}: {
  action: ActionWithContext;
  agentRunId?: string;
  agentPendingAction?: AgentPendingAction;
}) {
  if (action.contentDraft) {
    return (
      <OriginShell
        icon={<FileText size={12} />}
        label="From a content draft"
        title={action.contentDraft.title ?? action.contentBrief?.title ?? "Untitled draft"}
        meta={`v${action.contentDraft.version}${action.contentBrief ? ` · ${contentTypeLabel(action.contentBrief.contentType)}` : ""} · ${formatNumber(action.contentDraft.wordCount)} words`}
        link={{ href: `/content/drafts/${action.contentDraft.id}`, label: "Review draft" }}
      >
        {action.contentBrief?.evidenceSummary && <ExpandableField label="Evidence" value={action.contentBrief.evidenceSummary} />}
        <ExpandableField label="Draft body" value={action.contentDraft.body} />
      </OriginShell>
    );
  }

  if (action.agentPendingActionId) {
    return (
      <OriginShell
        icon={<Bot size={12} />}
        label="From a Level 3 agent action"
        title={agentPendingAction?.title ?? "Agent-proposed action"}
        link={{ href: agentRunId ? `/agents/${agentRunId}` : "/agents", label: agentRunId ? "View agent run" : "View agent activity" }}
      >
        {agentPendingAction?.description ? (
          <p className="text-[13px] leading-relaxed text-muted-foreground">{agentPendingAction.description}</p>
        ) : (
          !agentRunId && (
            <p className="text-[12px] text-muted-foreground">
              This run is outside the recent-activity window, so its detail isn&apos;t shown here — open agent activity for the full history.
            </p>
          )
        )}
      </OriginShell>
    );
  }

  if (action.recommendationId) {
    return <OriginShell icon={<Sparkles size={12} />} label="From a recommendation" link={{ href: "/recommendations", label: "View recommendations" }} />;
  }

  return <OriginShell icon={<Sparkles size={12} />} label="Created directly — no linked recommendation or draft." />;
}
