"use client";

import { Fragment, useEffect, useId, useState } from "react";
import Link from "next/link";
import { ChevronRight, ScrollText, X } from "lucide-react";
import {
  Badge,
  Button,
  EmptyState,
  Input,
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
import { PageHeader } from "@/components/patterns/page-header";
import { PLATFORM_PAGE_SIZE, fetchPlatformAudit } from "@/data/platform/client";
import type { PlatformAuditItem } from "@/data/platform/types";
import { formatDateTime } from "@/lib/format";
import { useAsyncData } from "@/lib/use-async-data";
import {
  ALL,
  FilterBar,
  FilterSelect,
  PlatformErrorState,
  RefreshingHint,
  SearchField,
  StatusBadge,
  TableSkeleton,
  TimeAgo,
  humanize,
  useDebouncedValue,
  useRememberedLabel,
} from "./platform-ui";

const SOURCE_OPTIONS = [
  { value: "app", label: "Actions (app)" },
  { value: "platform", label: "Staff access (platform)" },
];
const COLUMNS = ["When", "Action", "Actor", "Organization", "Result"];

export interface AuditInitial {
  orgId?: string;
  userId?: string;
  source?: string;
  action?: string;
}

/** `yyyy-mm-dd` (local) → ISO instant at local midnight; `addDay` for an exclusive upper bound. */
function dayToIso(day: string, addDay = false): string | undefined {
  if (!day) return undefined;
  const [y, m, d] = day.split("-").map(Number);
  if (!y || !m || !d) return undefined;
  return new Date(y, m - 1, d + (addDay ? 1 : 0)).toISOString();
}

/** Platform → Audit log: "Who did what, where, and who looked?" */
export function AuditView({ initial }: { initial: AuditInitial }) {
  const [source, setSource] = useState(initial.source === "app" || initial.source === "platform" ? initial.source : ALL);
  const [actionInput, setActionInput] = useState(initial.action ?? "");
  const action = useDebouncedValue(actionInput.trim());
  const [orgId, setOrgId] = useState(initial.orgId ?? "");
  const [userId, setUserId] = useState(initial.userId ?? "");
  const [fromDay, setFromDay] = useState("");
  const [toDay, setToDay] = useState("");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [prevAction, setPrevAction] = useState(action);
  if (prevAction !== action) {
    setPrevAction(action);
    setPage(1);
  }

  const rangeInvalid = Boolean(fromDay && toDay && fromDay > toDay);
  const state = useAsyncData(
    () =>
      fetchPlatformAudit({
        source: source === ALL ? undefined : source,
        action: action || undefined,
        orgId: orgId || undefined,
        userId: userId || undefined,
        from: dayToIso(fromDay),
        to: rangeInvalid ? undefined : dayToIso(toDay, true),
        page,
      }),
    [source, action, orgId, userId, fromDay, toDay, page],
  );
  const data = state.status === "success" ? state.data : null;

  useEffect(() => {
    const params = new URLSearchParams();
    if (source !== ALL) params.set("source", source);
    if (action) params.set("action", action);
    if (orgId) params.set("orgId", orgId);
    if (userId) params.set("userId", userId);
    const s = params.toString();
    window.history.replaceState(null, "", s ? `?${s}` : window.location.pathname);
  }, [source, action, orgId, userId]);

  const filtered = source !== ALL || action !== "" || orgId !== "" || userId !== "" || fromDay !== "" || toDay !== "";
  const orgName = useRememberedLabel(orgId, data?.items.find((i) => i.organizationId === orgId)?.organizationName);
  const userEmail = useRememberedLabel(userId, data?.items.find((i) => i.userId === userId)?.userEmail);

  function clear() {
    setSource(ALL);
    setActionInput("");
    setOrgId("");
    setUserId("");
    setFromDay("");
    setToDay("");
    setPage(1);
  }

  function toggle(key: string) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <>
      <PageHeader
        eyebrow="Platform"
        title="Audit log"
        description="One timeline of what people and agents did in the product (app) and every request staff made in this Platform view (platform), reads included."
      />
      <div className="flex flex-col gap-4">
        <FilterBar onClear={clear} active={filtered}>
          <SearchField value={actionInput} onChange={setActionInput} placeholder="Action contains… e.g. job_cancelled" label="Filter by action" />
          <FilterSelect label="Filter by source" value={source} onChange={(v) => { setSource(v); setPage(1); }} options={SOURCE_OPTIONS} allLabel="All sources" className="sm:w-52" />
          <DateField label="From" value={fromDay} onChange={(v) => { setFromDay(v); setPage(1); }} />
          <DateField label="To" value={toDay} onChange={(v) => { setToDay(v); setPage(1); }} invalid={rangeInvalid} />
          {orgId && <Chip label={`Org: ${orgName ?? orgId.slice(0, 8)}`} onRemove={() => { setOrgId(""); setPage(1); }} removeLabel="Remove organization filter" />}
          {userId && <Chip label={`Actor: ${userEmail ?? userId.slice(0, 8)}`} onRemove={() => { setUserId(""); setPage(1); }} removeLabel="Remove actor filter" />}
          <div className="sm:ml-auto">
            <RefreshingHint active={state.isRefreshing} />
          </div>
        </FilterBar>
        {rangeInvalid && (
          <p role="alert" className="text-[12.5px] text-danger">
            “From” is after “To” — the end date is ignored until that&apos;s fixed.
          </p>
        )}

        {state.status === "loading" && <TableSkeleton columns={COLUMNS} rows={8} label="Loading audit log" />}
        {state.status === "error" && <PlatformErrorState error={state.error} onRetry={state.reload} resource="the audit log" />}

        {data && data.items.length === 0 && (
          <EmptyState
            compact
            icon={<ScrollText size={18} />}
            title={filtered ? "No events match" : "No audit events yet"}
            description={filtered ? "Nothing was recorded that matches these filters. Widen the date range or clear a filter." : "Events appear as soon as anyone signs in or acts."}
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
              <caption className="sr-only">Audit events, newest first</caption>
              <TableHeader>
                <TableRow>
                  {COLUMNS.map((c) => (
                    <TableHead key={c}>{c}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((item) => {
                  const key = `${item.source}:${item.id}`;
                  return <AuditRow key={key} item={item} open={open.has(key)} onToggle={() => toggle(key)} onActor={(id) => { setUserId(id); setPage(1); }} onOrg={(id) => { setOrgId(id); setPage(1); }} />;
                })}
              </TableBody>
            </Table>
            <Pagination page={page} pageSize={PLATFORM_PAGE_SIZE} total={data.total} onPageChange={setPage} itemLabel="events" />
          </RefreshOverlay>
        )}
      </div>
    </>
  );
}

function AuditRow({
  item,
  open,
  onToggle,
  onActor,
  onOrg,
}: {
  item: PlatformAuditItem;
  open: boolean;
  onToggle: () => void;
  onActor: (id: string) => void;
  onOrg: (id: string) => void;
}) {
  const panelId = useId();
  return (
    <Fragment>
      <TableRow className={cn(open && "border-b-0 bg-surface/40")}>
        <TableCell className="min-w-[150px]">
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            aria-controls={panelId}
            className="-ml-1 flex items-center gap-1.5 rounded-md px-1 py-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ChevronRight size={14} aria-hidden className={cn("shrink-0 text-subtle-foreground transition-transform duration-150 motion-reduce:transition-none", open && "rotate-90")} />
            <span className="flex flex-col">
              <TimeAgo iso={item.createdAt} className="text-foreground" />
              <span className="sr-only">{open ? "Hide details" : "Show details"}</span>
            </span>
          </button>
        </TableCell>
        <TableCell className="min-w-[220px] max-w-[360px]">
          <div className="flex items-center gap-2">
            <Badge variant={item.source === "platform" ? "accent" : "neutral"} size="sm">
              {item.source}
            </Badge>
            <span className="truncate font-mono text-[12.5px] text-foreground" title={item.action}>
              {item.action}
            </span>
          </div>
        </TableCell>
        <TableCell className="min-w-[160px]">
          {item.userId ? (
            <button
              type="button"
              onClick={() => onActor(item.userId!)}
              className="max-w-[220px] truncate rounded-sm text-left text-[13px] text-foreground hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              title="Show only this actor"
            >
              {item.userEmail ?? item.userId.slice(0, 8)}
            </button>
          ) : (
            <span className="text-[12.5px] text-muted-foreground">{item.actorType ? humanize(item.actorType) : "—"}</span>
          )}
          {(item.actorRole || item.platformRole) && (
            <p className="text-[11.5px] text-subtle-foreground">{item.platformRole ? `platform ${item.platformRole}` : item.actorRole}</p>
          )}
        </TableCell>
        <TableCell className="min-w-[140px]">
          {item.organizationId ? (
            <button
              type="button"
              onClick={() => onOrg(item.organizationId!)}
              className="max-w-[200px] truncate rounded-sm text-left text-[13px] text-foreground hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              title="Show only this organization"
            >
              {item.organizationName ?? item.organizationId.slice(0, 8)}
            </button>
          ) : (
            <span className="text-[12.5px] text-subtle-foreground">—</span>
          )}
        </TableCell>
        <TableCell>{item.result ? <StatusBadge status={item.result} /> : <span className="text-[12.5px] text-subtle-foreground">—</span>}</TableCell>
      </TableRow>
      {open && (
        <TableRow className="bg-surface/40 hover:bg-surface/40">
          <TableCell colSpan={5} className="pt-0">
            <div id={panelId} className="grid gap-4 rounded-lg border border-border bg-surface-raised p-4 md:grid-cols-[minmax(0,260px)_minmax(0,1fr)]">
              <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[12.5px]">
                <Detail label="Time">{formatDateTime(item.createdAt)}</Detail>
                <Detail label="Event id">
                  <span className="break-all font-mono">{item.id}</span>
                </Detail>
                {item.method && <Detail label="Request">
                  <span className="break-all font-mono">{item.method} {item.path}</span>
                </Detail>}
                {item.entityType && <Detail label="Entity">{humanize(item.entityType)}</Detail>}
                {item.entityId && <Detail label="Entity id"><span className="break-all font-mono">{item.entityId}</span></Detail>}
                {item.targetUserId && (
                  <Detail label="Target user">
                    <Link href={`/platform/users/${item.targetUserId}`} className="text-accent hover:underline">
                      Open user
                    </Link>
                  </Detail>
                )}
                {item.organizationId && (
                  <Detail label="Organization">
                    <Link href={`/platform/organizations/${item.organizationId}`} className="text-accent hover:underline">
                      Open organization
                    </Link>
                  </Detail>
                )}
              </dl>
              <div className="min-w-0">
                <p className="mb-1.5 font-mono text-[10.5px] uppercase tracking-[0.1em] text-subtle-foreground">Details</p>
                {item.details && Object.keys(item.details).length > 0 ? (
                  <pre className="max-h-64 overflow-auto rounded-md bg-surface p-3 font-mono text-[11.5px] leading-relaxed text-foreground">{JSON.stringify(item.details, null, 2)}</pre>
                ) : (
                  <p className="text-[12.5px] text-muted-foreground">{item.source === "platform" ? "Staff access events record the request only." : "No extra details recorded."}</p>
                )}
              </div>
            </div>
          </TableCell>
        </TableRow>
      )}
    </Fragment>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-subtle-foreground">{label}</dt>
      <dd className="min-w-0 text-foreground">{children}</dd>
    </>
  );
}

function DateField({ label, value, onChange, invalid }: { label: string; value: string; onChange: (v: string) => void; invalid?: boolean }) {
  return (
    <label className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
      <span className="w-9 sm:w-auto">{label}</span>
      <Input type="date" value={value} onChange={(e) => onChange(e.target.value)} className={cn("h-10 w-full sm:h-9 sm:w-[150px]", invalid && "border-danger")} aria-invalid={invalid || undefined} />
    </label>
  );
}

function Chip({ label, onRemove, removeLabel }: { label: string; onRemove: () => void; removeLabel: string }) {
  return (
    <Badge variant="outline" size="md" className="h-9 max-w-full gap-1 pr-1">
      <span className="truncate">{label}</span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={removeLabel}
        className="flex size-7 shrink-0 items-center justify-center rounded-full hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <X size={12} aria-hidden />
      </button>
    </Badge>
  );
}
