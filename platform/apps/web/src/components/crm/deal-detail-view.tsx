"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Building2, Calendar, ChevronRight, Clock, Handshake, Percent, Trophy, User } from "lucide-react";
import { Avatar, Button, EmptyState, cn, getInitials, useToast } from "@bebest/ui";
import { ErrorPanel } from "@/components/patterns/error-panel";
import { DetailHeader } from "@/components/patterns/page-header";
import { DetailLayout } from "@/components/patterns/layout";
import { PageStack } from "@/components/patterns/motion";
import { PropertyList, Section } from "@/components/patterns/section";
import { DetailSkeleton } from "@/components/patterns/states";
import { typography } from "@/components/patterns/typography";
import { ActivityTimeline } from "@/components/crm/activity-timeline";
import { LogActivityDialog } from "@/components/crm/log-activity-dialog";
import { LostReasonDialog } from "@/components/crm/lost-reason-dialog";
import { DealStagePipeline } from "@/components/crm/deal-stage-pipeline";
import { DealCloseDate, isOpenStage } from "@/components/crm/deal-utils";
import { DealStageBadge, LeadStatusBadge } from "@/components/crm/status-badges";
import { fetchAccount, fetchActivitiesForDeal, fetchDeal, fetchLead, updateDealStage } from "@/data/crm/client";
import { DEAL_STAGE_LABEL, type DealStage } from "@/data/crm/types";
import { useAsyncData } from "@/lib/use-async-data";
import { useCrmBasePath } from "@/components/crm/crm-base-path";
import { formatCurrency, formatDate, formatRelativeTime } from "@/lib/format";

const relatedLinkClass =
  "flex items-center gap-3 px-5 py-3 transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";

