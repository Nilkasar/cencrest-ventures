"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, Search, X } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  EmptyState,
  Input,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@bebest/ui";
import { ErrorPanel } from "@/components/patterns/error-panel";
import { fetchAccounts, fetchDeals, fetchLeads } from "@/data/crm/client";
import type { Account } from "@/data/crm/types";
import { useAsyncData } from "@/lib/use-async-data";
import { formatCompactCurrency, formatCurrency, formatDate } from "@/lib/format";

const PLAN_LABEL: Record<Account["plan"], string> = {
  free: "Free",
  starter: "Starter",
  growth: "Growth",
  pro: "Pro",
  agency: "Agency",
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
  const [q, setQ] = useState("");

  const { reload, ...state } = useAsyncData(async () => {
    const [accountsData, dealsData, leadsData] = await Promise.all([fetchAccounts(), fetchDeals(), fetchLeads()]);
    return { accounts: accountsData, deals: dealsData, leads: leadsData };
  }, []);

  const filteredAccounts = useMemo(() => {
    if (state.status !== "success") return [];
    if (!q.trim()) return state.data.accounts;
    const needle = q.trim().toLowerCase();
    return state.data.accounts.filter((a) => a.name.toLowerCase().includes(needle) || (a.domain ?? "").toLowerCase().includes(needle));
  }, [state, q]);

  const wonValue = state.status === "success" ? state.data.deals.filter((d) => d.stage === "won").reduce((sum, d) => sum + d.valueCents, 0) : 0;
  const openValueForAccounts = state.status === "success"
    ? state.data.deals.filter((d) => d.organizationId && d.stage !== "won" && d.stage !== "lost").reduce((sum, d) => sum + d.valueCents, 0)
    : 0;

  return (
    <div className="flex flex-col gap-6">
      {state.status === "success" && state.data.accounts.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <StatCard label="Accounts" value={String(state.data.accounts.length)} />
          <StatCard label="Won value" value={formatCompactCurrency(wonValue)} />
          <StatCard label="Open pipeline (accounts)" value={formatCompactCurrency(openValueForAccounts)} />
        </div>
      )}

      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-subtle-foreground" aria-hidden="true" />
          <Input placeholder="Search accounts" value={q} onChange={(e) => setQ(e.target.value)} className="pl-8" aria-label="Search accounts" />
        </div>
        {q && (
          <Button variant="ghost" size="sm" onClick={() => setQ("")}>
            <X size={14} /> Clear
          </Button>
        )}
      </div>

      {state.status === "loading" && <AccountsTableSkeleton />}

      {state.status === "error" && <ErrorPanel message={state.error.message} onRetry={reload} />}

      {state.status === "success" && state.data.accounts.length === 0 && (
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

      {state.status === "success" && state.data.accounts.length > 0 && filteredAccounts.length === 0 && (
        <EmptyState
          compact
          icon={<Search size={18} />}
          title="No accounts match that search"
          description="Try a different name or domain."
          action={
            <Button variant="secondary" size="sm" onClick={() => setQ("")}>
              Clear search
            </Button>
          }
        />
      )}

      {state.status === "success" && filteredAccounts.length > 0 && (
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
            {filteredAccounts.map((account) => {
              const accountDeals = state.data.deals.filter((d) => d.organizationId === account.id);
              const dealsValue = accountDeals.reduce((sum, d) => sum + d.valueCents, 0);
              const primaryContact = account.contacts.find((c) => c.primary) ?? account.contacts[0] ?? null;
              const sourceLead = account.convertedFromLeadId ? state.data.leads.find((l) => l.id === account.convertedFromLeadId) : null;
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
                    <Badge variant="outline" size="sm">{PLAN_LABEL[account.plan]}</Badge>
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
                    {sourceLead ? (
                      <span className="text-[12.5px] text-foreground">{sourceLead.name}</span>
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
      )}
    </div>
  );
}
