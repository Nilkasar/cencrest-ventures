"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CircleDollarSign, Handshake, Kanban, List, Scale, Trophy, Target } from "lucide-react";
import {
  Avatar,
  Button,
  EmptyState,
  RefreshOverlay,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  cn,
  getInitials,
  useToast,
} from "@bebest/ui";
import { ErrorPanel } from "@/components/patterns/error-panel";
import { PageStack, Reveal } from "@/components/patterns/motion";
import { StatGrid, StatTile } from "@/components/patterns/stat-tile";
import {
  ClearFiltersButton,
  FilterSelect,
  ResultCount,
  Toolbar,
  ToolbarSearch,
  ViewToggle,
  type FilterOption,
} from "@/components/patterns/toolbar";
import { BoardColumn, BoardColumnEmpty } from "@/components/patterns/layout";
import { CellLink, ClickableRow, SortableHead, TableSkeleton, type SkeletonColumn, type SortDirection } from "@/components/patterns/data-table";
import { NoResults } from "@/components/patterns/states";
import { typography } from "@/components/patterns/typography";
import { DealCard } from "@/components/crm/deal-card";
import { DealMoveMenu } from "@/components/crm/deal-move-menu";
import { DealCloseDate, isOpenStage, pipelineTotals } from "@/components/crm/deal-utils";
import { AddDealDialog } from "@/components/crm/add-deal-dialog";
import { LostReasonDialog } from "@/components/crm/lost-reason-dialog";
import { DealStageBadge } from "@/components/crm/status-badges";
import { fetchCrmUsers, fetchDeals, updateDealStage } from "@/data/crm/client";
import { DEAL_STAGE_LABEL, DEAL_STAGE_SEQUENCE, type Deal, type DealStage } from "@/data/crm/types";
import { useAsyncData } from "@/lib/use-async-data";
import { useCrmBasePath } from "@/components/crm/crm-base-path";
import { formatCompactCurrency, formatCurrency, formatNumber, formatPercent } from "@/lib/format";

type View = "board" | "list";
type SortKey = "value" | "close";

const VIEW_OPTIONS = [
  { value: "board" as const, label: "Board", icon: <Kanban size={14} /> },
  { value: "list" as const, label: "List", icon: <List size={14} /> },
];

const LIST_COLUMNS: SkeletonColumn[] = [
  { header: "Deal", cell: "entity" },
  { header: "Stage", cell: "badge" },
  { header: "Value", cell: "number", align: "right" },
  { header: "Prob.", cell: "number", align: "right" },
  { header: "Owner", cell: "text" },
  { header: "Expected close", cell: "meta" },
  { header: "", cell: "meta" },
];

