"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Building2, Calendar, Hash, Mail, Phone, UserRound } from "lucide-react";
import {
  Avatar,
  Badge,
  Button,
  EmptyState,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  cn,
  getInitials,
} from "@bebest/ui";
import { ErrorPanel } from "@/components/patterns/error-panel";
import { DetailHeader } from "@/components/patterns/page-header";
import { DetailLayout } from "@/components/patterns/layout";
import { PageStack } from "@/components/patterns/motion";
import { PropertyList, Section } from "@/components/patterns/section";
import { CellLink, ClickableRow } from "@/components/patterns/data-table";
import { DetailSkeleton } from "@/components/patterns/states";
import { typography } from "@/components/patterns/typography";
import { ActivityTimeline } from "@/components/crm/activity-timeline";
import { AddDealDialog } from "@/components/crm/add-deal-dialog";
import { LogActivityDialog } from "@/components/crm/log-activity-dialog";
import { DealCloseDate, pipelineTotals } from "@/components/crm/deal-utils";
import { AccountPlanBadge, DealStageBadge, LeadSourceBadge, LeadStatusBadge } from "@/components/crm/status-badges";
import { fetchAccount, fetchActivitiesForAccount, fetchDealsForAccount, fetchLead } from "@/data/crm/client";
import { useAsyncData } from "@/lib/use-async-data";
import { useCrmBasePath } from "@/components/crm/crm-base-path";
import { formatCurrency, formatDate, formatRelativeTime } from "@/lib/format";