export function DealDetailView({ dealId }: { dealId: string }) {
  const crm = useCrmBasePath();
  const router = useRouter();
  const { toast } = useToast();
  const [stageUpdating, setStageUpdating] = useState(false);
  /** The stage just chosen, shown while the server confirms it. */
  const [pending, setPending] = useState<{ dealId: string; stage: DealStage } | null>(null);
  const pendingStage = pending?.dealId === dealId ? pending.stage : null;
  const [lostPromptOpen, setLostPromptOpen] = useState(false);

  const { reload, ...state } = useAsyncData(async () => {
    const deal = await fetchDeal(dealId);
    if (!deal) return { deal: null };
    const [lead, account, dealActivities] = await Promise.all([
      deal.leadId ? fetchLead(deal.leadId) : Promise.resolve(null),
      deal.organizationId ? fetchAccount(deal.organizationId) : Promise.resolve(null),
      fetchActivitiesForDeal(deal),
    ]);
    return { deal, lead, account, activities: dealActivities };
  }, [dealId]);

  async function applyStageChange(stage: DealStage, lostReason?: string) {
    setStageUpdating(true);
    setPending({ dealId, stage });
    try {
      await updateDealStage(dealId, stage, lostReason);
      toast({ title: `Moved to ${DEAL_STAGE_LABEL[stage]}`, variant: "success" });
      // `pendingStage` stays set: it now equals what the reload will return,
      // so the badge and stepper don't flick back while it's in flight.
      reload();
    } catch (err) {
      setPending(null);
      toast({
        title: "Couldn't change the stage",
        description: err instanceof Error ? err.message : "The stage change didn't save. Try again in a moment.",
        variant: "danger",
      });
    } finally {
      setStageUpdating(false);
    }
  }

  function handleStageChange(next: DealStage) {
    if (next === "lost") {
      setLostPromptOpen(true);
      return;
    }
    void applyStageChange(next);
  }

  if (state.status === "loading") return <DetailSkeleton label="Loading deal…" />;

  if (state.status === "error") {
    return (
      <>
        <DetailHeader backHref={`${crm}/deals`} backLabel="Deals" title="Deal" />
        <ErrorPanel title="This deal didn't load" message={state.error.message} onRetry={reload} />
      </>
    );
  }

  const { deal } = state.data;
  if (deal === null) {
    return (
      <EmptyState
        icon={<Handshake size={20} />}
        title="Deal not found"
        description="This deal may have been removed, or the link is out of date."
        action={
          <Button variant="secondary" size="sm" onClick={() => router.push(`${crm}/deals`)}>
            Back to deals
          </Button>
        }
      />
    );
  }
  const { lead, account, activities } = state.data;
  const stage = pendingStage ?? deal.stage;
  const open = isOpenStage(stage);
  const weighted = (deal.valueCents * deal.probability) / 100;
  const linkedLabel = account?.name ?? deal.linkedTo?.name ?? null;

  return (
    <>
      <DetailHeader
        backHref={`${crm}/deals`}
        backLabel="Deals"
        leading={
          <span className="flex size-12 items-center justify-center rounded-xl border border-border bg-surface text-muted-foreground" aria-hidden="true">
            <Handshake size={20} />
          </span>
        }
        title={deal.title}
        badges={<DealStageBadge stage={stage} size="sm" />}
        subtitle={linkedLabel ? `${linkedLabel} · Owned by ${deal.owner.name}` : `Not linked to an account or lead · Owned by ${deal.owner.name}`}
        meta={[
          {
            label: "Value",
            value: <span className={cn(typography.numeric, "text-[13px] font-semibold")}>{formatCurrency(deal.valueCents, deal.currency)}</span>,
          },
          ...(open
            ? [
                { label: "Probability", value: <span className={typography.numeric}>{deal.probability}%</span> },
                { label: "Weighted", value: <span className={typography.numeric}>{formatCurrency(weighted, deal.currency)}</span> },
              ]
            : []),
          { label: "Expected close", value: <DealCloseDate deal={{ stage, expectedCloseDate: deal.expectedCloseDate }} emptyLabel="Not set" /> },
          {
            label: "Owner",
            value: (
              <span className="flex items-center gap-1.5">
                <Avatar fallback={getInitials(deal.owner.name)} size="sm" className="size-5 text-[9px]" />
                {deal.owner.name}
              </span>
            ),
          },
        ]}
        actions={
          <>
            <LogActivityDialog
              leadId={deal.leadId ?? undefined}
              organizationId={deal.organizationId ?? undefined}
              dealId={deal.id}
              onLogged={reload}
            />
            {open && (
              <>
                <Button variant="secondary" size="sm" onClick={() => handleStageChange("lost")} disabled={stageUpdating}>
                  Mark lost
                </Button>
                <Button variant="primary" size="sm" onClick={() => handleStageChange("won")} loading={stageUpdating && pendingStage === "won"} disabled={stageUpdating}>
                  <Trophy size={14} aria-hidden="true" /> Mark won
                </Button>
              </>
            )}
          </>
        }
      />

      <PageStack>
        <DetailLayout
          aside={
            <>
              <Section title="Stage" description="Every stage change is recorded in the audit log.">
                <DealStagePipeline stage={stage} onMove={handleStageChange} disabled={stageUpdating} />
                {stage === "lost" && deal.lostReason && (
                  <div className="mt-3 rounded-lg border border-border bg-surface px-3 py-2.5">
                    <p className={typography.eyebrow}>Lost reason</p>
                    <p className="mt-1 text-[13px] text-foreground">{deal.lostReason}</p>
                  </div>
                )}
              </Section>

              <Section title="Details">
                <PropertyList
                  items={[
                    { label: "Owner", icon: <User size={13} />, value: deal.owner.name },
                    {
                      label: "Expected close",
                      icon: <Calendar size={13} />,
                      value: deal.expectedCloseDate ? <DealCloseDate deal={{ stage, expectedCloseDate: deal.expectedCloseDate }} /> : null,
                    },
                    { label: "Probability", icon: <Percent size={13} />, value: `${deal.probability}%` },
                    { label: "Created", icon: <Clock size={13} />, value: formatDate(deal.createdAt) },
                    {
                      label: "Last updated",
                      icon: <Clock size={13} />,
                      value: <span title={formatDate(deal.updatedAt)}>{formatRelativeTime(deal.updatedAt)}</span>,
                    },
                  ]}
                />
              </Section>

              <Section title="Linked records" flush>
                {account || lead ? (
                  <ul className="divide-y divide-border">
                    {account && (
                      <li>
                        <Link href={`${crm}/accounts/${account.id}`} className={relatedLinkClass}>
                          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-surface text-muted-foreground" aria-hidden="true">
                            <Building2 size={14} />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13px] font-medium text-foreground">{account.name}</span>
                            <span className={typography.meta}>Account</span>
                          </span>
                          <ChevronRight size={14} className="shrink-0 text-subtle-foreground" aria-hidden="true" />
                        </Link>
                      </li>
                    )}
                    {lead && (
                      <li>
                        <Link href={`${crm}/leads/${lead.id}`} className={relatedLinkClass}>
                          <Avatar fallback={getInitials(lead.name)} size="sm" className="size-8" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13px] font-medium text-foreground">{lead.name}</span>
                            <span className={typography.meta}>Lead{lead.company ? ` · ${lead.company}` : ""}</span>
                          </span>
                          <LeadStatusBadge status={lead.status} size="sm" />
                        </Link>
                      </li>
                    )}
                  </ul>
                ) : (
                  <p className={cn(typography.secondary, "px-5 py-4")}>
                    This deal isn&apos;t linked to an account or lead, so its activity only appears here.
                  </p>
                )}
              </Section>
            </>
          }
        >
          <Section title="Activity" description="Notes, calls and emails logged against this deal, newest first.">
            <ActivityTimeline
              activities={activities}
              emptyHint="Nothing logged against this deal yet — log a note to track what it'll take to close it."
            />
          </Section>
        </DetailLayout>
      </PageStack>

      <LostReasonDialog
        open={lostPromptOpen}
        dealTitle={deal.title}
        onCancel={() => setLostPromptOpen(false)}
        onConfirm={async (reason) => {
          setLostPromptOpen(false);
          await applyStageChange("lost", reason);
        }}
      />
    </>
  );
}
