"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight, ListChecks, Sparkles } from "lucide-react";
import { Badge, Card, Skeleton } from "@bebest/ui";
import { useAsyncData, type AsyncState } from "@/lib/use-async-data";
import type { ActionPriority, ActionWithContext, ActionsOverview } from "@/data/actions/types";
import { ACTION_PRIORITY_BADGE_VARIANT, ACTION_PRIORITY_LABEL } from "@/data/actions/labels";
import { listRecommendations } from "@/data/recommendations/client";
import { ACTION_TYPE_BADGE_VARIANT, ACTION_TYPE_LABEL } from "@/data/recommendations/labels";
import { PanelError, panelVariants } from "./primitives";

/** `ActionPriority`'s real 1-3-plus-critical ladder, ranked so "highest
 *  priority" has an unambiguous answer — `GET /brands/me/actions` sorts its
 *  `pending` section by `created_at` desc only (see
 *  `apps/api/src/routes/actions.ts`), not by priority, so this tile does
 *  the priority ordering `docs/epics/10-recommendation-engine-backend.md`'s
 *  `priorityRank` already does server-side for recommendations. */
const PRIORITY_WEIGHT: Record<ActionPriority, number> = { critical: 3, high: 2, medium: 1, low: 0 };

/** Highest-priority pending approval, newest first within a tie (the array
 *  arrives already `created_at` desc — `Array.prototype.sort` is stable, so
 *  that ordering survives inside each priority tier). `null` when nothing
 *  is pending. */
function topPendingAction(pending: ActionWithContext[]): ActionWithContext | null {
  if (pending.length === 0) return null;
  return [...pending].sort((a, b) => PRIORITY_WEIGHT[b.priority] - PRIORITY_WEIGHT[a.priority])[0]!;
}

/**
 * "What should I do next?" (singular) — the Overview's one call to action.
 * Precedence: a PENDING APPROVAL wins over a plain recommendation whenever
 * one exists — it's already a concrete, reviewed action waiting on a single
 * click, the most "shovel-ready" thing a user can do. Within pending
 * approvals, the highest `priority` wins. Only when nothing is pending does
 * this fall back to the single highest-`priorityRank` open recommendation
 * — fetched with `status: "new", limit: 1` so the API's own sort picks it.
 *
 * The actions overview is fetched once by the view (it also feeds the KPI
 * strip and the growth loop) and passed in; only the recommendation fetch
 * lives here.
 */
export function NextActionTile({ actions }: { actions: AsyncState<ActionsOverview> & { reload: () => void } }) {
  const rec = useAsyncData(() => listRecommendations({ status: "new", limit: 1 }), []);

  const loading = actions.status === "loading" || rec.status === "loading";
  const pendingAction = actions.status === "success" ? topPendingAction(actions.data.pending) : null;
  const recommendation = rec.status === "success" ? (rec.data.recommendations[0] ?? null) : null;

  let content: React.ReactNode;
  if (loading) {
    content = (
      <div className="flex flex-col gap-3" aria-busy="true">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-5 w-full" />
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="h-9 w-32 mt-2" />
      </div>
    );
  } else if (pendingAction) {
    content = (
      <Cta
        href="/actions"
        cta="Review and approve"
        icon={<ListChecks size={14} />}
        badges={
          <>
            <Badge variant={ACTION_PRIORITY_BADGE_VARIANT[pendingAction.priority]} size="sm">
              {ACTION_PRIORITY_LABEL[pendingAction.priority]}
            </Badge>
            <Badge variant="warning" size="sm">
              Awaiting your approval
            </Badge>
          </>
        }
        title={pendingAction.title}
        body={pendingAction.description}
      />
    );
  } else if (recommendation) {
    content = (
      <Cta
        href="/recommendations"
        cta="Open recommendation"
        icon={<Sparkles size={14} />}
        badges={
          <Badge variant={ACTION_TYPE_BADGE_VARIANT[recommendation.actionType]} size="sm">
            {ACTION_TYPE_LABEL[recommendation.actionType]}
          </Badge>
        }
        title={recommendation.title}
        body={recommendation.evidenceSummary}
      />
    );
  } else if (actions.status === "error" && rec.status === "error") {
    content = <PanelError onRetry={() => {
          actions.reload();
          rec.reload();
        }} />;
  } else {
    content = (
      <Cta
        href="/opportunities"
        cta="Open Opportunities"
        icon={<Sparkles size={14} />}
        title="Nothing queued yet"
        body="Recommendations are generated from an opportunity’s evidence — open one and generate its next action to see it here."
      />
    );
  }

  return (
    <motion.section variants={panelVariants} aria-label="Next action">
      <Card className="relative overflow-hidden border-accent/40 p-5">
        <div
          className="pointer-events-none absolute -right-16 -top-20 size-56 rounded-full ov-breathe"
          style={{ background: "radial-gradient(circle, color-mix(in oklab, var(--accent) 22%, transparent), transparent 70%)" }}
          aria-hidden="true"
        />
        <p className="relative font-mono text-[10.5px] font-medium uppercase tracking-[0.12em] text-accent mb-3">Do this next</p>
        <div className="relative">{content}</div>
      </Card>
    </motion.section>
  );
}

function Cta({
  href,
  cta,
  icon,
  badges,
  title,
  body,
}: {
  href: string;
  cta: string;
  icon: React.ReactNode;
  badges?: React.ReactNode;
  title: string;
  body?: string | null;
}) {
  return (
    <div className="flex flex-col gap-2.5">
      {badges && <div className="flex items-center gap-1.5 flex-wrap">{badges}</div>}
      <p className="font-display text-[17px] font-semibold text-foreground leading-snug line-clamp-2">{title}</p>
      {body && <p className="text-[12.5px] text-muted-foreground leading-relaxed line-clamp-2">{body}</p>}
      <Link
        href={href}
        className="group mt-1 inline-flex items-center gap-2 self-start h-10 rounded-lg bg-accent px-4 text-[13px] font-medium text-accent-foreground hover:bg-accent-hover transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised"
      >
        <span aria-hidden="true">{icon}</span>
        {cta}
        <ArrowRight size={14} className="transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
      </Link>
    </div>
  );
}
