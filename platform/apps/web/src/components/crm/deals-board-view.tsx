"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Handshake, Search, X } from "lucide-react";
import {
  Button,
  Card,
  CardContent,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Input,
  RefreshOverlay,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  useToast,
} from "@bebest/ui";
import { ErrorPanel } from "@/components/patterns/error-panel";
import { DealCard } from "@/components/crm/deal-card";
import { AddDealDialog } from "@/components/crm/add-deal-dialog";
import { fetchCrmUsers, fetchDeals, updateDealStage } from "@/data/crm/client";
import { DEAL_STAGE_LABEL, DEAL_STAGE_SEQUENCE, type Deal, type DealStage } from "@/data/crm/types";
import { useAsyncData } from "@/lib/use-async-data";
import { formatCompactCurrency, formatCurrency } from "@/lib/format";

const STAGE_HEADER_TONE: Record<DealStage, string> = {
  new: "",
  qualifying: "",
  proposal: "",
  negotiation: "",
  won: "bg-success-muted",
  lost: "bg-danger-muted",
};

function BoardSkeleton() {
  return (
    <div className="flex gap-4 overflow-x-auto pb-2">
      {DEAL_STAGE_SEQUENCE.map((stage) => (
        <div key={stage} className="w-72 shrink-0 flex flex-col gap-3">
          <Skeleton className="h-8 w-full rounded-lg" />
          <Skeleton className="h-24 w-full rounded-lg" />
          <Skeleton className="h-24 w-full rounded-lg" />
        </div>
      ))}
    </div>
  );
}

/** Every stage gets a column, including the empty ones — a board that
 *  hides "Negotiation" because nothing is in it stops being a pipeline. */
function groupByStage(deals: Deal[]): Map<DealStage, Deal[]> {
  const byStage = new Map<DealStage, Deal[]>();
  for (const stage of DEAL_STAGE_SEQUENCE) byStage.set(stage, []);
  for (const deal of deals) byStage.get(deal.stage)?.push(deal);
  return byStage;
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-subtle-foreground">{label}</p>
        <p className="font-mono text-[22px] font-semibold text-foreground mt-1">{value}</p>
      </CardContent>
    </Card>
  );
}

