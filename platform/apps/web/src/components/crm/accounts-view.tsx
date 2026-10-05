"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, CircleDollarSign, Trophy } from "lucide-react";
import {
  Button,
  EmptyState,
  Pagination,
  RefreshOverlay,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  cn,
} from "@bebest/ui";
import { ErrorPanel } from "@/components/patterns/error-panel";
import { PageStack, Reveal } from "@/components/patterns/motion";
import { StatGrid, StatTile } from "@/components/patterns/stat-tile";
import { ClearFiltersButton, ResultCount, Toolbar, ToolbarSearch } from "@/components/patterns/toolbar";
import { CellLink, ClickableRow, TableSkeleton, type SkeletonColumn } from "@/components/patterns/data-table";
import { NoResults } from "@/components/patterns/states";
import { typography } from "@/components/patterns/typography";
import { AccountPlanBadge } from "@/components/crm/status-badges";
import { pipelineTotals } from "@/components/crm/deal-utils";
import { DEFAULT_PAGE_SIZE, fetchAccounts, fetchDeals } from "@/data/crm/client";
import type { Deal } from "@/data/crm/types";
import { useAsyncData } from "@/lib/use-async-data";
import { useCrmBasePath } from "@/components/crm/crm-base-path";
import { formatCompactCurrency, formatCurrency, formatDate, formatNumber, formatRelativeTime } from "@/lib/format";

const COLUMNS: SkeletonColumn[] = [
  { header: "Account", cell: "entity" },
  { header: "Primary contact", cell: "text" },
  { header: "Open pipeline", cell: "number", align: "right" },
  { header: "Won", cell: "number", align: "right" },
  { header: "Customer since", cell: "meta" },
];

function AccountMark({ name }: { name: string }) {
  return (
    <span
      className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-surface text-[11px] font-semibold text-muted-foreground"
      aria-hidden="true"
    >
      {name.trim().charAt(0).toUpperCase() || <Building2 size={13} />}
    </span>
  );
}

