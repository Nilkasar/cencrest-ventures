"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Building2, Globe, Mail, Tag, UserX } from "lucide-react";
import {
  Avatar,
  Badge,
  Button,
  EmptyState,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  cn,
  getInitials,
} from "@bebest/ui";
import { ErrorPanel } from "@/components/patterns/error-panel";
import { DetailHeader } from "@/components/patterns/page-header";
import { DetailLayout } from "@/components/patterns/layout";
import { PageStack } from "@/components/patterns/motion";
import { PropertyList, Section } from "@/components/patterns/section";
import { DetailSkeleton } from "@/components/patterns/states";
import { typography } from "@/components/patterns/typography";
import { ActivityTimeline } from "@/components/crm/activity-timeline";
import { LogActivityDialog } from "@/components/crm/log-activity-dialog";
import { ConvertLeadDialog } from "@/components/crm/convert-lead-dialog";
import { LeadStatusPipeline } from "@/components/crm/lead-status-pipeline";
import { DealStageBadge, LeadScore, LeadSourceBadge, LeadStatusBadge } from "@/components/crm/status-badges";
import { fetchActivitiesForLead, fetchDealsForLead, fetchLead, updateLeadStatus } from "@/data/crm/client";
import type { LeadStatus } from "@/data/crm/types";
import { useAsyncData } from "@/lib/use-async-data";
import { useCrmBasePath } from "@/components/crm/crm-base-path";
import { formatCurrency, formatDate } from "@/lib/format";

const STATUS_OPTIONS: { value: LeadStatus; label: string }[] = [
  { value: "new", label: "New" },
  { value: "contacted", label: "Contacted" },
  { value: "qualified", label: "Qualified" },
  { value: "converted", label: "Converted" },
  { value: "lost", label: "Lost" },
];

export function LeadDetailView({ leadId }: { leadId: string }) {
  const crm = useCrmBasePath();
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

  if (state.status === "loading") return <DetailSkeleton label="Loading lead…" />;

  if (state.status === "error") {
    return (
      <>
        <DetailHeader backHref={`${crm}/leads`} backLabel="Leads" title="Lead" />
        <ErrorPanel title="This lead didn't load" message={state.error.message} onRetry={reload} />
      </>
    );
  }

  const { lead } = state.data;
  if (lead === null) {
    return (
      <EmptyState
        icon={<UserX size={20} />}
        title="Lead not found"
        description="This lead may have been removed, or the link is out of date."
        action={
          <Button variant="secondary" size="sm" onClick={() => router.push(`${crm}/leads`)}>
            Back to leads
          </Button>
        }
      />
    );
  }
  const { activities, deals } = state.data;

  return (
    <>
      <DetailHeader
        backHref={`${crm}/leads`}
        backLabel="Leads"
        leading={<Avatar fallback={getInitials(lead.name)} size="lg" />}
        title={lead.name}
        badges={<LeadStatusBadge status={lead.status} size="sm" />}
        subtitle={`${lead.company ?? "No company on file"} · ${lead.email}`}
        meta={[
          { label: "Source", value: <LeadSourceBadge source={lead.source} size="sm" /> },
          { label: "Score", value: <LeadScore score={lead.score} /> },
          {
            label: "Owner",
            value: lead.assignedTo ? (
              lead.assignedTo.name
            ) : (
              <Badge variant="outline" size="sm">
                Unassigned
              </Badge>
            ),
          },
          { label: "Created", value: formatDate(lead.createdAt) },
          ...(lead.convertedAt ? [{ label: "Converted", value: formatDate(lead.convertedAt) }] : []),
        ]}
        actions={
          <>
            <LogActivityDialog leadId={leadId} onLogged={reload} />
            {lead.status === "converted" && lead.organizationId ? (
              <Button variant="secondary" size="sm" asChild>
                <Link href={`${crm}/accounts/${lead.organizationId}`}>View account</Link>
              </Button>
            ) : (
              <ConvertLeadDialog lead={lead} onConverted={(accountId) => router.push(`${crm}/accounts/${accountId}`)} />
            )}
          </>
        }
      />

      <PageStack>
        <DetailLayout
          aside={
            <>
              <Section title="Pipeline">
                <div className="flex flex-col gap-4">
                  <LeadStatusPipeline status={lead.status} />
                  <div className="flex flex-col gap-1.5 border-t border-border pt-4">
                    <Label htmlFor="lead-status">Update status</Label>
                    <Select
                      value={lead.status}
                      onValueChange={(v) => handleStatusChange(v as LeadStatus)}
                      disabled={statusUpdating || lead.status === "converted"}
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
                    {lead.status === "converted" && (
                      <p className="text-[12px] text-subtle-foreground">
                        Converted leads keep their status. See the linked account for what happens next.
                      </p>
                    )}
                  </div>
                </div>
              </Section>

              <Section title="Contact">
                <PropertyList
                  items={[
                    {
                      label: "Email",
                      icon: <Mail size={13} />,
                      value: (
                        <a href={`mailto:${lead.email}`} className="break-all text-accent hover:underline">
                          {lead.email}
                        </a>
                      ),
                    },
                    { label: "Company", icon: <Building2 size={13} />, value: lead.company },
                    { label: "Website", icon: <Globe size={13} />, value: lead.website ? <span className="break-all">{lead.website}</span> : null },
                    { label: "Category", icon: <Tag size={13} />, value: lead.category },
                  ]}
                />
                {lead.notes && (
                  <p className={cn(typography.secondary, "mt-4 border-t border-border pt-4")}>{lead.notes}</p>
                )}
              </Section>

              {deals.length > 0 && (
                <Section title="Deals" description={`${deals.length} linked to this lead`} flush>
                  <ul className="divide-y divide-border">
                    {deals.map((deal) => (
                      <li key={deal.id}>
                        <Link
                          href={`${crm}/deals/${deal.id}`}
                          className="flex items-center justify-between gap-3 px-5 py-3 transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-[13px] font-medium text-foreground">{deal.title}</p>
                            <p className={cn(typography.numeric, "text-muted-foreground")}>{formatCurrency(deal.valueCents, deal.currency)}</p>
                          </div>
                          <DealStageBadge stage={deal.stage} size="sm" />
                        </Link>
                      </li>
                    ))}
                  </ul>
                </Section>
              )}
            </>
          }
        >
          <Section title="Activity" description="Calls, emails, notes and system events, newest first.">
            <ActivityTimeline activities={activities} emptyHint="Nothing logged yet — log a call, email, or note to start the history." />
          </Section>
        </DetailLayout>
      </PageStack>
    </>
  );
}
