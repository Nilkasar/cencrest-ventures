"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Inbox, Sparkles, UserPlus, Users } from "lucide-react";
import {
  Avatar,
  Badge,
  EmptyState,
  Pagination,
  RefreshOverlay,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  getInitials,
} from "@bebest/ui";
import { ErrorPanel } from "@/components/patterns/error-panel";
import { PageStack, Reveal } from "@/components/patterns/motion";
import { StatGrid, StatTile } from "@/components/patterns/stat-tile";
import { ClearFiltersButton, FilterSelect, ResultCount, Toolbar, ToolbarSearch } from "@/components/patterns/toolbar";
import { CellLink, ClickableRow, TableSkeleton, type SkeletonColumn } from "@/components/patterns/data-table";
import { NoResults } from "@/components/patterns/states";
import { typography } from "@/components/patterns/typography";
import { AddLeadDialog } from "@/components/crm/add-lead-dialog";
import { LeadScore, LeadSourceBadge, LeadStatusBadge } from "@/components/crm/status-badges";
import { DEFAULT_PAGE_SIZE, fetchLeads, type LeadFilters } from "@/data/crm/client";
import type { Lead, LeadSource, LeadStatus } from "@/data/crm/types";
import { useAsyncData } from "@/lib/use-async-data";
import { useCrmBasePath } from "@/components/crm/crm-base-path";
import { formatNumber, formatPercent, formatRelativeTime } from "@/lib/format";

const STATUS_OPTIONS: { value: LeadStatus | "all"; label: string }[] = [
  { value: "all", label: "All statuses" },
  { value: "new", label: "New" },
  { value: "contacted", label: "Contacted" },
  { value: "qualified", label: "Qualified" },
  { value: "converted", label: "Converted" },
  { value: "lost", label: "Lost" },
];

const SOURCE_OPTIONS: { value: LeadSource | "all"; label: string }[] = [
  { value: "all", label: "All sources" },
  { value: "free_snapshot", label: "Free snapshot" },
  { value: "apply_form", label: "Apply form" },
  { value: "direct", label: "Direct" },
  { value: "referral", label: "Referral" },
];

const COLUMNS: SkeletonColumn[] = [
  { header: "Lead", cell: "entity" },
  { header: "Source", cell: "badge" },
  { header: "Status", cell: "badge" },
  { header: "Score", cell: "number", align: "right" },
  { header: "Assigned to", cell: "text" },
  { header: "Created", cell: "meta" },
];

