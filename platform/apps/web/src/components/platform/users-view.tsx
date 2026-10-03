"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Search, UsersRound } from "lucide-react";
import {
  Avatar,
  Badge,
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
  getInitials,
} from "@bebest/ui";
import { PageHeader } from "@/components/patterns/page-header";
import { PLATFORM_PAGE_SIZE, fetchPlatformUsers } from "@/data/platform/client";
import { useAsyncData } from "@/lib/use-async-data";
import {
  ALL,
  FilterBar,
  FilterSelect,
  PlatformErrorState,
  PlatformRoleBadge,
  RefreshingHint,
  SearchField,
  TableSkeleton,
  TimeAgo,
  rowLinkProps,
  useDebouncedValue,
} from "./platform-ui";

const COLUMNS = ["Person", "Access", "Orgs", "Last sign-in", "Joined"];
const ROLE_OPTIONS = [
  { value: "none", label: "Customers only" },
  { value: "support", label: "Platform support" },
  { value: "admin", label: "Platform admin" },
];

/** Platform → Users: "Who is this person, and what can they reach?" */
export function UsersView() {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const q = useDebouncedValue(search.trim());
  const [role, setRole] = useState(ALL);
  const [page, setPage] = useState(1);
  const [prevQ, setPrevQ] = useState(q);
  if (prevQ !== q) {
    setPrevQ(q);
    setPage(1);
  }

  const state = useAsyncData(() => fetchPlatformUsers({ q, platformRole: role === ALL ? undefined : role, page }), [q, role, page]);
  const data = state.status === "success" ? state.data : null;
  const filtered = q !== "" || role !== ALL;

  function clear() {
    setSearch("");
    setRole(ALL);
    setPage(1);
  }

  return (
    <>
      <PageHeader
        eyebrow="Platform"
        title="Users"
        description="Every person with a BeBest account. Find someone by name or email, then see their organizations and sign-in history."
      />
      <div className="flex flex-col gap-4">
        <FilterBar onClear={clear} active={filtered}>
          <SearchField value={search} onChange={setSearch} placeholder="Search name or email" label="Search users" />
          <FilterSelect
            label="Filter by platform access"
            value={role}
            onChange={(v) => {
              setRole(v);
              setPage(1);
            }}
            options={ROLE_OPTIONS}
            allLabel="Everyone"
            className="sm:w-44"
          />
          <div className="sm:ml-auto">
            <RefreshingHint active={state.isRefreshing} />
          </div>
        </FilterBar>

        {state.status === "loading" && <TableSkeleton columns={COLUMNS} label="Loading users" />}
        {state.status === "error" && <PlatformErrorState error={state.error} onRetry={state.reload} resource="users" />}

        {data && data.items.length === 0 && (
          <EmptyState
            compact
            icon={filtered ? <Search size={18} /> : <UsersRound size={18} />}
            title={filtered ? "No users match" : "No users yet"}
            description={filtered ? "Nobody matches this search. Check the spelling of the email, or clear the access filter." : "People appear here when they sign up."}
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
              <caption className="sr-only">Users, newest first</caption>
              <TableHeader>
                <TableRow>
                  {COLUMNS.map((c) => (
                    <TableHead key={c} className={c === "Orgs" ? "text-right" : undefined}>
                      {c}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((u) => {
                  const href = `/platform/users/${u.id}`;
                  return (
                    <TableRow key={u.id} {...rowLinkProps(() => router.push(href))}>
                      <TableCell className="min-w-[240px]">
                        <div className="flex items-center gap-2.5">
                          <Avatar fallback={getInitials(u.name || u.email)} size="sm" />
                          <div className="min-w-0">
                            <Link
                              href={href}
                              className="block truncate rounded-sm text-[13px] font-medium text-foreground hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                              {u.name || u.email}
                            </Link>
                            <p className="truncate text-[12px] text-muted-foreground">{u.email}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1.5">
                          {u.platformRole === "none" ? <span className="text-[12.5px] text-muted-foreground">Customer</span> : <PlatformRoleBadge role={u.platformRole} />}
                          {!u.emailVerified && (
                            <Badge variant="warning" size="sm">
                              Unverified
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-mono text-[12.5px] tabular-nums">{u.membershipCount}</TableCell>
                      <TableCell>
                        <TimeAgo iso={u.lastLoginAt} empty="Never" />
                      </TableCell>
                      <TableCell>
                        <TimeAgo iso={u.createdAt} />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            <Pagination page={page} pageSize={PLATFORM_PAGE_SIZE} total={data.total} onPageChange={setPage} itemLabel="users" />
          </RefreshOverlay>
        )}
      </div>
    </>
  );
}
