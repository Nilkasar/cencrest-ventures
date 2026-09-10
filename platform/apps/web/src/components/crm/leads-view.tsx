"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, UserPlus, X } from "lucide-react";
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardContent,
  EmptyState,
  Input,
  Pagination,
  RefreshOverlay,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  getInitials,
} from "@bebest/ui";
import { ErrorPanel } from "@/components/patterns/error-panel";
import { AddLeadDialog } from "@/components/crm/add-lead-dialog";
import { LeadScore, LeadSourceBadge, LeadStatusBadge } from "@/components/crm/status-badges";
import { DEFAULT_PAGE_SIZE, fetchLeads, type LeadFilters } from "@/data/crm/client";
import type { Lead, LeadSource, LeadStatus } from "@/data/crm/types";
import { useAsyncData } from "@/lib/use-async-data";
import { formatRelativeTime } from "@/lib/format";

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

function LeadsTableSkeleton() {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Lead</TableHead>
          <TableHead>Source</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Score</TableHead>
          <TableHead>Assigned to</TableHead>
          <TableHead>Created</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {Array.from({ length: 6 }).map((_, i) => (
          <TableRow key={i}>
            <TableCell>
              <div className="flex items-center gap-2.5">
                <Skeleton className="size-8 rounded-full shrink-0" />
                <div className="flex flex-col gap-1.5">
                  <Skeleton className="h-3 w-32" />
                  <Skeleton className="h-2.5 w-20" />
                </div>
              </div>
            </TableCell>
            <TableCell><Skeleton className="h-5 w-24 rounded-full" /></TableCell>
            <TableCell><Skeleton className="h-5 w-20 rounded-full" /></TableCell>
            <TableCell><Skeleton className="h-3 w-6" /></TableCell>
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

export function LeadsView() {
  const router = useRouter();
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

  return (
    <div className="flex flex-col gap-6">
      {leads && counts && leads.total > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <StatCard label="Total leads" value={String(leads.total)} />
          <StatCard label="Needs a response" value={String(counts.new)} />
          <StatCard label="Converted" value={String(counts.converted)} />
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-subtle-foreground" aria-hidden="true" />
          <Input
            placeholder="Search name, company, email"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            className="pl-8"
            aria-label="Search leads"
          />
        </div>
        <Select value={status} onValueChange={(value) => {
            setStatus(value as LeadStatus | "all");
            setPage(1);
          }}>
          <SelectTrigger className="w-full sm:w-40" aria-label="Filter by status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={source} onValueChange={(value) => {
            setSource(value as LeadSource | "all");
            setPage(1);
          }}>
          <SelectTrigger className="w-full sm:w-40" aria-label="Filter by source">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SOURCE_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
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
          <AddLeadDialog onCreated={() => reload()} />
        </div>
      </div>

      {state.status === "loading" && <LeadsTableSkeleton />}

      {state.status === "error" && (
        <ErrorPanel message={state.error.message} onRetry={reload} />
      )}

      {leads && leads.items.length === 0 && !hasFilters && (
        <EmptyState
          icon={<UserPlus size={20} />}
          eyebrow="Leads"
          title="No leads yet"
          description="Leads will start arriving automatically once the marketing site's apply form is wired to this CRM (Epic 20). Until then, add anyone your team is talking to directly."
          action={<AddLeadDialog onCreated={() => reload()} />}
        />
      )}

      {leads && leads.items.length === 0 && hasFilters && (
        <EmptyState
          compact
          icon={<Search size={18} />}
          title="No leads match these filters"
          description="Try a different status, source, or search term."
          action={
            <Button variant="secondary" size="sm" onClick={clearFilters}>
              Clear filters
            </Button>
          }
        />
      )}

      {leads && leads.items.length > 0 && (
        <RefreshOverlay active={state.isRefreshing} className="flex flex-col gap-3">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Lead</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Score</TableHead>
              <TableHead>Assigned to</TableHead>
              <TableHead>Created</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {leads.items.map((lead: Lead) => (
              <TableRow
                key={lead.id}
                className="cursor-pointer"
                tabIndex={0}
                role="link"
                onClick={() => router.push(`/crm/leads/${lead.id}`)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") router.push(`/crm/leads/${lead.id}`);
                }}
              >
                <TableCell>
                  <div className="flex items-center gap-2.5">
                    <Avatar fallback={getInitials(lead.name)} size="sm" />
                    <div className="min-w-0">
                      <p className="text-[13px] font-medium text-foreground truncate">{lead.name}</p>
                      <p className="text-[12px] text-muted-foreground truncate">{lead.company ?? lead.email}</p>
                    </div>
                  </div>
                </TableCell>
                <TableCell><LeadSourceBadge source={lead.source} size="sm" /></TableCell>
                <TableCell><LeadStatusBadge status={lead.status} size="sm" /></TableCell>
                <TableCell><LeadScore score={lead.score} /></TableCell>
                <TableCell>
                  {lead.assignedTo ? (
                    <span className="text-[13px] text-foreground">{lead.assignedTo.name}</span>
                  ) : (
                    <Badge variant="outline" size="sm">Unassigned</Badge>
                  )}
                </TableCell>
                <TableCell>
                  <span className="text-[12.5px] text-muted-foreground">{formatRelativeTime(lead.createdAt)}</span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        <Pagination
          page={leads.page}
          pageSize={leads.limit}
          total={leads.total}
          onPageChange={setPage}
          itemLabel="leads"
        />
        </RefreshOverlay>
      )}
    </div>
  );
}
