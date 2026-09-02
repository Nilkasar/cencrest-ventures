"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowLeft, Building2, Globe, Mail, Tag } from "lucide-react";
import {
  Avatar,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  SkeletonText,
  getInitials,
} from "@bebest/ui";
import { ErrorPanel } from "@/components/patterns/error-panel";
import { ActivityTimeline } from "@/components/crm/activity-timeline";
import { LogActivityDialog } from "@/components/crm/log-activity-dialog";
import { ConvertLeadDialog } from "@/components/crm/convert-lead-dialog";
import { LeadStatusPipeline } from "@/components/crm/lead-status-pipeline";
import { DealStageBadge, LeadScore, LeadSourceBadge, LeadStatusBadge } from "@/components/crm/status-badges";
import { fetchActivitiesForLead, fetchDealsForLead, fetchLead, updateLeadStatus } from "@/data/crm/client";
import type { LeadStatus } from "@/data/crm/types";
import { useAsyncData } from "@/lib/use-async-data";
import { formatCurrency, formatDate } from "@/lib/format";

const STATUS_OPTIONS: { value: LeadStatus; label: string }[] = [
  { value: "new", label: "New" },
  { value: "contacted", label: "Contacted" },
  { value: "qualified", label: "Qualified" },
  { value: "converted", label: "Converted" },
  { value: "lost", label: "Lost" },
];

function LeadDetailSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <Skeleton className="size-12 rounded-full" />
        <div className="flex flex-col gap-2">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-3 w-28" />
        </div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <SkeletonText lines={5} />
        </div>
        <div className="flex flex-col gap-4">
          <Skeleton className="h-32 rounded-xl" />
          <Skeleton className="h-24 rounded-xl" />
        </div>
      </div>
    </div>
  );
}