function BoardSkeleton() {
  return (
    <div aria-busy="true" className="flex gap-4 overflow-hidden pb-2">
      <span className="sr-only">Loading pipeline…</span>
      {DEAL_STAGE_SEQUENCE.map((stage, i) => (
        <div key={stage} className="flex w-[264px] shrink-0 flex-col gap-2.5" aria-hidden="true">
          <Skeleton className="h-10 w-full rounded-lg" />
          {Array.from({ length: i % 3 === 0 ? 2 : 1 }).map((_, j) => (
            <Skeleton key={j} className="h-[118px] w-full rounded-xl" />
          ))}
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

function sortDeals(deals: Deal[], key: SortKey | null, direction: SortDirection): Deal[] {
  if (!key || !direction) return deals;
  const factor = direction === "asc" ? 1 : -1;
  return [...deals].sort((a, b) => {
    if (key === "value") return (a.valueCents - b.valueCents) * factor;
    // Deals without a close date sink to the bottom either way.
    if (!a.expectedCloseDate) return b.expectedCloseDate ? 1 : 0;
    if (!b.expectedCloseDate) return -1;
    return a.expectedCloseDate.localeCompare(b.expectedCloseDate) * factor;
  });
}

export function DealsBoardView() {
  const crm = useCrmBasePath();
  const router = useRouter();
  const [view, setView] = useState<View>("board");
  const [ownerId, setOwnerId] = useState<string>("all");
  const [searchInput, setSearchInput] = useState("");
  const [q, setQ] = useState("");
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverStage, setDragOverStage] = useState<DealStage | null>(null);
  const [lostPromptDealId, setLostPromptDealId] = useState<string | null>(null);
  /** Stage moves applied locally, ahead of the server confirming them. */
  const [pendingStages, setPendingStages] = useState<Record<string, DealStage>>({});
  const { toast } = useToast();

  // Search is debounced like the other CRM lists, so typing a company name
  // is one request rather than one per keystroke.
  useEffect(() => {
    const handle = setTimeout(() => setQ(searchInput), 250);
    return () => clearTimeout(handle);
  }, [searchInput]);

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
    setSearchInput("");
    setQ("");
  }

  const dealsPage = state.status === "success" ? state.data.deals : null;

  // Optimistic: the card moves the instant it is dropped, and the server
  // call reconciles behind it. On failure the override is dropped, which
  // restores the card to whatever the last server response said, and a
  // toast explains why.
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
        description: err instanceof Error ? err.message : "The stage change didn't save. Try again in a moment.",
        variant: "danger",
      });
    }
  }

  function handleMoveStage(dealId: string, stage: DealStage) {
    if (stage === "lost") {
      setLostPromptDealId(dealId);
      return;
    }
    void applyStageChange(dealId, stage);
  }

  function handleDrop(stage: DealStage) {
    setDragOverStage(null);
    if (!draggingId) return;
    const dealId = draggingId;
    setDraggingId(null);
    const current = dealList.find((d) => d.id === dealId)?.stage;
    if (current === stage) return;
    handleMoveStage(dealId, stage);
  }

  function toggleSort(key: SortKey) {
    if (sortKey !== key) {
      setSortKey(key);
      setSortDirection(key === "value" ? "desc" : "asc");
      return;
    }
    // asc → desc → off (or desc → asc → off)
    const first = key === "value" ? "desc" : "asc";
    if (sortDirection === first) setSortDirection(first === "asc" ? "desc" : "asc");
    else {
      setSortKey(null);
      setSortDirection(false);
    }
  }

  // Optimistic overrides applied on top of the server's answer, reconciled
  // during render: an override is ignored once the server reports the same
  // stage. Plain computations, not `useMemo` — the React Compiler memoizes
  // this component (`react-hooks/preserve-manual-memoization`).
  const dealList = (dealsPage?.items ?? []).map((deal) => {
    const pending = pendingStages[deal.id];
    return pending && pending !== deal.stage ? { ...deal, stage: pending } : deal;
  });

  const columns = dealsPage ? groupByStage(dealList) : null;
  const totals = pipelineTotals(dealList);
  const truncated = dealsPage !== null && dealsPage.total > dealsPage.items.length;
  const firstRun = dealsPage !== null && dealsPage.total === 0 && !hasFilters;
  const lostDeal = lostPromptDealId ? dealList.find((d) => d.id === lostPromptDealId) : null;

  const ownerOptions: FilterOption<string>[] = [
    { value: "all", label: "All owners" },
    ...(state.status === "success" ? state.data.owners.map((owner) => ({ value: owner.id, label: owner.name })) : []),
  ];

  function linkedInfo(deal: Deal): { name: string | null; href: string | null } {
    if (!deal.linkedTo) return { name: null, href: null };
    const { kind, id, name } = deal.linkedTo;
    return { name, href: kind === "account" ? `${crm}/accounts/${id}` : `${crm}/leads/${id}` };
  }

  const statsLoading = !dealsPage;
  const scope = hasFilters ? "Matching these filters" : null;

  return (
    <PageStack>
      {!firstRun && state.status !== "error" && (
        <StatGrid>
          <StatTile
            label="Open pipeline"
            icon={<CircleDollarSign size={13} />}
            loading={statsLoading}
            value={formatCompactCurrency(totals.openValue)}
            hint={scope ?? `${formatNumber(totals.openCount)} open ${totals.openCount === 1 ? "deal" : "deals"}`}
          />
          <StatTile
            label="Weighted forecast"
            icon={<Scale size={13} />}
            loading={statsLoading}
            value={formatCompactCurrency(totals.weightedValue)}
            hint="Open value × win probability"
          />
          <StatTile
            label="Won"
            icon={<Trophy size={13} />}
            loading={statsLoading}
            value={formatCompactCurrency(totals.wonValue)}
            hint={`${formatNumber(totals.wonCount)} closed-won ${totals.wonCount === 1 ? "deal" : "deals"}`}
          />
          <StatTile
            label="Win rate"
            icon={<Target size={13} />}
            loading={statsLoading}
            value={totals.winRate === null ? "—" : formatPercent(totals.winRate)}
            muted={totals.winRate === null}
            hint={
              totals.winRate === null
                ? "Appears once a deal closes"
                : `${formatNumber(totals.wonCount)} won of ${formatNumber(totals.wonCount + totals.lostCount)} closed`
            }
          />
        </StatGrid>
      )}

      {!firstRun && (
        <Toolbar
          end={
            <>
              {dealsPage && <ResultCount count={dealsPage.total} noun="deal" />}
              <ViewToggle value={view} onChange={setView} options={VIEW_OPTIONS} label="Deals view" />
              <AddDealDialog onCreated={() => reload()} />
            </>
          }
        >
          <ToolbarSearch value={searchInput} onChange={setSearchInput} placeholder="Search deals, accounts, leads" label="Search deals" />
          <FilterSelect value={ownerId} onValueChange={setOwnerId} options={ownerOptions} label="Filter by owner" className="sm:w-44" />
          {hasFilters && <ClearFiltersButton onClick={clearFilters} />}
        </Toolbar>
      )}

      <Reveal>
        {state.status === "loading" &&
          (view === "board" ? <BoardSkeleton /> : <TableSkeleton columns={LIST_COLUMNS} label="Loading deals…" />)}

        {state.status === "error" && <ErrorPanel title="Deals didn't load" message={state.error.message} onRetry={reload} />}

        {firstRun && (
          <EmptyState
            icon={<Handshake size={20} />}
            title="No deals yet"
            description="Deals track an engagement from first conversation to signed contract. Start one against a qualified lead or an existing account."
            action={<AddDealDialog onCreated={() => reload()} />}
            secondaryAction={
              <Button variant="ghost" size="sm" onClick={() => router.push(`${crm}/leads`)}>
                Go to leads
              </Button>
            }
          />
        )}

        {dealsPage && dealsPage.items.length === 0 && hasFilters && (
          <NoResults noun="deals" onClear={clearFilters} hint="Try a different owner or search term." />
        )}

        {dealsPage && dealsPage.items.length > 0 && columns && (
          <div className="flex flex-col gap-3">
            {truncated && (
              <p className={cn(typography.meta, "rounded-lg border border-border bg-surface px-3 py-2")} role="note">
                Showing the first {formatNumber(dealsPage.items.length)} of {formatNumber(dealsPage.total)} deals. Totals above cover the
                deals shown — search or filter by owner to narrow the set.
              </p>
            )}

            {view === "board" ? (
              <RefreshOverlay active={state.isRefreshing && draggingId === null}>
                <div
                  role="region"
                  aria-label="Pipeline board. Drag a card to another stage, or use its menu to move it."
                  tabIndex={0}
                  className="-mx-1 flex gap-4 overflow-x-auto px-1 pb-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-lg"
                >
                  {DEAL_STAGE_SEQUENCE.map((stage) => {
                    const dealsInStage = columns.get(stage) ?? [];
                    const stageValue = dealsInStage.reduce((sum, d) => sum + d.valueCents, 0);
                    const isDropTarget = draggingId !== null && dragOverStage === stage;
                    return (
                      <BoardColumn
                        key={stage}
                        title={DEAL_STAGE_LABEL[stage]}
                        count={dealsInStage.length}
                        meta={dealsInStage.length > 0 ? formatCompactCurrency(stageValue) : undefined}
                        highlighted={isDropTarget}
                        className="w-[264px]"
                        onDragOver={(event) => {
                          event.preventDefault();
                          event.dataTransfer.dropEffect = "move";
                          if (dragOverStage !== stage) setDragOverStage(stage);
                        }}
                        onDragLeave={(event) => {
                          // Only when the pointer leaves the column itself, not
                          // when it crosses between the cards inside it.
                          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                            setDragOverStage((current) => (current === stage ? null : current));
                          }
                        }}
                        onDrop={(event) => {
                          event.preventDefault();
                          handleDrop(stage);
                        }}
                      >
                        {dealsInStage.length === 0 ? (
                          <BoardColumnEmpty highlighted={isDropTarget}>
                            {isOpenStage(stage) ? "Drop a deal here" : `Drop here to mark ${DEAL_STAGE_LABEL[stage].toLowerCase()}`}
                          </BoardColumnEmpty>
                        ) : (
                          dealsInStage.map((deal) => {
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
                          })
                        )}
                      </BoardColumn>
                    );
                  })}
                </div>
              </RefreshOverlay>
            ) : (
              <RefreshOverlay active={state.isRefreshing}>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Deal</TableHead>
                      <TableHead>Stage</TableHead>
                      <SortableHead
                        align="right"
                        direction={sortKey === "value" ? sortDirection : false}
                        onSort={() => toggleSort("value")}
                      >
                        Value
                      </SortableHead>
                      <TableHead className="text-right">Prob.</TableHead>
                      <TableHead>Owner</TableHead>
                      <SortableHead direction={sortKey === "close" ? sortDirection : false} onSort={() => toggleSort("close")}>
                        Expected close
                      </SortableHead>
                      <TableHead className="w-10">
                        <span className="sr-only">Actions</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortDeals(dealList, sortKey, sortDirection).map((deal) => {
                      const info = linkedInfo(deal);
                      return (
                        <ClickableRow key={deal.id} href={`${crm}/deals/${deal.id}`} className={cn(pendingStages[deal.id] && "opacity-70")}>
                          <TableCell>
                            <div className="min-w-0 max-w-[320px]">
                              <CellLink href={`${crm}/deals/${deal.id}`} className="block truncate text-[13px]">
                                {deal.title}
                              </CellLink>
                              <p className="truncate text-[12px] text-muted-foreground">{info.name ?? "Not linked"}</p>
                            </div>
                          </TableCell>
                          <TableCell>
                            <DealStageBadge stage={deal.stage} size="sm" />
                          </TableCell>
                          <TableCell className="text-right">
                            <span className={typography.numeric}>{formatCurrency(deal.valueCents, deal.currency)}</span>
                          </TableCell>
                          <TableCell className="text-right">
                            <span className={cn(typography.numeric, "text-muted-foreground")}>
                              {isOpenStage(deal.stage) ? `${deal.probability}%` : "—"}
                            </span>
                          </TableCell>
                          <TableCell>
                            <span className="flex items-center gap-2">
                              <Avatar fallback={getInitials(deal.owner.name)} size="sm" className="size-6 text-[10px]" />
                              <span className="truncate text-[13px] text-foreground">{deal.owner.name}</span>
                            </span>
                          </TableCell>
                          <TableCell>
                            <DealCloseDate deal={deal} emptyLabel="—" className="text-[12px]" />
                          </TableCell>
                          <TableCell className="text-right">
                            <DealMoveMenu deal={deal} onMoveStage={handleMoveStage} />
                          </TableCell>
                        </ClickableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </RefreshOverlay>
            )}
          </div>
        )}
      </Reveal>

      <LostReasonDialog
        open={lostPromptDealId !== null}
        dealTitle={lostDeal?.title}
        onCancel={() => setLostPromptDealId(null)}
        onConfirm={async (reason) => {
          if (!lostPromptDealId) return;
          const dealId = lostPromptDealId;
          setLostPromptDealId(null);
          await applyStageChange(dealId, "lost", reason);
        }}
      />
    </PageStack>
  );
}
