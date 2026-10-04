"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { CheckCircle2, Clock3, Info, ListChecks, RotateCcw, Upload } from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  RefreshOverlay,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  useToast,
} from "@bebest/ui";
import { ErrorPanel } from "@/components/patterns/error-panel";
import { PageStack, Reveal } from "@/components/patterns/motion";
import { Section } from "@/components/patterns/section";
import { StatGrid, StatTile } from "@/components/patterns/stat-tile";
import { useAsyncData } from "@/lib/use-async-data";
import { useSession } from "@/lib/session-context";
import { agentRunIdsByPendingActionId, approveAction, executeAction, getActionsOverview, rollbackAction } from "@/data/actions/client";
import type { ActionsOverview, ActionWithContext, PublishedContent } from "@/data/actions/types";
import type { AgentPendingAction } from "@/data/agents/types";
import { formatNumber } from "@/lib/format";
import { ActionCard } from "./action-card";

interface ActionsData {
  overview: ActionsOverview;
  agentRunIds: Map<string, string>;
  agentPendingActions: Map<string, AgentPendingAction>;
}

type TabKey = keyof ActionsOverview;
const TAB_ORDER: TabKey[] = ["pending", "inProgress", "completed", "rolledBack"];

/** `GET /brands/me/actions` inlines every row's `agentPendingActionId` but
 *  not the run it belongs to; resolve that once, up front, for every
 *  agent-originated action across all four sections in one bounded join. */
async function loadActionsData(): Promise<ActionsData> {
  const overview = await getActionsOverview();
  const allActions = [...overview.pending, ...overview.inProgress, ...overview.completed, ...overview.rolledBack];
  const pendingActionIds = allActions.map((a) => a.agentPendingActionId).filter((id): id is string => id !== null);
  const { runIds: agentRunIds, pendingActions: agentPendingActions } = await agentRunIdsByPendingActionId(pendingActionIds);
  return { overview, agentRunIds, agentPendingActions };
}

function ListSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true">
      <span className="sr-only">Loading actions…</span>
      <Skeleton className="h-10 w-full max-w-[520px]" />
      <div className="divide-y divide-border rounded-xl border border-border bg-surface-raised shadow-sm" aria-hidden="true">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex gap-4 px-5 py-4">
            <Skeleton className="hidden size-9 shrink-0 rounded-lg sm:block" />
            <div className="flex flex-1 flex-col gap-2.5">
              <div className="flex justify-between gap-4">
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-8 w-24 rounded-md" />
              </div>
              <Skeleton className="h-3 w-64" />
              <Skeleton className="h-16 w-full rounded-lg" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * The Actions screen — `docs/09-ux/CUSTOMER_JOURNEY.md`: "What have I done
 * and what happened?" The four sections of `GET /brands/me/actions`, in
 * lifecycle order: awaiting approval → approved, ready to execute
 * (approve and execute are deliberately separate steps) → published, with
 * its measured outcome → rolled back. Every mutation hits the real
 * endpoint and reloads from it; nothing is applied optimistically.
 */
