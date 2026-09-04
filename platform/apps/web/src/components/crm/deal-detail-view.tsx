"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowLeft, Building2, Calendar, Handshake, User } from "lucide-react";
import {
  Avatar,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  Input,
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
import { DealStageBadge, LeadStatusBadge } from "@/components/crm/status-badges";
import { fetchAccount, fetchActivitiesForDeal, fetchDeal, fetchLead, updateDealStage } from "@/data/crm/client";
import { DEAL_STAGE_LABEL, DEAL_STAGE_SEQUENCE, type DealStage } from "@/data/crm/types";
import { useAsyncData } from "@/lib/use-async-data";
import { formatCurrency, formatDate } from "@/lib/format";

function DealDetailSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <Skeleton className="h-6 w-64" />
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

export function DealDetailView({ dealId }: { dealId: string }) {
  const router = useRouter();
  const [stageUpdating, setStageUpdating] = useState(false);
  const [pendingLostReason, setPendingLostReason] = useState("");
  const [showLostReasonPrompt, setShowLostReasonPrompt] = useState(false);

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
    try {
      await updateDealStage(dealId, stage, lostReason);
      reload();
    } finally {
      setStageUpdating(false);
    }
  }

  function handleStageChange(next: DealStage) {
    if (next === "lost") {
      setShowLostReasonPrompt(true);
      return;
    }
    setShowLostReasonPrompt(false);
    applyStageChange(next);
  }

  return (
    <div className="flex flex-col gap-5">
      <Link href="/crm/deals" className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground w-fit">
        <ArrowLeft size={14} /> Deals
      </Link>

      {state.status === "loading" && <DealDetailSkeleton />}

      {state.status === "error" && <ErrorPanel message={state.error.message} onRetry={reload} />}

      {state.status === "success" && state.data.deal === null && (
        <EmptyState
          icon={<Handshake size={20} />}
          title="Deal not found"
          description="This deal may have been removed, or the link is out of date."
          action={
            <Button variant="secondary" size="sm" onClick={() => router.push("/crm/deals")}>
              Back to deals
            </Button>
          }
        />
      )}

      {state.status === "success" && state.data.deal && (
        <>
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="font-display text-[22px] font-semibold text-foreground tracking-[-0.01em]">{state.data.deal.title}</h1>
                <DealStageBadge stage={state.data.deal.stage} size="sm" />
              </div>
              <p className="font-mono text-[15px] font-semibold text-foreground mt-1">
                {formatCurrency(state.data.deal.valueCents, state.data.deal.currency)}
                <span className="font-sans font-normal text-[13px] text-muted-foreground"> · {state.data.deal.probability}% probability</span>
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <LogActivityDialog
                leadId={state.data.deal.leadId ?? undefined}
                organizationId={state.data.deal.organizationId ?? undefined}
                dealId={state.data.deal.id}
                onLogged={reload}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 flex flex-col gap-5">
              <Card>
                <CardHeader>
                  <CardTitle>Notes on this deal</CardTitle>
                </CardHeader>
                <CardContent>
                  <ActivityTimeline
                    activities={state.data.activities}
                    emptyHint="Nothing logged against this deal specifically yet — log a note to track what it'll take to close it."
                  />
                </CardContent>
              </Card>
            </div>

            <div className="flex flex-col gap-5">
              <Card>
                <CardHeader>
                  <CardTitle>Stage</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  <Select value={state.data.deal.stage} onValueChange={(v) => handleStageChange(v as DealStage)} disabled={stageUpdating}>
                    <SelectTrigger aria-label="Update stage">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DEAL_STAGE_SEQUENCE.map((s) => (
                        <SelectItem key={s} value={s}>
                          {DEAL_STAGE_LABEL[s]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-[11.5px] text-subtle-foreground">Stage changes on deals are recorded in the audit log.</p>

                  {showLostReasonPrompt && (
                    <div className="flex flex-col gap-2 rounded-lg border border-danger/30 bg-danger-muted p-3">
                      <Label htmlFor="lost-reason" className="text-danger">Why was this lost?</Label>
                      <Input
                        id="lost-reason"
                        placeholder="e.g. Went with an incumbent agency"
                        value={pendingLostReason}
                        onChange={(e) => setPendingLostReason(e.target.value)}
                        autoFocus
                        required
                      />
                      <div className="flex justify-end gap-2">
                        <Button variant="ghost" size="sm" onClick={() => setShowLostReasonPrompt(false)}>
                          Cancel
                        </Button>
                        <Button
                          variant="danger"
                          size="sm"
                          disabled={!pendingLostReason.trim()}
                          onClick={() => {
                            applyStageChange("lost", pendingLostReason.trim() || undefined);
                            setShowLostReasonPrompt(false);
                            setPendingLostReason("");
                          }}
                        >
                          Mark lost
                        </Button>
                      </div>
                    </div>
                  )}

                  {state.data.deal.stage === "lost" && state.data.deal.lostReason && (
                    <p className="text-[12.5px] text-muted-foreground border-t border-border pt-3">
                      <span className="font-medium text-foreground">Lost reason: </span>
                      {state.data.deal.lostReason}
                    </p>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Details</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-3 text-[13px]">
                  <div className="flex items-center gap-2.5">
                    <User size={14} className="text-muted-foreground shrink-0" />
                    <span className="text-foreground">{state.data.deal.owner.name}</span>
                    <Avatar fallback={getInitials(state.data.deal.owner.name)} size="sm" className="ml-auto" />
                  </div>
                  {state.data.deal.expectedCloseDate && (
                    <div className="flex items-center gap-2.5">
                      <Calendar size={14} className="text-muted-foreground shrink-0" />
                      <span className="text-foreground">{formatDate(state.data.deal.expectedCloseDate)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-[12px] text-muted-foreground border-t border-border pt-3 mt-1">
                    <span>Created</span>
                    <span>{formatDate(state.data.deal.createdAt)}</span>
                  </div>
                </CardContent>
              </Card>

              {(state.data.lead || state.data.account) && (
                <Card>
                  <CardHeader>
                    <CardTitle>Linked to</CardTitle>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-3">
                    {state.data.account && (
                      <Link href={`/crm/accounts/${state.data.account.id}`} className="flex items-center gap-2.5 rounded-md -mx-2 px-2 py-1.5 hover:bg-surface transition-colors">
                        <Building2 size={14} className="text-muted-foreground shrink-0" />
                        <span className="text-[13px] font-medium text-foreground truncate">{state.data.account.name}</span>
                      </Link>
                    )}
                    {state.data.lead && (
                      <Link href={`/crm/leads/${state.data.lead.id}`} className="flex items-center gap-2.5 rounded-md -mx-2 px-2 py-1.5 hover:bg-surface transition-colors">
                        <User size={14} className="text-muted-foreground shrink-0" />
                        <span className="text-[13px] font-medium text-foreground truncate">{state.data.lead.name}</span>
                        <LeadStatusBadge status={state.data.lead.status} size="sm" />
                      </Link>
                    )}
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
