"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Briefcase, Network, Search } from "lucide-react";
import {
  Badge,
  Button,
  EmptyState,
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
import { PageHeader } from "@/components/patterns/page-header";
import { PLATFORM_PAGE_SIZE, fetchAgencyClients, fetchPlatformAgencies } from "@/data/platform/client";
import { AGENCY_LINK_STATUSES } from "@/data/platform/types";
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
  humanize,
  opts,
  rowLinkProps,
  useDebouncedValue,
} from "./platform-ui";

const COLUMNS = ["Agency", "Plan", "Clients", "Members", "Status", "Created"];

/** Platform → Agencies: "Which agencies are on BeBest, and who do they manage?" */
export function AgenciesView() {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const q = useDebouncedValue(search.trim());
  const [page, setPage] = useState(1);
  const [prevQ, setPrevQ] = useState(q);
  if (prevQ !== q) {
    setPrevQ(q);
    setPage(1);
  }
  const state = useAsyncData(() => fetchPlatformAgencies({ q, page }), [q, page]);
  const data = state.status === "success" ? state.data : null;

  return (
    <>
      <PageHeader
        eyebrow="Platform"
        title="Agencies"
        description="Organizations of kind agency and the client organizations each one manages."
      />
      <div className="flex flex-col gap-4">
        <FilterBar onClear={() => setSearch("")} active={q !== ""}>
          <SearchField value={search} onChange={setSearch} placeholder="Search name or slug" label="Search agencies" />
          <div className="sm:ml-auto">
            <RefreshingHint active={state.isRefreshing} />
          </div>
        </FilterBar>

        {state.status === "loading" && <TableSkeleton columns={COLUMNS} label="Loading agencies" />}
        {state.status === "error" && <PlatformErrorState error={state.error} onRetry={state.reload} resource="agencies" />}

        {data && data.items.length === 0 && (
          <EmptyState
            compact
            icon={q ? <Search size={18} /> : <Briefcase size={18} />}
            title={q ? "No agencies match" : "No agencies yet"}
            description={
              q
                ? "No agency's name or slug contains this search."
                : "An organization becomes an agency when it's on an agency plan or manages a client. None do on this environment yet."
            }
            action={
              q ? (
                <Button variant="secondary" size="sm" onClick={() => setSearch("")}>
                  Clear search
                </Button>
              ) : (
                <Button variant="secondary" size="sm" asChild>
                  <Link href="/platform/organizations">Browse all organizations</Link>
                </Button>
              )
            }
          />
        )}

        {data && data.items.length > 0 && (
          <RefreshOverlay active={state.isRefreshing} className="flex flex-col gap-3">
            <Table>
              <caption className="sr-only">Agencies, newest first</caption>
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
                {data.items.map((a) => {
                  const href = `/platform/agencies/${a.id}`;
                  const others = Object.entries(a.clientCounts).filter(([s]) => s !== "active");
                  return (
                    <TableRow key={a.id} {...rowLinkProps(() => router.push(href))}>
                      <TableCell className="min-w-[200px]">
                        <Link
                          href={href}
                          className="block rounded-sm font-medium text-foreground hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {a.name}
                        </Link>
                        <p className="font-mono text-[12px] text-muted-foreground">{a.slug}</p>
                      </TableCell>
                      <TableCell>
                        <PlanBadge plan={a.plan} />
                      </TableCell>
                      <TableCell>
                        <p className="text-[13px]">
                          <span className="font-mono tabular-nums text-foreground">{a.clientCounts.active ?? 0}</span>{" "}
                          <span className="text-muted-foreground">active</span>
                        </p>
                        {others.length > 0 && (
                          <p className="text-[12px] text-subtle-foreground">{others.map(([s, n]) => `${n} ${s}`).join(" · ")}</p>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono text-[12.5px] tabular-nums">{a.memberCount}</TableCell>
                      <TableCell>
                        <StatusBadge status={a.status} />
                      </TableCell>
                      <TableCell>
                        <TimeAgo iso={a.createdAt} />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            <Pagination page={page} pageSize={PLATFORM_PAGE_SIZE} total={data.total} onPageChange={setPage} itemLabel="agencies" />
          </RefreshOverlay>
        )}
      </div>
    </>
  );
}

const CLIENT_COLUMNS = ["Client", "Link", "Access", "Relationship", "Linked"];

/** Platform → Agency → clients. */
export function AgencyClientsView({ agencyId }: { agencyId: string }) {
  const router = useRouter();
  const [status, setStatus] = useState(ALL);
  const [page, setPage] = useState(1);
  const state = useAsyncData(() => fetchAgencyClients(agencyId, { status: status === ALL ? undefined : status, page }), [agencyId, status, page]);
  const data = state.status === "success" ? state.data : null;

  return (
    <div className="flex flex-col gap-6">
      <Link
        href="/platform/agencies"
        className="inline-flex w-fit items-center gap-1.5 rounded-sm text-[13px] text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft size={14} aria-hidden /> All agencies
      </Link>

      <PageHeader
        className="mb-0"
        eyebrow="Agency"
        title={data ? data.agency.name : "Agency clients"}
        description="Every client organization this agency is linked to, in any state."
        actions={
          data ? (
            <Button variant="secondary" size="sm" asChild>
              <Link href={`/platform/organizations/${data.agency.id}`}>Agency organization</Link>
            </Button>
          ) : state.status === "loading" ? (
            <Skeleton className="h-8 w-40" />
          ) : undefined
        }
      />

      <FilterBar onClear={() => setStatus(ALL)} active={status !== ALL}>
        <FilterSelect
          label="Filter by link status"
          value={status}
          onChange={(v) => {
            setStatus(v);
            setPage(1);
          }}
          options={opts(AGENCY_LINK_STATUSES)}
          allLabel="All link statuses"
          className="sm:w-48"
        />
        <div className="sm:ml-auto">
          <RefreshingHint active={state.isRefreshing} />
        </div>
      </FilterBar>

      {state.status === "loading" && <TableSkeleton columns={CLIENT_COLUMNS} rows={4} label="Loading clients" />}
      {state.status === "error" && (
        <PlatformErrorState
          error={state.error}
          onRetry={state.reload}
          resource="this agency's clients"
          notFound={
            <EmptyState
              icon={<Briefcase size={20} />}
              title="Agency not found"
              description="No organization has this id."
              action={
                <Button variant="secondary" size="sm" asChild>
                  <Link href="/platform/agencies">All agencies</Link>
                </Button>
              }
            />
          }
        />
      )}

      {data && data.items.length === 0 && (
        <EmptyState
          compact
          icon={<Network size={18} />}
          title={status === ALL ? "No clients linked" : `No ${status} clients`}
          description={
            status === ALL
              ? "This agency hasn't linked any client organizations yet. Clients appear once the agency invites one from its Agency view."
              : "Try another link status."
          }
          action={
            status !== ALL ? (
              <Button variant="secondary" size="sm" onClick={() => setStatus(ALL)}>
                Show all
              </Button>
            ) : undefined
          }
        />
      )}

      {data && data.items.length > 0 && (
        <RefreshOverlay active={state.isRefreshing} className="flex flex-col gap-3">
          <Table>
            <caption className="sr-only">Clients of {data.agency.name}</caption>
            <TableHeader>
              <TableRow>
                {CLIENT_COLUMNS.map((c) => (
                  <TableHead key={c}>{c}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.items.map((c) => {
                const href = `/platform/organizations/${c.client.id}`;
                return (
                  <TableRow key={c.linkId} {...rowLinkProps(() => router.push(href))}>
                    <TableCell className="min-w-[200px]">
                      <Link
                        href={href}
                        className="block rounded-sm font-medium text-foreground hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {c.client.name}
                      </Link>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                        <span className="font-mono text-[12px] text-muted-foreground">{c.client.slug}</span>
                        <KindBadge kind={c.client.kind} />
                        {c.client.deletedAt && (
                          <Badge variant="danger" size="sm">
                            Deleted
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={c.status} />
                    </TableCell>
                    <TableCell className="text-[13px]">{humanize(c.accessLevel)}</TableCell>
                    <TableCell className="text-[13px] text-muted-foreground">{humanize(c.relationshipType)}</TableCell>
                    <TableCell>
                      <TimeAgo iso={c.createdAt} />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          <Pagination page={page} pageSize={PLATFORM_PAGE_SIZE} total={data.total} onPageChange={setPage} itemLabel="clients" />
        </RefreshOverlay>
      )}
    </div>
  );
}