export function LeadsView() {
  const crm = useCrmBasePath();
  const [status, setStatus] = useState<LeadStatus | "all">("all");
  const [source, setSource] = useState<LeadSource | "all">("all");
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

  const filters: LeadFilters = useMemo(
    () => ({ status, source, q, page, limit: DEFAULT_PAGE_SIZE }),
    [status, source, q, page],
  );
  const { reload, ...state } = useAsyncData(() => fetchLeads(filters), [status, source, q, page]);

  const hasFilters = status !== "all" || source !== "all" || q.trim() !== "";

  function clearFilters() {
    setStatus("all");
    setSource("all");
    setSearchInput("");
    setQ("");
    setPage(1);
  }

  const leads = state.status === "success" ? state.data : null;
  // Counts come from the API, across every matching row — not from the rows
  // this page happens to hold.
  const counts = leads?.statusCounts;
  const firstRun = leads !== null && leads.total === 0 && !hasFilters;

  return (
    <PageStack>
      {!firstRun && state.status !== "error" && (
        <StatGrid>
          <StatTile
            label="Leads"
            icon={<Users size={13} />}
            loading={!counts}
            value={leads ? formatNumber(leads.total) : "—"}
            hint={hasFilters ? "Matching these filters" : "In the pipeline"}
          />
          <StatTile
            label="Needs a response"
            icon={<Inbox size={13} />}
            loading={!counts}
            value={counts ? formatNumber(counts.new) : "—"}
            hint="Status: New"
          />
          <StatTile
            label="Qualified"
            icon={<Sparkles size={13} />}
            loading={!counts}
            value={counts ? formatNumber(counts.qualified) : "—"}
            hint="Ready to convert"
          />
          <StatTile
            label="Converted"
            icon={<CheckCircle2 size={13} />}
            loading={!counts}
            value={counts ? formatNumber(counts.converted) : "—"}
            hint={
              leads && counts && leads.total > 0
                ? `${formatPercent((counts.converted / leads.total) * 100)} of leads`
                : "Became accounts"
            }
          />
        </StatGrid>
      )}

      {!firstRun && (
        <Toolbar
          end={
            <>
              {leads && <ResultCount count={leads.total} noun="lead" />}
              <AddLeadDialog onCreated={() => reload()} />
            </>
          }
        >
          <ToolbarSearch value={searchInput} onChange={setSearchInput} placeholder="Search name, company, email" label="Search leads" />
          <FilterSelect
            value={status}
            onValueChange={(value) => {
              setStatus(value);
              setPage(1);
            }}
            options={STATUS_OPTIONS}
            label="Filter by status"
          />
          <FilterSelect
            value={source}
            onValueChange={(value) => {
              setSource(value);
              setPage(1);
            }}
            options={SOURCE_OPTIONS}
            label="Filter by source"
          />
          {hasFilters && <ClearFiltersButton onClick={clearFilters} />}
        </Toolbar>
      )}

      <Reveal>
        {state.status === "loading" && <TableSkeleton columns={COLUMNS} label="Loading leads…" />}

        {state.status === "error" && <ErrorPanel title="Leads didn't load" message={state.error.message} onRetry={reload} />}

        {firstRun && (
          <EmptyState
            icon={<UserPlus size={20} />}
            title="No leads yet"
            description="Leads will start arriving automatically once the marketing site's apply form is wired to this CRM (Epic 20). Until then, add anyone your team is talking to directly."
            action={<AddLeadDialog onCreated={() => reload()} />}
          />
        )}

        {leads && leads.items.length === 0 && hasFilters && <NoResults noun="leads" onClear={clearFilters} hint="Try a different status, source, or search term." />}

        {leads && leads.items.length > 0 && (
          <RefreshOverlay active={state.isRefreshing} className="flex flex-col gap-3">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Lead</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Score</TableHead>
                  <TableHead>Assigned to</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {leads.items.map((lead: Lead) => (
                  <ClickableRow key={lead.id} href={`${crm}/leads/${lead.id}`}>
                    <TableCell>
                      <div className="flex items-center gap-2.5">
                        <Avatar fallback={getInitials(lead.name)} size="sm" />
                        <div className="min-w-0">
                          <CellLink href={`${crm}/leads/${lead.id}`} className="block truncate text-[13px]">
                            {lead.name}
                          </CellLink>
                          <p className="truncate text-[12px] text-muted-foreground">{lead.company ?? lead.email}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <LeadSourceBadge source={lead.source} size="sm" />
                    </TableCell>
                    <TableCell>
                      <LeadStatusBadge status={lead.status} size="sm" />
                    </TableCell>
                    <TableCell className="text-right">
                      <LeadScore score={lead.score} />
                    </TableCell>
                    <TableCell>
                      {lead.assignedTo ? (
                        <span className="text-[13px] text-foreground">{lead.assignedTo.name}</span>
                      ) : (
                        <Badge variant="outline" size="sm">
                          Unassigned
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <span className={typography.meta}>{formatRelativeTime(lead.createdAt)}</span>
                    </TableCell>
                  </ClickableRow>
                ))}
              </TableBody>
            </Table>

            <Pagination page={leads.page} pageSize={leads.limit} total={leads.total} onPageChange={setPage} itemLabel="leads" />
          </RefreshOverlay>
        )}
      </Reveal>
    </PageStack>
  );
}
