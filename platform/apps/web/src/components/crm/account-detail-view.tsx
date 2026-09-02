"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Building2, Globe, Handshake, Mail, Phone } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  Skeleton,
  SkeletonText,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@bebest/ui";
import { ErrorPanel } from "@/components/patterns/error-panel";
import { ActivityTimeline } from "@/components/crm/activity-timeline";
import { LogActivityDialog } from "@/components/crm/log-activity-dialog";
import { DealStageBadge } from "@/components/crm/status-badges";
import { fetchAccount, fetchActivitiesForAccount, fetchDealsForAccount, fetchLead } from "@/data/crm/client";
import type { Account } from "@/data/crm/types";
import { useAsyncData } from "@/lib/use-async-data";
import { formatCurrency, formatDate } from "@/lib/format";

const PLAN_LABEL: Record<Account["plan"], string> = {
  free: "Free",
  starter: "Starter",
  growth: "Growth",
  pro: "Pro",
  agency: "Agency",
  enterprise: "Enterprise",
};

function AccountDetailSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <Skeleton className="h-6 w-56" />
      <Skeleton className="h-9 w-72 rounded-lg" />
      <SkeletonText lines={5} />
    </div>
  );
}

export function AccountDetailView({ accountId }: { accountId: string }) {
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

  return (
    <div className="flex flex-col gap-5">
      <Link href="/crm/accounts" className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground w-fit">
        <ArrowLeft size={14} /> Accounts
      </Link>

      {state.status === "loading" && <AccountDetailSkeleton />}

      {state.status === "error" && <ErrorPanel message={state.error.message} onRetry={reload} />}

      {state.status === "success" && state.data.account === null && (
        <EmptyState
          icon={<Building2 size={20} />}
          title="Account not found"
          description="This account may have been removed, or the link is out of date."
          action={
            <Button variant="secondary" size="sm" onClick={() => router.push("/crm/accounts")}>
              Back to accounts
            </Button>
          }
        />
      )}

      {state.status === "success" && state.data.account && (
        <>
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
            <div className="flex items-center gap-3.5">
              <span className="flex size-11 items-center justify-center rounded-lg border border-border bg-surface text-muted-foreground shrink-0">
                <Building2 size={18} />
              </span>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="font-display text-[22px] font-semibold text-foreground tracking-[-0.01em]">{state.data.account.name}</h1>
                  <Badge variant="outline" size="sm">{PLAN_LABEL[state.data.account.plan]}</Badge>
                </div>
                {state.data.account.domain && (
                  <a
                    href={`https://${state.data.account.domain}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-accent mt-0.5"
                  >
                    <Globe size={12} /> {state.data.account.domain}
                  </a>
                )}
              </div>
            </div>
            <LogActivityDialog organizationId={state.data.account.id} onLogged={reload} />
          </div>

          <Tabs defaultValue="overview">
            <TabsList>
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="contacts">Contacts ({state.data.account.contacts.length})</TabsTrigger>
              <TabsTrigger value="deals">Deals ({state.data.deals.length})</TabsTrigger>
              <TabsTrigger value="activity">Activity</TabsTrigger>
            </TabsList>

            <TabsContent value="overview">
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <Card>
                  <CardHeader><CardTitle>Origin</CardTitle></CardHeader>
                  <CardContent className="text-[13px]">
                    {state.data.sourceLead ? (
                      <>
                        <p className="text-muted-foreground">Converted from lead</p>
                        <Link href={`/crm/leads/${state.data.sourceLead.id}`} className="text-accent hover:underline font-medium">
                          {state.data.sourceLead.name}
                        </Link>
                      </>
                    ) : (
                      <p className="text-muted-foreground">Signed up directly — no prior lead record.</p>
                    )}
                    <p className="text-[12px] text-subtle-foreground mt-2">Customer since {formatDate(state.data.account.createdAt)}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader><CardTitle>Primary contact</CardTitle></CardHeader>
                  <CardContent className="text-[13px]">
                    {(() => {
                      const primary = state.data.account.contacts.find((c) => c.primary) ?? state.data.account.contacts[0];
                      return primary ? (
                        <div className="flex flex-col gap-1">
                          <p className="font-medium text-foreground">{primary.name}</p>
                          {primary.role && <p className="text-muted-foreground">{primary.role}</p>}
                          <a href={`mailto:${primary.email}`} className="text-accent hover:underline">{primary.email}</a>
                        </div>
                      ) : (
                        <p className="text-muted-foreground">No contacts on file.</p>
                      );
                    })()}
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader><CardTitle>Deal value</CardTitle></CardHeader>
                  <CardContent>
                    <p className="font-mono text-[22px] font-semibold text-foreground">
                      {formatCurrency(state.data.deals.reduce((sum, d) => sum + d.valueCents, 0))}
                    </p>
                    <p className="text-[12px] text-muted-foreground mt-1">across {state.data.deals.length} deal{state.data.deals.length === 1 ? "" : "s"}</p>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            <TabsContent value="contacts">
              {state.data.account.contacts.length === 0 ? (
                <EmptyState compact icon={<Mail size={18} />} title="No contacts on file" description="Log an activity to start capturing who you talk to here." />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Phone</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {state.data.account.contacts.map((contact) => (
                      <TableRow key={contact.id}>
                        <TableCell>
                          <span className="text-[13px] font-medium text-foreground">{contact.name}</span>
                          {contact.primary && <Badge variant="outline" size="sm" className="ml-2">Primary</Badge>}
                        </TableCell>
                        <TableCell><span className="text-[13px] text-muted-foreground">{contact.role ?? "—"}</span></TableCell>
                        <TableCell>
                          <a href={`mailto:${contact.email}`} className="text-[13px] text-accent hover:underline">{contact.email}</a>
                        </TableCell>
                        <TableCell>
                          {contact.phone ? (
                            <span className="flex items-center gap-1.5 text-[13px] text-muted-foreground"><Phone size={12} />{contact.phone}</span>
                          ) : (
                            <span className="text-[13px] text-subtle-foreground">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </TabsContent>

            <TabsContent value="deals">
              {state.data.deals.length === 0 ? (
                <EmptyState
                  compact
                  icon={<Handshake size={18} />}
                  title="No deals for this account yet"
                  description="Deals for an upsell or renewal will show up here once created."
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Deal</TableHead>
                      <TableHead>Stage</TableHead>
                      <TableHead>Value</TableHead>
                      <TableHead>Owner</TableHead>
                      <TableHead>Expected close</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {state.data.deals.map((deal) => (
                      <TableRow key={deal.id} className="cursor-pointer" onClick={() => router.push(`/crm/deals/${deal.id}`)}>
                        <TableCell><span className="text-[13px] font-medium text-foreground">{deal.title}</span></TableCell>
                        <TableCell><DealStageBadge stage={deal.stage} size="sm" /></TableCell>
                        <TableCell><span className="font-mono text-[13px] text-foreground">{formatCurrency(deal.valueCents, deal.currency)}</span></TableCell>
                        <TableCell><span className="text-[13px] text-muted-foreground">{deal.owner.name}</span></TableCell>
                        <TableCell>
                          <span className="text-[12.5px] text-muted-foreground">{deal.expectedCloseDate ? formatDate(deal.expectedCloseDate) : "—"}</span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </TabsContent>

            <TabsContent value="activity">
              <Card>
                <CardContent className="pt-5">
                  <ActivityTimeline activities={state.data.activities} emptyHint="Nothing logged against this account yet." />
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}