export function ActionsView() {
  const { org } = useSession();
  const { reload, ...state } = useAsyncData(loadActionsData, []);
  const { toast } = useToast();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [publishedContentByActionId, setPublishedContentByActionId] = useState<Map<string, PublishedContent>>(new Map());
  const [tab, setTab] = useState<TabKey | null>(null);
  const [confirmRollback, setConfirmRollback] = useState<ActionWithContext | null>(null);

  // `publish_content` is `owner`/`admin`-only server-side
  // (`docs/08-security/SECURITY.md`). This mirrors it in the UI; the
  // server's 403 remains the real enforcement.
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
          : "It's now under Ready to execute. Nothing publishes until you execute it.",
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
          : "Written to the internal publish record — no external CMS is connected yet, so nothing left this app.",
      });
      reload();
    } catch (err) {
      toast({ title: "Couldn't execute this action", description: err instanceof Error ? err.message : "Something went wrong — try again.", variant: "danger" });
    } finally {
      setBusyId(null);
    }
  }

  async function runRollback(action: ActionWithContext) {
    setConfirmRollback(null);
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

  const data = state.status === "success" ? state.data : null;
  const overview = data?.overview;
  const total = overview ? TAB_ORDER.reduce((n, key) => n + overview[key].length, 0) : 0;
  const firstRun = overview !== undefined && total === 0;
  // Open on the first section that has something in it — usually the
  // approvals queue — unless the person has picked a tab.
  const activeTab: TabKey = tab ?? (overview ? (TAB_ORDER.find((key) => overview[key].length > 0) ?? "pending") : "pending");

  function card(action: ActionWithContext, handlers: Partial<Pick<Parameters<typeof ActionCard>[0], "onApprove" | "onExecute" | "onRollback">>) {
    return (
      <li key={action.id}>
        <ActionCard
          action={action}
          agentRunId={action.agentPendingActionId ? data!.agentRunIds.get(action.agentPendingActionId) : undefined}
          agentPendingAction={action.agentPendingActionId ? data!.agentPendingActions.get(action.agentPendingActionId) : undefined}
          canPublish={canPublish}
          busy={busyId === action.id}
          publishedContent={publishedContentByActionId.get(action.id)}
          {...handlers}
        />
      </li>
    );
  }

  return (
    <PageStack>
      {state.status === "loading" && (
        <Reveal>
          <ListSkeleton />
        </Reveal>
      )}

      {state.status === "error" && (
        <Reveal>
          <ErrorPanel title="Actions didn't load" message={state.error.message} onRetry={reload} />
        </Reveal>
      )}

      {firstRun && (
        <Reveal>
          <EmptyState
            icon={<ListChecks size={20} />}
            title="No actions yet"
            description="Actions are created when you approve a content draft or a Level 3 agent proposal. Each one waits here for a human sign-off before anything publishes."
            action={
              <Button variant="primary" size="sm" asChild>
                <Link href="/content">Review content drafts</Link>
              </Button>
            }
            secondaryAction={
              <Button variant="ghost" size="sm" asChild>
                <Link href="/agents">Go to Agents</Link>
              </Button>
            }
          />
        </Reveal>
      )}

      {overview && !firstRun && (
        <>
          <StatGrid>
            <StatTile label="Awaiting approval" icon={<Clock3 size={13} />} value={formatNumber(overview.pending.length)} hint="Needs a human sign-off" />
            <StatTile label="Ready to execute" icon={<Upload size={13} />} value={formatNumber(overview.inProgress.length)} hint="Approved, not yet published" />
            <StatTile label="Published" icon={<CheckCircle2 size={13} />} value={formatNumber(overview.completed.length)} hint="With measured outcome" />
            <StatTile label="Rolled back" icon={<RotateCcw size={13} />} value={formatNumber(overview.rolledBack.length)} hint="Reverted within 30 days" />
          </StatGrid>

          {!canPublish && (
            <Reveal>
              <div className="flex items-start gap-2.5 rounded-lg border border-info/25 bg-info-muted px-4 py-3">
                <Info size={15} className="mt-0.5 shrink-0 text-info" aria-hidden="true" />
                <p className="text-[13px] leading-relaxed text-foreground">
                  You&apos;re viewing as <span className="font-medium">{myRole}</span>. Only an owner or admin can approve, execute or roll back — you can still see
                  everything that happened.
                </p>
              </div>
            </Reveal>
          )}

          <Reveal>
            <Tabs value={activeTab} onValueChange={(v) => setTab(v as TabKey)}>
              <TabsList variant="underline" aria-label="Action lifecycle">
                <TabsTrigger value="pending">
                  Awaiting approval <Count n={overview.pending.length} />
                </TabsTrigger>
                <TabsTrigger value="inProgress">
                  Ready to execute <Count n={overview.inProgress.length} />
                </TabsTrigger>
                <TabsTrigger value="completed">
                  Published <Count n={overview.completed.length} />
                </TabsTrigger>
                <TabsTrigger value="rolledBack">
                  Rolled back <Count n={overview.rolledBack.length} />
                </TabsTrigger>
              </TabsList>

              <RefreshOverlay active={state.isRefreshing} className="mt-5">
                <TabsContent value="pending" className="mt-0">
                  <ActionList
                    items={overview.pending}
                    render={(a) => card(a, { onApprove: handleApprove })}
                    title="Awaiting approval"
                    description="Approving moves an action to Ready to execute. It doesn't publish anything."
                    empty={{
                      icon: <ListChecks size={18} />,
                      title: "Nothing awaiting approval",
                      description: "New actions arrive when a content draft or a Level 3 agent proposal is approved.",
                      action: (
                        <Button variant="secondary" size="sm" asChild>
                          <Link href="/content">Go to Content</Link>
                        </Button>
                      ),
                    }}
                  />
                </TabsContent>
                <TabsContent value="inProgress" className="mt-0">
                  <ActionList
                    items={overview.inProgress}
                    render={(a) => card(a, { onExecute: handleExecute })}
                    title="Ready to execute"
                    description="Approved and waiting. Executing writes the publish record and starts a 30-day rollback window."
                    empty={{
                      icon: <Upload size={18} />,
                      title: "Nothing waiting to execute",
                      description: "Approve an action and it waits here — approval and execution are separate steps, so you can approve now and publish later.",
                    }}
                  />
                </TabsContent>
                <TabsContent value="completed" className="mt-0">
                  <ActionList
                    items={overview.completed}
                    render={(a) => card(a, { onRollback: (action) => setConfirmRollback(action) })}
                    title="Published"
                    description="What went out, where and when — and whether it moved your score."
                    empty={{
                      icon: <CheckCircle2 size={18} />,
                      title: "Nothing published yet",
                      description: "Executed actions land here with their outcome. Publishing currently writes an internal record only — no external CMS is connected.",
                    }}
                  />
                </TabsContent>
                <TabsContent value="rolledBack" className="mt-0">
                  <ActionList
                    items={overview.rolledBack}
                    render={(a) => card(a, {})}
                    title="Rolled back"
                    description="Published actions reverted within their 30-day window."
                    empty={{
                      icon: <RotateCcw size={18} />,
                      title: "Nothing rolled back",
                      description: "If a published action is reverted within its 30-day window, it appears here with when it happened.",
                    }}
                  />
                </TabsContent>
              </RefreshOverlay>
            </Tabs>
          </Reveal>
        </>
      )}

      <Dialog open={confirmRollback !== null} onOpenChange={(open) => !open && setConfirmRollback(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Roll back this action?</DialogTitle>
            <DialogDescription>
              {confirmRollback ? `“${confirmRollback.title}” — ` : ""}this reverts the published record. It doesn&apos;t un-approve the action, and any outcome
              already measured stays on record.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setConfirmRollback(null)}>
              Cancel
            </Button>
            <Button variant="danger" size="sm" onClick={() => confirmRollback && runRollback(confirmRollback)}>
              <RotateCcw size={14} aria-hidden="true" /> Roll back
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageStack>
  );
}

function Count({ n }: { n: number }) {
  return <span className="ml-1.5 rounded-full bg-surface px-1.5 font-mono text-[10.5px] tabular-nums text-muted-foreground">{n}</span>;
}

function ActionList({
  items,
  render,
  title,
  description,
  empty,
}: {
  items: ActionWithContext[];
  render: (action: ActionWithContext) => ReactNode;
  title: string;
  description: string;
  empty: { icon: ReactNode; title: string; description: string; action?: ReactNode };
}) {
  if (items.length === 0) {
    return <EmptyState compact icon={empty.icon} title={empty.title} description={empty.description} action={empty.action} />;
  }
  return (
    <Section flush title={title} description={description}>
      <ul className="divide-y divide-border">{items.map(render)}</ul>
    </Section>
  );
}
