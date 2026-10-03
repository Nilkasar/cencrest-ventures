"use client";

import { useState } from "react";
import Link from "next/link";
import { Camera } from "lucide-react";
import { Badge, Button, EmptyState, Pagination, RefreshOverlay, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@bebest/ui";
import { PLATFORM_PAGE_SIZE, fetchSnapshotRequests } from "@/data/platform/client";
import { SNAPSHOT_STATUSES } from "@/data/platform/types";
import { useAsyncData } from "@/lib/use-async-data";
import { ALL, FilterBar, FilterSelect, PlatformErrorState, RefreshingHint, StatusBadge, TableSkeleton, TimeAgo, humanize, opts } from "./platform-ui";

const COLUMNS = ["Domain", "Status", "Score", "Lead", "Converted", "Requested"];

/** Platform → Growth → Snapshots: "Who asked for a free snapshot, did it work, and did they become a lead/customer?" */
export function SnapshotsView() {
  const [status, setStatus] = useState(ALL);
  const [page, setPage] = useState(1);
  const state = useAsyncData(() => fetchSnapshotRequests({ status: status === ALL ? undefined : status, page }), [status, page]);
  const data = state.status === "success" ? state.data : null;

  return (
    <div className="flex flex-col gap-4">
      <FilterBar onClear={() => setStatus(ALL)} active={status !== ALL}>
        <FilterSelect
          label="Filter by snapshot status"
          value={status}
          onChange={(v) => {
            setStatus(v);
            setPage(1);
          }}
          options={opts(SNAPSHOT_STATUSES)}
          allLabel="All statuses"
        />
        <div className="sm:ml-auto">
          <RefreshingHint active={state.isRefreshing} />
        </div>
      </FilterBar>

      {state.status === "loading" && <TableSkeleton columns={COLUMNS} label="Loading snapshot requests" />}
      {state.status === "error" && <PlatformErrorState error={state.error} onRetry={state.reload} resource="snapshot requests" />}

      {data && data.items.length === 0 && (
        <EmptyState
          compact
          icon={<Camera size={18} />}
          title={status === ALL ? "No snapshot requests yet" : `No ${status} snapshots`}
          description={
            status === ALL
              ? "Requests arrive from the free snapshot form at /snapshot (every “Get Free Snapshot” CTA on the marketing site)."
              : "Try another status."
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
            <caption className="sr-only">Free snapshot requests, newest first</caption>
            <TableHeader>
              <TableRow>
                {COLUMNS.map((c) => (
                  <TableHead key={c} className={c === "Score" ? "text-right" : undefined}>
                    {c}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.items.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="min-w-[200px] max-w-[300px]">
                    <p className="truncate font-medium text-foreground">{s.domain}</p>
                    <p className="truncate text-[12px] text-muted-foreground">
                      {s.email}
                      {s.marketingConsent && (
                        <Badge variant="outline" size="sm" className="ml-1.5 align-middle">
                          Opted in
                        </Badge>
                      )}
                    </p>
                    {s.error && (
                      <p className="line-clamp-2 text-[12px] text-danger" title={s.error}>
                        {s.error}
                      </p>
                    )}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={s.status} />
                  </TableCell>
                  <TableCell className="text-right font-mono text-[12.5px] tabular-nums">{s.aiVisibilityScore === null ? "—" : s.aiVisibilityScore.toFixed(1)}</TableCell>
                  <TableCell className="min-w-[150px]">
                    {s.lead ? (
                      <>
                        <Link href={`/platform/growth/leads/${s.lead.id}`} className="block truncate text-[13px] text-foreground hover:text-accent hover:underline">
                          {s.lead.name || s.lead.email}
                        </Link>
                        <p className="text-[12px] text-muted-foreground">{humanize(s.lead.status)}</p>
                      </>
                    ) : (
                      <span className="text-[12.5px] text-subtle-foreground">No lead</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {s.convertedToOrgId ? (
                      <Link href={`/platform/organizations/${s.convertedToOrgId}`} className="text-[13px] text-accent hover:underline">
                        Signed up
                      </Link>
                    ) : (
                      <span className="text-[12.5px] text-subtle-foreground">Not yet</span>
                    )}
                    {s.convertedAt && (
                      <p>
                        <TimeAgo iso={s.convertedAt} className="text-[11.5px] text-subtle-foreground" />
                      </p>
                    )}
                  </TableCell>
                  <TableCell>
                    <TimeAgo iso={s.createdAt} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Pagination page={page} pageSize={PLATFORM_PAGE_SIZE} total={data.total} onPageChange={setPage} itemLabel="snapshot requests" />
        </RefreshOverlay>
      )}
    </div>
  );
}