export function AccountDetailView({ accountId }: { accountId: string }) {
  const crm = useCrmBasePath();
  const router = useRouter();

  const { reload, ...state } = useAsyncData(async () => {
    const account = await fetchAccount(accountId);
    if (!account) return { account: null };
    const [dealsForAccount, activitiesForAccount, sourceLead] = await Promise.all([
      fetchDealsForAccount(accountId),
      fetchActivitiesForAccount(accountId),
      account.convertedFromLeadId ? fetchLead(account.convertedFromLeadId) : Promise.resolve(null),
    ]);
    return { account, deals: dealsForAccount, activities: activitiesForAccount, sourceLead };
  }, [accountId]);

  if (state.status === "loading") return <DetailSkeleton withLeading label="Loading account…" />;

  if (state.status === "error") {
    return (
      <>
        <DetailHeader backHref={`${crm}/accounts`} backLabel="Accounts" title="Account" />
        <ErrorPanel title="This account didn't load" message={state.error.message} onRetry={reload} />
      </>
    );
  }

  const { account } = state.data;
  if (account === null) {
    return (
      <EmptyState
        icon={<Building2 size={20} />}
        title="Account not found"
        description="This account may have been removed, or the link is out of date."
        action={
          <Button variant="secondary" size="sm" onClick={() => router.push(`${crm}/accounts`)}>
            Back to accounts
          </Button>
        }
      />
    );
  }

  const { deals, activities, sourceLead } = state.data;
  const totals = pipelineTotals(deals);
  const primary = account.contacts.find((c) => c.primary) ?? account.contacts[0] ?? null;
  const lastActivity = activities[0] ?? null;

  const addDeal = (variant: "primary" | "secondary") => (
    <AddDealDialog
      onCreated={reload}
      defaultLink={{ kind: "account", id: account.id, name: account.name }}
      triggerLabel="Add a deal"
      triggerVariant={variant}
    />
  );

  return (
    <>
      <DetailHeader
        backHref={`${crm}/accounts`}
        backLabel="Accounts"
        leading={
          <span
            className="flex size-12 items-center justify-center rounded-xl border border-border bg-surface font-display text-[18px] font-semibold text-muted-foreground"
            aria-hidden="true"
          >
            {account.name.trim().charAt(0).toUpperCase() || <Building2 size={20} />}
          </span>
        }
        title={account.name}
        badges={account.plan ? <AccountPlanBadge plan={account.plan} size="md" /> : undefined}
        subtitle={
          sourceLead ? (
            <>
              Customer since {formatDate(account.createdAt)} · Converted from{" "}
              <Link href={`${crm}/leads/${sourceLead.id}`} className="rounded-sm text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                {sourceLead.name}
              </Link>
            </>
          ) : (
            `Customer since ${formatDate(account.createdAt)} · Signed up directly`
          )
        }
        meta={[
          { label: "Primary contact", value: primary ? primary.name : <span className="text-subtle-foreground">&mdash;</span> },
          {
            label: "Open pipeline",
            value: (
              <span className={typography.numeric}>
                {totals.openCount > 0 ? `${formatCurrency(totals.openValue)} · ${totals.openCount}` : "—"}
              </span>
            ),
          },
          {
            label: "Weighted",
            value: <span className={typography.numeric}>{totals.openCount > 0 ? formatCurrency(totals.weightedValue) : "—"}</span>,
          },
          { label: "Won", value: <span className={typography.numeric}>{totals.wonCount > 0 ? formatCurrency(totals.wonValue) : "—"}</span> },
          {
            label: "Last activity",
            value: lastActivity ? (
              <span title={formatDate(lastActivity.createdAt)}>{formatRelativeTime(lastActivity.createdAt)}</span>
            ) : (
              <span className="text-subtle-foreground">None yet</span>
            ),
          },
        ]}
        actions={
          <>
            <LogActivityDialog organizationId={account.id} onLogged={reload} />
            {addDeal("primary")}
          </>
        }
      />

      <PageStack>
        <DetailLayout
          aside={
            <>
              <Section title="Contacts" description={account.contacts.length === 1 ? "1 person on file" : `${account.contacts.length} people on file`} flush>
                {account.contacts.length === 0 ? (
                  <p className={cn(typography.secondary, "px-5 py-4")}>
                    No contacts on file yet. The person who converted from a lead appears here automatically.
                  </p>
                ) : (
                  <ul className="divide-y divide-border">
                    {account.contacts.map((contact) => (
                      <li key={contact.id} className="flex items-start gap-3 px-5 py-3.5">
                        <Avatar fallback={getInitials(contact.name)} size="sm" />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <p className="truncate text-[13px] font-medium text-foreground">{contact.name}</p>
                            {contact.primary && (
                              <Badge variant="outline" size="sm">
                                Primary
                              </Badge>
                            )}
                          </div>
                          {contact.role && <p className={typography.meta}>{contact.role}</p>}
                          <a
                            href={`mailto:${contact.email}`}
                            className="mt-1 flex w-fit max-w-full items-center gap-1.5 rounded-sm text-[12.5px] text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            <Mail size={12} className="shrink-0" aria-hidden="true" />
                            <span className="break-all">{contact.email}</span>
                          </a>
                          {contact.phone && (
                            <a
                              href={`tel:${contact.phone}`}
                              className="mt-0.5 flex w-fit items-center gap-1.5 rounded-sm text-[12.5px] text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                              <Phone size={12} className="shrink-0" aria-hidden="true" />
                              {contact.phone}
                            </a>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>

              <Section title="Details">
                <PropertyList
                  items={[
                    { label: "Workspace", icon: <Hash size={13} />, value: account.slug ? <span className={typography.numeric}>{account.slug}</span> : null },
                    { label: "Customer since", icon: <Calendar size={13} />, value: formatDate(account.createdAt) },
                    {
                      label: "Origin",
                      icon: <UserRound size={13} />,
                      value: sourceLead ? (
                        <span className="flex flex-col items-start gap-1.5">
                          <Link
                            href={`${crm}/leads/${sourceLead.id}`}
                            className="rounded-sm text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            {sourceLead.name}
                          </Link>
                          <span className="flex flex-wrap gap-1.5">
                            <LeadSourceBadge source={sourceLead.source} size="sm" />
                            <LeadStatusBadge status={sourceLead.status} size="sm" />
                          </span>
                        </span>
                      ) : (
                        "Signed up directly"
                      ),
                    },
                  ]}
                />
              </Section>
            </>
          }
        >
          <Section
            title="Deals"
            description={
              deals.length === 0
                ? "Upsells, renewals and new engagements with this account."
                : `${deals.length} ${deals.length === 1 ? "deal" : "deals"} · ${totals.openCount} open`
            }
            actions={deals.length > 0 ? addDeal("secondary") : undefined}
            flush={deals.length > 0}
          >
            {deals.length === 0 ? (
              <EmptyState
                compact
                icon={<Building2 size={18} />}
                title="No deals with this account yet"
                description="Start a deal for an upsell, renewal or new engagement. It will be linked here and counted in the account's pipeline."
                action={addDeal("secondary")}
              />
            ) : (
              <Table framed={false}>
                <TableHeader>
                  <TableRow>
                    <TableHead>Deal</TableHead>
                    <TableHead>Stage</TableHead>
                    <TableHead className="text-right">Value</TableHead>
                    <TableHead>Owner</TableHead>
                    <TableHead>Expected close</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {deals.map((deal) => {
                    const href = `${crm}/deals/${deal.id}`;
                    return (
                      <ClickableRow key={deal.id} href={href}>
                        <TableCell>
                          <CellLink href={href} className="block max-w-[260px] truncate text-[13px]">
                            {deal.title}
                          </CellLink>
                        </TableCell>
                        <TableCell>
                          <DealStageBadge stage={deal.stage} size="sm" />
                        </TableCell>
                        <TableCell className="text-right">
                          <span className={typography.numeric}>{formatCurrency(deal.valueCents, deal.currency)}</span>
                        </TableCell>
                        <TableCell>
                          <span className="truncate text-[13px] text-muted-foreground">{deal.owner.name}</span>
                        </TableCell>
                        <TableCell>
                          <DealCloseDate deal={deal} emptyLabel="—" className="text-[12px]" />
                        </TableCell>
                      </ClickableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </Section>

          <Section title="Activity" description="Calls, emails, notes and system events with this account, newest first.">
            <ActivityTimeline activities={activities} emptyHint="Nothing logged against this account yet — log a call, email, or note to start its history." />
          </Section>
        </DetailLayout>
      </PageStack>
    </>
  );
}
