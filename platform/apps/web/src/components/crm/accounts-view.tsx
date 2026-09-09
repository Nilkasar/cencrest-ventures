"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, Search, X } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  EmptyState,
  Input,
  Pagination,
  RefreshOverlay,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@bebest/ui";
import { ErrorPanel } from "@/components/patterns/error-panel";
import { DEFAULT_PAGE_SIZE, fetchAccounts, fetchDeals } from "@/data/crm/client";
import type { Account } from "@/data/crm/types";
import { useAsyncData } from "@/lib/use-async-data";
import { formatCompactCurrency, formatCurrency, formatDate } from "@/lib/format";

const PLAN_LABEL: Record<NonNullable<Account["plan"]>, string> = {
  free: "Free",
  starter: "Starter",
  growth: "Growth",
  pro: "Pro",
  agency: "Agency",
  managed: "Managed",
  enterprise: "Enterprise",
};

function AccountsTableSkeleton() {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Account</TableHead>
          <TableHead>Plan</TableHead>
          <TableHead>Primary contact</TableHead>
          <TableHead>Deals</TableHead>
          <TableHead>Converted from</TableHead>
          <TableHead>Created</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {Array.from({ length: 4 }).map((_, i) => (
          <TableRow key={i}>
            <TableCell><Skeleton className="h-3 w-36" /></TableCell>
            <TableCell><Skeleton className="h-5 w-16 rounded-full" /></TableCell>
            <TableCell><Skeleton className="h-3 w-32" /></TableCell>
            <TableCell><Skeleton className="h-3 w-20" /></TableCell>
            <TableCell><Skeleton className="h-3 w-24" /></TableCell>
            <TableCell><Skeleton className="h-3 w-16" /></TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
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

export function AccountsView() {
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

  // Both requests go out together. `q` is a real server-side filter now, so
  // searching reaches every account, not just the ones already fetched.
  const { reload, ...state } = useAsyncData(
    async () => {
      const [accounts, deals] = await Promise.all([
        fetchAccounts({ q, page, limit: DEFAULT_PAGE_SIZE }),
        fetchDeals(),
      ]);
      return { accounts, deals };
    },
    [q, page],
  );

  const accounts = state.status === "success" ? state.data.accounts : null;
  const deals = state.status === "success" ? state.data.deals.items : [];

  const wonValue = deals
    .filter((d) => d.stage === "won")
    .reduce((sum, d) => sum + d.valueCents, 0);
  const openValueForAccounts = deals
    .filter((d) => d.organizationId && d.stage !== "won" && d.stage !== "lost")
    .reduce((sum, d) => sum + d.valueCents, 0);

  return (
    <div className="flex flex-col gap-6">
      {accounts && accounts.total > 0 && !q && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <StatCard label="Accounts" value={String(accounts.total)} />
          <StatCard label="Won value" value={formatCompactCurrency(wonValue)} />
          <StatCard label="Open pipeline (accounts)" value={formatCompactCurrency(openValueForAccounts)} />
        </div>
      )}

      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-subtle-foreground" aria-hidden="true" />
          <Input
            placeholder="Search accounts"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="pl-8"
            aria-label="Search accounts"
          />
        </div>
        {searchInput && (
          <Button variant="ghost" size="sm" onClick={() => setSearchInput("")}>
            <X size={14} /> Clear
          </Button>
        )}
      </div>

      {state.status === "loading" && <AccountsTableSkeleton />}

      {state.status === "error" && <ErrorPanel message={state.error.message} onRetry={reload} />}

      {accounts && accounts.items.length === 0 && !q && (
        <EmptyState
          icon={<Building2 size={20} />}
          eyebrow="Accounts"
          title="No accounts yet"
          description="An account appears here once a lead converts, or a customer signs up directly (agency and enterprise relationships often do). Convert a qualified lead to create the first one."
          action={
            <Button variant="primary" size="sm" onClick={() => router.push("/crm/leads")}>
              View leads to convert
            </Button>
          }
        />
      )}

      {accounts && accounts.items.length === 0 && q && (
        <EmptyState
          compact
          icon={<Search size={18} />}
          title="No accounts match that search"
          description="Try a different company, contact name, or email."
          action={
            <Button variant="secondary" size="sm" onClick={() => setSearchInput("")}>
              Clear search
            </Button>
          }
        />
      )}

      {accounts && accounts.items.length > 0 && (
        <RefreshOverlay active={state.isRefreshing} className="flex flex-col gap-3">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Account</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead>Primary contact</TableHead>
                <TableHead>Deals</TableHead>
                <TableHead>Converted from</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {accounts.items.map((account) => {
                const accountDeals = deals.filter((d) => d.organizationId === account.id);
                const dealsValue = accountDeals.reduce((sum, d) => sum + d.valueCents, 0);
                const primaryContact = account.contacts.find((c) => c.primary) ?? account.contacts[0] ?? null;
                return (
                  <TableRow
                    key={account.id}
                    className="cursor-pointer"
                    tabIndex={0}
                    role="link"
                    onClick={() => router.push(`/crm/accounts/${account.id}`)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") router.push(`/crm/accounts/${account.id}`);
                    }}
                  >
                    <TableCell>
                      <p className="text-[13px] font-medium text-foreground">{account.name}</p>
                      {account.domain && <p className="text-[12px] text-muted-foreground">{account.domain}</p>}
                    </TableCell>
                    <TableCell>
                      {account.plan ? (
                        <Badge variant="outline" size="sm">{PLAN_LABEL[account.plan]}</Badge>
                      ) : (
                        <span className="text-[12.5px] text-subtle-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {primaryContact ? (
                        <div>
                          <p className="text-[13px] text-foreground">{primaryContact.name}</p>
                          <p className="text-[12px] text-muted-foreground">{primaryContact.email}</p>
                        </div>
                      ) : (
                        <span className="text-[12.5px] text-subtle-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {accountDeals.length > 0 ? (
                        <span className="font-mono text-[12.5px] text-foreground">
                          {accountDeals.length} · {formatCurrency(dealsValue)}
                        </span>
                      ) : (
                        <span className="text-[12.5px] text-subtle-foreground">No deals</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {primaryContact ? (
                        <span className="text-[12.5px] text-foreground">{primaryContact.name}</span>
                      ) : (
                        <span className="text-[12.5px] text-subtle-foreground">Direct signup</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <span className="text-[12.5px] text-muted-foreground">{formatDate(account.createdAt)}</span>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>

          <Pagination
            page={accounts.page}
            pageSize={accounts.limit}
            total={accounts.total}
            onPageChange={setPage}
            itemLabel="accounts"
          />
        </RefreshOverlay>
      )}
    </div>
  );
}
