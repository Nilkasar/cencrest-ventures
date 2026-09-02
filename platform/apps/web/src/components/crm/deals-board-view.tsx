"use client";

import { useMemo, useState } from "react";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
} from "@bebest/ui";
import { ErrorPanel } from "@/components/patterns/error-panel";
import { DealCard } from "@/components/crm/deal-card";
import { AddDealDialog } from "@/components/crm/add-deal-dialog";
import { fetchAccounts, fetchCrmUsers, fetchDeals, fetchLeads, updateDealStage } from "@/data/crm/client";
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
  const [lostPromptDealId, setLostPromptDealId] = useState<string | null>(null);
  const [lostReason, setLostReason] = useState("");
  const [lostSubmitting, setLostSubmitting] = useState(false);

  const { reload, ...state } = useAsyncData(async () => {
    const [dealsData, leads, accounts, owners] = await Promise.all([
      fetchDeals({ ownerId, q }),
      fetchLeads(),
      fetchAccounts(),
      fetchCrmUsers(),
    ]);
    return { deals: dealsData, leads, accounts, owners };
  }, [ownerId, q]);

  const hasFilters = ownerId !== "all" || q.trim() !== "";

  function clearFilters() {
    setOwnerId("all");
    setQ("");
  }

  async function handleMoveStage(dealId: string, stage: DealStage) {
    await updateDealStage(dealId, stage, stage === "lost" ? "Moved from board — reason not captured." : undefined);
    reload();
  }

  function handleDrop(stage: DealStage) {
    if (!draggingId) return;
    const dealId = draggingId;
    setDraggingId(null);
    handleMoveStage(dealId, stage);
  }

  const columns = useMemo(() => {
    if (state.status !== "success") return null;
    const byStage = new Map<DealStage, Deal[]>();
    for (const stage of DEAL_STAGE_SEQUENCE) byStage.set(stage, []);
    for (const deal of state.data.deals) byStage.get(deal.stage)?.push(deal);
    return byStage;
  }, [state]);

  function linkedInfo(deal: Deal): { name: string | null; href: string | null } {
    if (state.status !== "success") return { name: null, href: null };
    if (deal.organizationId) {
      const account = state.data.accounts.find((a) => a.id === deal.organizationId);
      if (account) return { name: account.name, href: `/crm/accounts/${account.id}` };
    }
    if (deal.leadId) {
      const lead = state.data.leads.find((l) => l.id === deal.leadId);
      if (lead) return { name: lead.company ?? lead.name, href: `/crm/leads/${lead.id}` };
    }
    return { name: null, href: null };
  }

  const totalOpenValue = state.status === "success"
    ? state.data.deals.filter((d) => d.stage !== "won" && d.stage !== "lost").reduce((sum, d) => sum + d.valueCents, 0)
    : 0;
  const weightedValue = state.status === "success"
    ? state.data.deals
        .filter((d) => d.stage !== "won" && d.stage !== "lost")
        .reduce((sum, d) => sum + (d.valueCents * d.probability) / 100, 0)
    : 0;
  const wonValue = state.status === "success"
    ? state.data.deals.filter((d) => d.stage === "won").reduce((sum, d) => sum + d.valueCents, 0)
    : 0;

  return (
    <div className="flex flex-col gap-6">
      {state.status === "success" && state.data.deals.length > 0 && (
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

      {state.status === "success" && state.data.deals.length === 0 && !hasFilters && (
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

      {state.status === "success" && state.data.deals.length === 0 && hasFilters && (
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

      {state.status === "success" && state.data.deals.length > 0 && columns && (
        <div className="flex gap-4 overflow-x-auto pb-2 -mx-1 px-1">
          {DEAL_STAGE_SEQUENCE.map((stage) => {
            const dealsInStage = columns.get(stage) ?? [];
            const stageValue = dealsInStage.reduce((sum, d) => sum + d.valueCents, 0);
            return (
              <div
                key={stage}
                className="w-72 shrink-0 flex flex-col gap-3"
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  handleDrop(stage);
                }}
              >
                <div className={`flex items-center justify-between rounded-lg border border-border px-3 py-2 ${STAGE_HEADER_TONE[stage]}`}>
                  <div className="flex items-center gap-2">
                    <p className="text-[12.5px] font-semibold text-foreground">{DEAL_STAGE_LABEL[stage]}</p>
                    <span className="font-mono text-[11px] text-subtle-foreground">{dealsInStage.length}</span>
                  </div>
                  <span className="font-mono text-[11.5px] text-muted-foreground">{formatCurrency(stageValue)}</span>
                </div>
                <div className="flex flex-col gap-2.5 min-h-[80px]">
                  {dealsInStage.length === 0 && (
                    <div className="rounded-lg border border-dashed border-border py-6 text-center">
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
                        onDragStart={setDraggingId}
                        onMoveStage={handleMoveStage}
                      />
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