export function LeadDetailView({ leadId }: { leadId: string }) {
  const router = useRouter();
  const [statusUpdating, setStatusUpdating] = useState(false);

  const { reload, ...state } = useAsyncData(async () => {
    const lead = await fetchLead(leadId);
    if (!lead) return { lead: null };
    const [activities, dealsForLead] = await Promise.all([fetchActivitiesForLead(leadId), fetchDealsForLead(leadId)]);
    return { lead, activities, deals: dealsForLead };
  }, [leadId]);

  async function handleStatusChange(next: LeadStatus) {
    setStatusUpdating(true);
    try {
      await updateLeadStatus(leadId, next);
      reload();
    } finally {
      setStatusUpdating(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <Link
        href="/crm/leads"
        className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground w-fit"
      >
        <ArrowLeft size={14} /> Leads
      </Link>

      {state.status === "loading" && <LeadDetailSkeleton />}

      {state.status === "error" && <ErrorPanel message={state.error.message} onRetry={reload} />}

      {state.status === "success" && state.data.lead === null && (
        <EmptyState
          icon={<Mail size={20} />}
          title="Lead not found"
          description="This lead may have been removed, or the link is out of date."
          action={
            <Button variant="secondary" size="sm" onClick={() => router.push("/crm/leads")}>
              Back to leads
            </Button>
          }
        />
      )}

      {state.status === "success" && state.data.lead && (
        <>
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
            <div className="flex items-center gap-3.5">
              <Avatar fallback={getInitials(state.data.lead.name)} size="lg" />
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="font-display text-[22px] font-semibold text-foreground tracking-[-0.01em]">
                    {state.data.lead.name}
                  </h1>
                  <LeadStatusBadge status={state.data.lead.status} size="sm" />
                </div>
                <p className="text-[13.5px] text-muted-foreground mt-0.5">
                  {state.data.lead.company ?? "No company on file"} · {state.data.lead.email}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <LogActivityDialog leadId={leadId} onLogged={reload} />
              {state.data.lead.status === "converted" && state.data.lead.organizationId ? (
                <Button variant="secondary" size="sm" asChild>
                  <Link href={`/crm/accounts/${state.data.lead.organizationId}`}>View account</Link>
                </Button>
              ) : (
                <ConvertLeadDialog lead={state.data.lead} onConverted={(accountId) => router.push(`/crm/accounts/${accountId}`)} />
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 flex flex-col gap-5">
              <Card>
                <CardHeader>
                  <CardTitle>Activity</CardTitle>
                </CardHeader>
                <CardContent>
                  <ActivityTimeline
                    activities={state.data.activities}
                    emptyHint="Nothing logged yet — log a call, email, or note to start the history."
                  />
                </CardContent>
              </Card>
            </div>

            <div className="flex flex-col gap-5">
              <Card>
                <CardHeader>
                  <CardTitle>Pipeline</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                  <LeadStatusPipeline status={state.data.lead.status} />
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="lead-status">Update status</Label>
                    <Select
                      value={state.data.lead.status}
                      onValueChange={(v) => handleStatusChange(v as LeadStatus)}
                      disabled={statusUpdating || state.data.lead.status === "converted"}
                    >
                      <SelectTrigger id="lead-status">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {STATUS_OPTIONS.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value} disabled={opt.value === "converted"}>
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {state.data.lead.status === "converted" && (
                      <p className="text-[12px] text-subtle-foreground">Converted leads keep their status. See the linked account for what happens next.</p>
                    )}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Contact</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-3 text-[13px]">
                  <div className="flex items-start gap-2.5">
                    <Mail size={14} className="text-muted-foreground mt-0.5 shrink-0" />
                    <a href={`mailto:${state.data.lead.email}`} className="text-accent hover:underline break-all">
                      {state.data.lead.email}
                    </a>
                  </div>
                  {state.data.lead.website && (
                    <div className="flex items-start gap-2.5">
                      <Globe size={14} className="text-muted-foreground mt-0.5 shrink-0" />
                      <span className="text-foreground break-all">{state.data.lead.website}</span>
                    </div>
                  )}
                  {state.data.lead.company && (
                    <div className="flex items-start gap-2.5">
                      <Building2 size={14} className="text-muted-foreground mt-0.5 shrink-0" />
                      <span className="text-foreground">{state.data.lead.company}</span>
                    </div>
                  )}
                  {state.data.lead.category && (
                    <div className="flex items-start gap-2.5">
                      <Tag size={14} className="text-muted-foreground mt-0.5 shrink-0" />
                      <span className="text-foreground">{state.data.lead.category}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-2 pt-1">
                    <LeadSourceBadge source={state.data.lead.source} size="sm" />
                    {state.data.lead.score !== null && (
                      <span className="text-[12px] text-muted-foreground">
                        Score <LeadScore score={state.data.lead.score} />
                      </span>
                    )}
                  </div>
                  {state.data.lead.notes && (
                    <p className="text-[12.5px] text-muted-foreground leading-relaxed border-t border-border pt-3 mt-1">
                      {state.data.lead.notes}
                    </p>
                  )}
                </CardContent>
              </Card>

              {state.data.deals.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle>Deals</CardTitle>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-3">
                    {state.data.deals.map((deal) => (
                      <Link
                        key={deal.id}
                        href={`/crm/deals/${deal.id}`}
                        className="flex items-center justify-between gap-2 rounded-md -mx-2 px-2 py-1.5 hover:bg-surface transition-colors"
                      >
                        <div className="min-w-0">
                          <p className="text-[13px] font-medium text-foreground truncate">{deal.title}</p>
                          <p className="font-mono text-[12px] text-muted-foreground">{formatCurrency(deal.valueCents, deal.currency)}</p>
                        </div>
                        <DealStageBadge stage={deal.stage} size="sm" />
                      </Link>
                    ))}
                  </CardContent>
                </Card>
              )}

              <Card>
                <CardContent className="flex flex-col gap-1.5 text-[12px] text-muted-foreground">
                  <div className="flex justify-between">
                    <span>Created</span>
                    <span>{formatDate(state.data.lead.createdAt)}</span>
                  </div>
                  {state.data.lead.convertedAt && (
                    <div className="flex justify-between">
                      <span>Converted</span>
                      <span>{formatDate(state.data.lead.convertedAt)}</span>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
