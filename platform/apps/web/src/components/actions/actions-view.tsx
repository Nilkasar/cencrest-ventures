"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { CheckCircle2, Clock3, ListChecks, RotateCcw } from "lucide-react";
import { Button, Card, CardContent, EmptyState, Skeleton, Tabs, TabsContent, TabsList, TabsTrigger, useToast } from "@bebest/ui";
import { PageHeader } from "@/components/patterns/page-header";
import { ErrorPanel } from "@/components/patterns/error-panel";
import { useAsyncData } from "@/lib/use-async-data";
import { useSession } from "@/lib/session-context";
import { agentRunIdsByPendingActionId, approveAction, executeAction, getActionsOverview, rollbackAction } from "@/data/actions/client";
import type { ActionsOverview, ActionWithContext, PublishedContent } from "@/data/actions/types";
import type { AgentPendingAction } from "@/data/agents/types";
import { ActionCard } from "./action-card";

interface ActionsData {
  overview: ActionsOverview;
  agentRunIds: Map<string, string>;
  agentPendingActions: Map<string, AgentPendingAction>;
}

function ListSkeleton() {
  return (
    <div className="flex flex-col gap-3 p-5">
      {Array.from({ length: 3 }).map((_, i) => (
        <Skeleton key={i} className="h-28 w-full rounded-lg" />
      ))}
    </div>
  );
}

/** `GET /brands/me/actions` returns every section's `agentPendingActionId`
 *  already inlined, but not the `agentRunId` it belongs to (no such field
 *  or route exists — see `data/actions/client.ts`'s own comment). This
 *  screen resolves that once, up front, for every agent-originated action
 *  across all four sections in a single bounded join, rather than one join
 *  per row. */
async function loadActionsData(): Promise<ActionsData> {
  const overview = await getActionsOverview();
  const allActions = [...overview.pending, ...overview.inProgress, ...overview.completed, ...overview.rolledBack];
  const pendingActionIds = allActions.map((a) => a.agentPendingActionId).filter((id): id is string => id !== null);
  const { runIds: agentRunIds, pendingActions: agentPendingActions } = await agentRunIdsByPendingActionId(pendingActionIds);
  return { overview, agentRunIds, agentPendingActions };
}

/**
 * `docs/09-ux/CUSTOMER_JOURNEY.md`'s Actions screen — "What have I done and
 * what happened?" Four sections, exactly matching `GET /brands/me/actions`'s
 * own response shape: pending approvals, in-progress (approved, awaiting
 * execution — approve and execute are deliberately separate steps, spec
 * verbatim), completed (with outcome), rolled back. Calls
 * `platform/apps/api`'s real, tested Epic 13 routes from the first line, no
 * fixture layer — every mutation (`approveAction`/`executeAction`/
 * `rollbackAction`) hits the real endpoint and reloads from it afterward,
 * nothing is applied optimistically to local state as if it were the
 * source of truth.
 */