export function AccountsView() {
  const crm = useCrmBasePath();
  const router = useRouter();
  const [searchInput, setSearchInput] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);

  useEffect(() => {
    const handle = setTimeout(() => {
      setQ(searchInput);
      setPage(1);
    }, 250);
    return () => clearTimeout(handle);
  }, [searchInput]);

  // Both requests go out together. `q` is a real server-side filter, so
  // searching reaches every account, not just the ones already fetched.
  const { reload, ...state } = useAsyncData(
    async () => {
      const [accounts, deals] = await Promise.all([fetchAccounts({ q, page, limit: DEFAULT_PAGE_SIZE }), fetchDeals()]);
      return { accounts, deals };
    },
    [q, page],
  );

  const hasFilters = q.trim() !== "";

  function clearFilters() {
    setSearchInput("");
    setQ("");
    setPage(1);
  }

  const accounts = state.status === "success" ? state.data.accounts : null;
  const dealsPage = state.status === "success" ? state.data.deals : null;
  const deals = dealsPage?.items ?? [];
  const accountDeals = deals.filter((d) => d.organizationId);
  const totals = pipelineTotals(accountDeals);
  const dealsTruncated = dealsPage !== null && dealsPage.total > dealsPage.items.length;
  const firstRun = accounts !== null && accounts.total === 0 && !hasFilters;

  const dealsByAccount = new Map<string, Deal[]>();
  for (const deal of accountDeals) {
    const list = dealsByAccount.get(deal.organizationId!) ?? [];
    list.push(deal);
    dealsByAccount.set(deal.organizationId!, list);
  }
  const accountsWithOpenDeals = [...dealsByAccount.values()].filter((list) => pipelineTotals(list).openCount > 0).length;

  return (
    <PageStack>
      {!firstRun && state.status !== "error" && (
        <StatGrid columns={3}>
          <StatTile
            label="Accounts"
            icon={<Building2 size={13} />}
            loading={!accounts}
            value={accounts ? formatNumber(accounts.total) : "—"}
            hint={hasFilters ? "Matching this search" : "Converted from leads"}
          />
          <StatTile
            label="Open pipeline"
            icon={<CircleDollarSign size={13} />}
            loading={!dealsPage}
            value={formatCompactCurrency(totals.openValue)}
            hint={`${formatNumber(totals.openCount)} open ${totals.openCount === 1 ? "deal" : "deals"} across ${formatNumber(accountsWithOpenDeals)} ${accountsWithOpenDeals === 1 ? "account" : "accounts"}${dealsTruncated ? " (first 100 deals)" : ""}`}
          />
          <StatTile
            label="Won revenue"
            icon={<Trophy size={13} />}
            loading={!dealsPage}
            value={formatCompactCurrency(totals.wonValue)}
            hint={`${formatNumber(totals.wonCount)} closed-won ${totals.wonCount === 1 ? "deal" : "deals"} with accounts`}
          />
        </StatGrid>
      )}

      {!firstRun && (
        <Toolbar end={accounts && <ResultCount count={accounts.total} noun="account" />}>
          <ToolbarSearch value={searchInput} onChange={setSearchInput} placeholder="Search company, contact, email" label="Search accounts" className="sm:w-72" />
          {hasFilters && <ClearFiltersButton onClick={clearFilters} />}
        </Toolbar>
      )}

      <Reveal>
        {state.status === "loading" && <TableSkeleton columns={COLUMNS} label="Loading accounts…" />}

        {state.status === "error" && <ErrorPanel title="Accounts didn't load" message={state.error.message} onRetry={reload} />}

        {firstRun && (
          <EmptyState
            icon={<Building2 size={20} />}
            title="No accounts yet"
            description="An account is created when a qualified lead converts. Convert your first lead and it will appear here with its deals and history."
            action={
              <Button variant="primary" size="sm" onClick={() => router.push(`${crm}/leads`)}>
                View leads to convert
              </Button>
            }
          />
        )}

        {accounts && accounts.items.length === 0 && hasFilters && (
          <NoResults noun="accounts" onClear={clearFilters} hint="Try a different company, contact name, or email." />
        )}

        {accounts && accounts.items.length > 0 && (
          <RefreshOverlay active={state.isRefreshing} className="flex flex-col gap-3">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Account</TableHead>
                  <TableHead>Primary contact</TableHead>
                  <TableHead className="text-right">Open pipeline</TableHead>
                  <TableHead className="text-right">Won</TableHead>
                  <TableHead>Customer since</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {accounts.items.map((account) => {
                  const href = `${crm}/accounts/${account.id}`;
                  const rollup = pipelineTotals(dealsByAccount.get(account.id) ?? []);
                  const primaryContact = account.contacts.find((c) => c.primary) ?? account.contacts[0] ?? null;
                  return (
                    <ClickableRow key={account.id} href={href}>
                      <TableCell>
                        <div className="flex items-center gap-2.5">
                          <AccountMark name={account.name} />
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <CellLink href={href} className="block truncate text-[13px]">
                                {account.name}
                              </CellLink>
                              {account.plan && <AccountPlanBadge plan={account.plan} />}
                            </div>
                            <p className="truncate text-[12px] text-muted-foreground">{account.domain ?? account.slug}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        {primaryContact ? (
                          <div className="min-w-0">
                            <p className="truncate text-[13px] text-foreground">{primaryContact.name}</p>
                            <p className="truncate text-[12px] text-muted-foreground">{primaryContact.email}</p>
                          </div>
                        ) : (
                          <span className="text-subtle-foreground">&mdash;</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {rollup.openCount > 0 ? (
                          <div>
                            <p className={typography.numeric}>{formatCurrency(rollup.openValue)}</p>
                            <p className={cn(typography.meta, "tabular-nums")}>
                              {rollup.openCount} {rollup.openCount === 1 ? "deal" : "deals"}
                            </p>
                          </div>
                        ) : (
                          <span className={cn(typography.numeric, "text-subtle-foreground")}>&mdash;</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <span className={cn(typography.numeric, rollup.wonCount === 0 && "text-subtle-foreground")}>
                          {rollup.wonCount > 0 ? formatCurrency(rollup.wonValue) : "—"}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className={typography.meta} title={formatDate(account.createdAt)}>
                          {formatRelativeTime(account.createdAt)}
                        </span>
                      </TableCell>
                    </ClickableRow>
                  );
                })}
              </TableBody>
            </Table>

            <Pagination page={accounts.page} pageSize={accounts.limit} total={accounts.total} onPageChange={setPage} itemLabel="accounts" />
          </RefreshOverlay>
        )}
      </Reveal>
    </PageStack>
  );
}