export function DealsBoardView() {
  const router = useRouter();
  const [ownerId, setOwnerId] = useState<string>("all");
  const [q, setQ] = useState("");
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverStage, setDragOverStage] = useState<DealStage | null>(null);
  const [lostPromptDealId, setLostPromptDealId] = useState<string | null>(null);
  const [lostReason, setLostReason] = useState("");
  const [lostSubmitting, setLostSubmitting] = useState(false);
  /** Stage moves applied locally, ahead of the server confirming them. */
  const [pendingStages, setPendingStages] = useState<Record<string, DealStage>>({});
  const { toast } = useToast();

  // Two requests, not four: each deal already carries the name of whatever
  // it is linked to (`deal.linkedTo`), so the whole leads list and the
  // whole accounts list no longer have to be fetched just to label cards.
  const { reload, ...state } = useAsyncData(async () => {
    const [deals, owners] = await Promise.all([fetchDeals({ ownerId, q }), fetchCrmUsers()]);
    return { deals, owners };
  }, [ownerId, q]);

  const hasFilters = ownerId !== "all" || q.trim() !== "";

  function clearFilters() {
    setOwnerId("all");
    setQ("");
  }

  // Optimistic: the card moves the instant it is dropped, and the server
  // call reconciles behind it. Waiting for the round trip before moving
  // anything made a drag feel broken — the card snapped back to its old
  // column for as long as the request took, then jumped.
  //
  // On failure the override is dropped, which restores the card to whatever
  // the last server response said, and a toast explains why.
  async function applyStageChange(dealId: string, stage: DealStage, reason?: string) {
    // Drop any override the server has already caught up with while adding
    // this one, so the map can't grow for the life of the session.
    setPendingStages((current) => {
      const server = new Map((dealsPage?.items ?? []).map((deal) => [deal.id, deal.stage]));
      const next: Record<string, DealStage> = {};
      for (const [id, pending] of Object.entries(current)) {
        if (server.get(id) !== pending) next[id] = pending;
      }
      next[dealId] = stage;
      return next;
    });
    try {
      await updateDealStage(dealId, stage, reason);
      reload();
    } catch (err) {
      setPendingStages((current) => {
        const next = { ...current };
        delete next[dealId];
        return next;
      });
      toast({
        title: "Couldn't move that deal",
        description:
          err instanceof Error ? err.message : "The stage change didn't save. Try again in a moment.",
        variant: "danger",
      });
    }
  }

  function handleMoveStage(dealId: string, stage: DealStage) {
    if (stage === "lost") {
      setLostReason("");
      setLostPromptDealId(dealId);
      return;
    }
    void applyStageChange(dealId, stage);
  }

  function closeLostPrompt() {
    setLostPromptDealId(null);
    setLostReason("");
  }

  async function confirmLostReason() {
    if (!lostPromptDealId) return;
    setLostSubmitting(true);
    try {
      await applyStageChange(lostPromptDealId, "lost", lostReason.trim() || undefined);
      closeLostPrompt();
    } finally {
      setLostSubmitting(false);
    }
  }

  function handleDrop(stage: DealStage) {
    setDragOverStage(null);
    if (!draggingId) return;
    const dealId = draggingId;
    setDraggingId(null);
    handleMoveStage(dealId, stage);
  }

  const dealsPage = state.status === "success" ? state.data.deals : null;

  // Optimistic overrides applied on top of the server's answer, so a card
  // sits in its new column from the moment it is dropped rather than
  // snapping back for the length of the round trip.
  //
  // Reconciliation happens here, during render, rather than in an effect:
  // an override is simply ignored once the server reports the same stage,
  // so there is no state to synchronize and no extra render pass. Entries
  // that have been overtaken are pruned in `applyStageChange`.
  // Plain computations, not `useMemo`: the React Compiler memoizes this
  // component, and hand-written dependency arrays here conflict with it
  // (`react-hooks/preserve-manual-memoization`).
  const dealList = (dealsPage?.items ?? []).map((deal) => {
    const pending = pendingStages[deal.id];
    return pending && pending !== deal.stage ? { ...deal, stage: pending } : deal;
  });

  const columns = dealsPage ? groupByStage(dealList) : null;

  function linkedInfo(deal: Deal): { name: string | null; href: string | null } {
    if (!deal.linkedTo) return { name: null, href: null };
    const { kind, id, name } = deal.linkedTo;
    return { name, href: kind === "account" ? `/crm/accounts/${id}` : `/crm/leads/${id}` };
  }

  const openDeals = dealList.filter((d) => d.stage !== "won" && d.stage !== "lost");
  const totalOpenValue = openDeals.reduce((sum, d) => sum + d.valueCents, 0);
  const weightedValue = openDeals.reduce((sum, d) => sum + (d.valueCents * d.probability) / 100, 0);
  const wonValue = dealList.filter((d) => d.stage === "won").reduce((sum, d) => sum + d.valueCents, 0);

  return (
    <div className="flex flex-col gap-6">
      {dealsPage && dealsPage.items.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <StatCard label="Open pipeline" value={formatCompactCurrency(totalOpenValue)} />
          <StatCard label="Weighted (open)" value={formatCompactCurrency(weightedValue)} />
          <StatCard label="Won" value={formatCompactCurrency(wonValue)} />
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-subtle-foreground" aria-hidden="true" />
          <Input placeholder="Search deals" value={q} onChange={(event) => setQ(event.target.value)} className="pl-8" aria-label="Search deals" />
        </div>
        <Select value={ownerId} onValueChange={setOwnerId}>
          <SelectTrigger className="w-full sm:w-44" aria-label="Filter by owner">
            <SelectValue placeholder="All owners" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All owners</SelectItem>
            {state.status === "success" &&
              state.data.owners.map((owner) => (
                <SelectItem key={owner.id} value={owner.id}>
                  {owner.name}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            <X size={14} /> Clear
          </Button>
        )}
        <div className="sm:ml-auto">
          <AddDealDialog onCreated={() => reload()} />
        </div>
      </div>

      {state.status === "loading" && <BoardSkeleton />}

      {state.status === "error" && <ErrorPanel message={state.error.message} onRetry={reload} />}

      {dealsPage && dealsPage.items.length === 0 && !hasFilters && (
        <EmptyState
          icon={<Handshake size={20} />}
          eyebrow="Deals"
          title="No deals yet"
          description="Convert a qualified lead into a deal, or start one directly against an existing account."
          action={<AddDealDialog onCreated={() => reload()} />}
          secondaryAction={
            <Button variant="ghost" size="sm" onClick={() => router.push("/crm/leads")}>
              Go to leads
            </Button>
          }
        />
      )}

      {dealsPage && dealsPage.items.length === 0 && hasFilters && (
        <EmptyState
          compact
          icon={<Search size={18} />}
          title="No deals match these filters"
          description="Try a different owner or search term."
          action={
            <Button variant="secondary" size="sm" onClick={clearFilters}>
              Clear filters
            </Button>
          }
        />
      )}

      {dealsPage && dealsPage.items.length > 0 && columns && (
        <RefreshOverlay
          active={state.isRefreshing && draggingId === null}
          className="flex gap-4 overflow-x-auto pb-2 -mx-1 px-1"
        >
          {DEAL_STAGE_SEQUENCE.map((stage) => {
            const dealsInStage = columns.get(stage) ?? [];
            const stageValue = dealsInStage.reduce((sum, d) => sum + d.valueCents, 0);
            const isDropTarget = draggingId !== null && dragOverStage === stage;
            return (
              <div
                key={stage}
                className="w-72 shrink-0 flex flex-col gap-3"
                onDragOver={(event) => {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                  if (dragOverStage !== stage) setDragOverStage(stage);
                }}
                onDragLeave={(event) => {
                  // Only when the pointer leaves the column itself, not when
                  // it crosses between the cards inside it.
                  if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                    setDragOverStage((current) => (current === stage ? null : current));
                  }
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  handleDrop(stage);
                }}
              >
                <div
                  className={`flex items-center justify-between rounded-lg border px-3 py-2 transition-colors duration-150 motion-reduce:transition-none ${
                    isDropTarget ? "border-accent bg-accent-muted" : "border-border"
                  } ${STAGE_HEADER_TONE[stage]}`}
                >
                  <div className="flex items-center gap-2">
                    <p className="text-[12.5px] font-semibold text-foreground">{DEAL_STAGE_LABEL[stage]}</p>
                    <span className="font-mono text-[11px] text-subtle-foreground">{dealsInStage.length}</span>
                  </div>
                  <span className="font-mono text-[11.5px] text-muted-foreground">{formatCurrency(stageValue)}</span>
                </div>
                <div
                  className={`flex flex-col gap-2.5 min-h-[80px] rounded-lg transition-colors duration-150 motion-reduce:transition-none ${
                    isDropTarget ? "bg-accent-muted/40 ring-1 ring-accent/40" : ""
                  }`}
                >
                  {dealsInStage.length === 0 && (
                    <div
                      className={`rounded-lg border border-dashed py-6 text-center transition-colors duration-150 motion-reduce:transition-none ${
                        isDropTarget ? "border-accent text-accent" : "border-border"
                      }`}
                    >
                      <p className="text-[12px] text-subtle-foreground">Drop a deal here</p>
                    </div>
                  )}
                  {dealsInStage.map((deal) => {
                    const info = linkedInfo(deal);
                    return (
                      <DealCard
                        key={deal.id}
                        deal={deal}
                        linkedName={info.name}
                        linkedHref={info.href}
                        isDragging={draggingId === deal.id}
                        isPending={pendingStages[deal.id] !== undefined}
                        onDragStart={setDraggingId}
                        onDragEnd={() => {
                          setDraggingId(null);
                          setDragOverStage(null);
                        }}
                        onMoveStage={handleMoveStage}
                      />
                    );
                  })}
                </div>
              </div>
            );
          })}
        </RefreshOverlay>
      )}

      <Dialog
        open={lostPromptDealId !== null}
        onOpenChange={(next) => {
          if (!next) closeLostPrompt();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Why was this lost?</DialogTitle>
            <DialogDescription>Capture a reason before moving this deal to Lost. It&apos;s recorded in the audit log.</DialogDescription>
          </DialogHeader>
          <Input
            placeholder="e.g. Went with an incumbent agency"
            value={lostReason}
            onChange={(event) => setLostReason(event.target.value)}
            autoFocus
            required
          />
          <DialogFooter>
            <Button type="button" variant="ghost" size="sm" onClick={closeLostPrompt}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="danger"
              size="sm"
              loading={lostSubmitting}
              disabled={!lostReason.trim()}
              onClick={confirmLostReason}
            >
              Mark lost
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
