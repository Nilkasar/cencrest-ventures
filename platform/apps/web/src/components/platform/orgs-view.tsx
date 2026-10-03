"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Building, Search } from "lucide-react";
import { Button, EmptyState, Pagination, RefreshOverlay, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@bebest/ui";
import { PageHeader } from "@/components/patterns/page-header";
import { PLATFORM_PAGE_SIZE, fetchPlatformOrgs } from "@/data/platform/client";
import { ORG_KINDS, ORG_STATUSES, PLAN_TIERS } from "@/data/platform/types";
import { useAsyncData } from "@/lib/use-async-data";
import {
  ALL,
  FilterBar,
  FilterSelect,
  KindBadge,
  PlanBadge,
  PlatformErrorState,
  RefreshingHint,
  SearchField,
  StatusBadge,
  TableSkeleton,
  TimeAgo,
  opts,
  rowLinkProps,
  useDebouncedValue,
} from "./platform-ui";

const COLUMNS = ["Organization", "Kind", "Plan", "Status", "Members", "Last activity", "Created"];
const PLAN_OPTIONS = [...opts(PLAN_TIERS), { value: "none", label: "No plan" }];

/** Platform → Organizations: "Which orgs exist, and which one am I looking for?" */
export function OrgsView() {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const q = useDebouncedValue(search.trim());
  const [kind, setKind] = useState(ALL);
  const [plan, setPlan] = useState(ALL);
  const [status, setStatus] = useState(ALL);
  const [page, setPage] = useState(1);

  const filters = { q, kind: kind === ALL ? undefined : kind, plan: plan === ALL ? undefined : plan, status: status === ALL ? undefined : status, page };
  const state = useAsyncData(() => fetchPlatformOrgs(filters), [q, kind, plan, status, page]);
  const data = state.status === "success" ? state.data : null;
  const filtered = q !== "" || kind !== ALL || plan !== ALL || status !== ALL;

  // Any filter change goes back to page 1.
  const set = (fn: (v: string) => void) => (v: string) => {
    fn(v);
    setPage(1);
  };
  const [prevQ, setPrevQ] = useState(q);
  if (prevQ !== q) {
    setPrevQ(q);
    setPage(1);
  }

  function clear() {
    setSearch("");
    setKind(ALL);
    setPlan(ALL);
    setStatus(ALL);
    setPage(1);
  }

  return (
    <>
      <PageHeader
        eyebrow="Platform"
        title="Organizations"
        description="Every organization on BeBest — customers, agencies and our own internal workspace. Opening one is recorded in the audit log."
      />
      <div className="flex flex-col gap-4">
        <FilterBar onClear={clear} active={filtered}>
          <SearchField value={search} onChange={setSearch} placeholder="Search name or slug" label="Search organizations" />
          <FilterSelect label="Filter by kind" value={kind} onChange={set(setKind)} options={opts(ORG_KINDS)} allLabel="All kinds" />
          <FilterSelect label="Filter by plan" value={plan} onChange={set(setPlan)} options={PLAN_OPTIONS} allLabel="All plans" />
          <FilterSelect label="Filter by status" value={status} onChange={set(setStatus)} options={opts(ORG_STATUSES)} allLabel="All statuses" />
          <div className="sm:ml-auto">
            <RefreshingHint active={state.isRefreshing} />
          </div>
        </FilterBar>

        {state.status === "loading" && <TableSkeleton columns={COLUMNS} label="Loading organizations" />}
        {state.status === "error" && <PlatformErrorState error={state.error} onRetry={state.reload} resource="organizations" />}

        {data && data.items.length === 0 && (
          <EmptyState
            compact
            icon={filtered ? <Search size={18} /> : <Building size={18} />}
            title={filtered ? "No organizations match" : "No organizations yet"}
            description={
              filtered
                ? "Nothing matches this search and these filters. Try a shorter search term or clear a filter."
                : "Organizations appear here as people sign up. None exist on this environment yet."
            }
            action={
              filtered ? (
                <Button variant="secondary" size="sm" onClick={clear}>
                  Clear filters
                </Button>
              ) : undefined
            }
          />
        )}

        {data && data.items.length > 0 && (
          <RefreshOverlay active={state.isRefreshing} className="flex flex-col gap-3">
            <Table>
              <caption className="sr-only">Organizations, newest first</caption>
              <TableHeader>
                <TableRow>
                  {COLUMNS.map((c) => (
                    <TableHead key={c} className={c === "Members" ? "text-right" : undefined}>
                      {c}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((org) => {
                  const href = `/platform/organizations/${org.id}`;
                  return (
                    <TableRow key={org.id} {...rowLinkProps(() => router.push(href))}>
                      <TableCell className="min-w-[220px]">
                        <Link href={href} className="block rounded-sm font-medium text-foreground hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                          {org.name}
                        </Link>
                        <p className="truncate text-[12px] text-muted-foreground">
                          <span className="font-mono">{org.slug}</span>
                          {org.brand?.websiteUrl && <> · {org.brand.websiteUrl.replace(/^https?:\/\//, "")}</>}
                        </p>
                      </TableCell>
                      <TableCell>
                        <KindBadge kind={org.kind} />
                      </TableCell>
                      <TableCell>
                        <PlanBadge plan={org.plan} />
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={org.status} />
                      </TableCell>
                      <TableCell className="text-right font-mono text-[12.5px] tabular-nums">{org.memberCount}</TableCell>
                      <TableCell>
                        <TimeAgo iso={org.lastActivityAt} empty="No activity" />
                      </TableCell>
                      <TableCell>
                        <TimeAgo iso={org.createdAt} />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            <Pagination page={page} pageSize={PLATFORM_PAGE_SIZE} total={data.total} onPageChange={setPage} itemLabel="organizations" />
            {data.total <= PLATFORM_PAGE_SIZE && (
              <p className="text-[12.5px] text-muted-foreground">
                {data.total} organization{data.total === 1 ? "" : "s"}
              </p>
            )}
          </RefreshOverlay>
        )}
      </div>
    </>
  );
}