export function ActionsView() {
  const { org } = useSession();
  const { reload, ...state } = useAsyncData(loadActionsData, []);
  const { toast } = useToast();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [publishedContentByActionId, setPublishedContentByActionId] = useState<Map<string, PublishedContent>>(new Map());

  // `publish_content` is `owner`/`admin`-only server-side
  // (`docs/08-security/SECURITY.md`'s "Publish content" row) — this mirrors
  // that in the UI, same `currentUser.role`-gating convention
  // `billing-panel.tsx`/`integrations-panel.tsx` already establish for
  // their own owner/admin-only actions. The server's own 403 remains the
  // real enforcement if this hint is ever bypassed or stale.
  const myRole = org?.role ?? "member";
  const canPublish = myRole === "owner" || myRole === "admin";

  function rememberPublishedContent(actionId: string, publishedContent: PublishedContent | null) {
    if (!publishedContent) return;
    setPublishedContentByActionId((prev) => new Map(prev).set(actionId, publishedContent));
  }

  async function handleApprove(action: ActionWithContext) {
    setBusyId(action.id);
    try {
      const result = await approveAction(action.id);
      toast({
        title: result.alreadyApproved ? "Already approved" : "Action approved",
        description: result.alreadyApproved
          ? "This action was already approved — nothing changed."
          : "Ready to execute. Approving and executing are separate steps — nothing publishes until you execute it below.",
      });
      reload();
    } catch (err) {
      toast({ title: "Couldn't approve this action", description: err instanceof Error ? err.message : "Something went wrong — try again.", variant: "danger" });
    } finally {
      setBusyId(null);
    }
  }

  async function handleExecute(action: ActionWithContext) {
    setBusyId(action.id);
    try {
      const result = await executeAction(action.id);
      rememberPublishedContent(action.id, result.publishedContent);
      toast({
        title: result.alreadyExecuted ? "Already published" : "Published",
        description: result.alreadyExecuted
          ? "This action was already executed — nothing changed."
          : "Written to the internal publish record — no external CMS is connected yet, so nothing went out beyond this app.",
      });
      reload();
    } catch (err) {
      toast({ title: "Couldn't execute this action", description: err instanceof Error ? err.message : "Something went wrong — try again.", variant: "danger" });
    } finally {
      setBusyId(null);
    }
  }

  async function handleRollback(action: ActionWithContext) {
    const confirmed = window.confirm(`Roll back "${action.title}"? This reverts the published record — it doesn't un-approve the action itself.`);
    if (!confirmed) return;
    setBusyId(action.id);
    try {
      const result = await rollbackAction(action.id);
      rememberPublishedContent(action.id, result.publishedContent);
      toast({
        title: result.alreadyRolledBack ? "Already rolled back" : "Rolled back",
        description: result.alreadyRolledBack ? "This action was already rolled back — nothing changed." : "The published record has been reverted.",
      });
      reload();
    } catch (err) {
      toast({ title: "Couldn't roll back this action", description: err instanceof Error ? err.message : "Something went wrong — try again.", variant: "danger" });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Execution"
        title="Actions"
        description="What have I done and what happened? Pending approvals, in-progress work, completed publishes with their outcome, and anything rolled back. Nothing here ever publishes without your explicit approval (ADR-007)."
      />

      {state.status === "success" && !canPublish && (
        <p className="text-[12.5px] text-muted-foreground -mt-3 mb-5">
          You&apos;re viewing Actions as {myRole}. Only an organization owner or admin can approve, execute, or roll back — everyone else can still see what happened.
        </p>
      )}

      {state.status === "loading" && (
        <Card>
          <ListSkeleton />
        </Card>
      )}

      {state.status === "error" && (
        <Card>
          <CardContent className="p-5">
            <ErrorPanel message={state.error.message} onRetry={reload} />
          </CardContent>
        </Card>
      )}

      {state.status === "success" && (
        <Tabs defaultValue="pending">
          <TabsList>
            <TabsTrigger value="pending">Pending approval ({state.data.overview.pending.length})</TabsTrigger>
            <TabsTrigger value="inProgress">In progress ({state.data.overview.inProgress.length})</TabsTrigger>
            <TabsTrigger value="completed">Completed ({state.data.overview.completed.length})</TabsTrigger>
            <TabsTrigger value="rolledBack">Rolled back ({state.data.overview.rolledBack.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="pending">
            <Section
              items={state.data.overview.pending}
              emptyIcon={<ListChecks size={18} />}
              emptyTitle="No actions awaiting approval"
              emptyDescription="Actions are born from an approved content draft (Content screen) or a Level-3-approved agent action (Agents screen). Approve one there and it lands here, ready for a human sign-off before anything publishes."
              emptyAction={
                <Button asChild variant="secondary" size="sm">
                  <Link href="/content">Go to Content</Link>
                </Button>
              }
              emptySecondaryAction={
                <Button asChild variant="ghost" size="sm">
                  <Link href="/agents">Go to Agents</Link>
                </Button>
              }
              renderItem={(action) => (
                <ActionCard
                  key={action.id}
                  action={action}
                  agentRunId={action.agentPendingActionId ? state.data.agentRunIds.get(action.agentPendingActionId) : undefined}
                  agentPendingAction={action.agentPendingActionId ? state.data.agentPendingActions.get(action.agentPendingActionId) : undefined}
                  canPublish={canPublish}
                  busy={busyId === action.id}
                  onApprove={handleApprove}
                />
              )}
            />
          </TabsContent>

          <TabsContent value="inProgress">
            <Section
              items={state.data.overview.inProgress}
              emptyIcon={<Clock3 size={18} />}
              emptyTitle="Nothing approved and awaiting execution"
              emptyDescription="Once you approve a pending action above, it moves here until it's executed — approval and execution are deliberately separate steps, so a human might approve now and execute later."
              renderItem={(action) => (
                <ActionCard
                  key={action.id}
                  action={action}
                  agentRunId={action.agentPendingActionId ? state.data.agentRunIds.get(action.agentPendingActionId) : undefined}
                  agentPendingAction={action.agentPendingActionId ? state.data.agentPendingActions.get(action.agentPendingActionId) : undefined}
                  canPublish={canPublish}
                  busy={busyId === action.id}
                  onExecute={handleExecute}
                />
              )}
            />
          </TabsContent>

          <TabsContent value="completed">
            <Section
              items={state.data.overview.completed}
              emptyIcon={<CheckCircle2 size={18} />}
              emptyTitle="Nothing published yet"
              emptyDescription="Executed actions land here with their outcome — what was published, where, and when. Publishing today writes an internal record only; no external CMS is connected yet, matching every other epic's Null-provider boundary in this build."
              renderItem={(action) => (
                <ActionCard
                  key={action.id}
                  action={action}
                  agentRunId={action.agentPendingActionId ? state.data.agentRunIds.get(action.agentPendingActionId) : undefined}
                  agentPendingAction={action.agentPendingActionId ? state.data.agentPendingActions.get(action.agentPendingActionId) : undefined}
                  canPublish={canPublish}
                  busy={busyId === action.id}
                  publishedContent={publishedContentByActionId.get(action.id)}
                  onRollback={handleRollback}
                />
              )}
            />
          </TabsContent>

          <TabsContent value="rolledBack">
            <Section
              items={state.data.overview.rolledBack}
              emptyIcon={<RotateCcw size={18} />}
              emptyTitle="Nothing rolled back"
              emptyDescription="If a published action needs to be reverted within its 30-day window, it'll show up here with when it was rolled back."
              renderItem={(action) => (
                <ActionCard
                  key={action.id}
                  action={action}
                  agentRunId={action.agentPendingActionId ? state.data.agentRunIds.get(action.agentPendingActionId) : undefined}
                  agentPendingAction={action.agentPendingActionId ? state.data.agentPendingActions.get(action.agentPendingActionId) : undefined}
                  canPublish={canPublish}
                  busy={busyId === action.id}
                  publishedContent={publishedContentByActionId.get(action.id)}
                />
              )}
            />
          </TabsContent>
        </Tabs>
      )}
    </>
  );
}

function Section({
  items,
  renderItem,
  emptyIcon,
  emptyTitle,
  emptyDescription,
  emptyAction,
  emptySecondaryAction,
}: {
  items: ActionWithContext[];
  renderItem: (action: ActionWithContext) => ReactNode;
  emptyIcon: ReactNode;
  emptyTitle: string;
  emptyDescription: string;
  emptyAction?: ReactNode;
  emptySecondaryAction?: ReactNode;
}) {
  return (
    <Card>
      <CardContent className="p-0">
        {items.length === 0 ? (
          <div className="p-5">
            <EmptyState compact icon={emptyIcon} title={emptyTitle} description={emptyDescription} action={emptyAction} secondaryAction={emptySecondaryAction} />
          </div>
        ) : (
          <div className="divide-y divide-border">{items.map(renderItem)}</div>
        )}
      </CardContent>
    </Card>
  );
}
