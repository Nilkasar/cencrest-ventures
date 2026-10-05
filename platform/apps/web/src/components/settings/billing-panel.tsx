"use client";

import { useState } from "react";
import { Check, Receipt } from "lucide-react";
import {
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
  useToast,
} from "@bebest/ui";
import { ErrorPanel } from "@/components/patterns/error-panel";
import { PageStack, Reveal } from "@/components/patterns/motion";
import { PropertyList, Section, type PropertyItem } from "@/components/patterns/section";
import { SectionSkeleton } from "@/components/patterns/states";
import { typography } from "@/components/patterns/typography";
import { useAsyncData } from "@/lib/use-async-data";
import { formatCurrency, formatDate, formatNumber } from "@/lib/format";
import { useSession } from "@/lib/session-context";
import {
  BillingForbiddenError,
  InvalidPlanTransitionError,
  cancelSubscription,
  changePlan,
  getSubscription,
  listInvoices,
  listPlans,
} from "@/data/billing/client";
import {
  PLAN_TIERS,
  TRACKED_USAGE_METRICS,
  UNTRACKED_USAGE_METRICS,
  USAGE_METRIC_LABELS,
  type Invoice,
  type Plan,
  type PlanTier,
  type SubscriptionSnapshot,
} from "@/data/billing/types";
import { ConfirmDialog } from "./confirm-dialog";
import { Notice } from "./form-controls";
import { UsageMeter } from "./usage-meter";

/**
 * Settings > Billing — the real Epic 16 routes (`@/data/billing/client.ts`):
 * current plan, usage against every metered limit, plan changes, cancel,
 * invoice history. `manage_billing` is owner-only server-side; this panel
 * mirrors that by hiding the mutating controls' effect for non-owners (the
 * backend 403 stays the real enforcement).
 *
 * Reading order answers "what am I on, how close am I to its limits, what
 * else could I be on, what have I paid".
 */

type SubscriptionStatus = SubscriptionSnapshot["subscription"]["status"];

/** README §6 tones: active is good, trialing is in motion, money owed waits
 *  on a human, cancelled is inert. */
const STATUS_LABEL: Record<SubscriptionStatus, string> = {
  active: "Active",
  trialing: "Trial",
  past_due: "Past due",
  unpaid: "Unpaid",
  canceled: "Cancelled",
  incomplete: "Incomplete",
};

const STATUS_VARIANT: Record<SubscriptionStatus, "success" | "warning" | "neutral" | "info"> = {
  active: "success",
  trialing: "info",
  past_due: "warning",
  unpaid: "warning",
  canceled: "neutral",
  incomplete: "warning",
};

const INVOICE_STATUS_LABEL: Record<Invoice["status"], string> = {
  paid: "Paid",
  open: "Open",
  void: "Void",
  uncollectible: "Uncollectible",
};

const INVOICE_STATUS_VARIANT: Record<Invoice["status"], "success" | "warning" | "danger" | "neutral"> = {
  paid: "success",
  open: "warning",
  void: "neutral",
  uncollectible: "danger",
};

function formatPlanLimit(value: number | null): string {
  return value === null ? "Unlimited" : formatNumber(value);
}

async function loadBillingData() {
  const [subscription, plans, invoices] = await Promise.all([getSubscription(), listPlans(), listInvoices()]);
  return { subscription, plans, invoices };
}

type PendingAction = { kind: "change"; plan: Plan; direction: "upgrade" | "downgrade" } | { kind: "cancel" };

export function BillingPanel() {
  const { org } = useSession();
  const { reload, ...state } = useAsyncData(loadBillingData, []);
  const [busy, setBusy] = useState<PlanTier | "cancel" | null>(null);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [actionError, setActionError] = useState<string | undefined>(undefined);
  const { toast } = useToast();

  const isOwner = (org?.role ?? "member") === "owner";

  async function handleChangePlan(currentSlug: PlanTier, target: Plan) {
    if (!isOwner || target.slug === currentSlug) return;
    setBusy(target.slug);
    setActionError(undefined);
    try {
      await changePlan(currentSlug, target.slug);
      toast({ title: `You're now on the ${target.name} plan`, variant: "success" });
      reload();
    } catch (err) {
      if (err instanceof BillingForbiddenError || err instanceof InvalidPlanTransitionError) {
        setActionError(err.message);
      } else {
        setActionError(err instanceof Error ? err.message : "Couldn't change plans — try again.");
      }
    } finally {
      setBusy(null);
    }
  }

  async function handleCancel() {
    if (!isOwner) return;
    setBusy("cancel");
    setActionError(undefined);
    try {
      await cancelSubscription();
      toast({ title: "Subscription cancelled", description: "You're on the Free plan. Nothing was deleted.", variant: "success" });
      reload();
    } catch (err) {
      setActionError(err instanceof BillingForbiddenError ? err.message : err instanceof Error ? err.message : "Couldn't cancel — try again.");
    } finally {
      setBusy(null);
    }
  }

  if (state.status === "loading") {
    return (
      <div aria-busy="true" className="flex flex-col gap-5">
        <span className="sr-only">Loading billing…</span>
        <SectionSkeleton lines={3} titleWidth="w-40" />
        <SectionSkeleton lines={4} titleWidth="w-24" />
        <SectionSkeleton lines={5} titleWidth="w-32" />
      </div>
    );
  }

  if (state.status === "error") {
    return <ErrorPanel title="Billing didn't load" message={state.error.message} onRetry={reload} />;
  }

  const { subscription, plans, invoices } = state.data;
  const { plan: currentPlan, subscription: meta, usage } = subscription;
  const currentSlug = currentPlan.slug;
  const canCancel = currentSlug !== "free" && meta.status !== "canceled";
  const limitOnly = UNTRACKED_USAGE_METRICS.filter((key) => usage[key].limit !== null);
  const sortedPlans = plans.slice().sort((a, b) => PLAN_TIERS.indexOf(a.slug) - PLAN_TIERS.indexOf(b.slug));

  const planFacts: (PropertyItem | null)[] = [
    { label: "Status", value: <Badge variant={STATUS_VARIANT[meta.status]} size="sm" dot>{STATUS_LABEL[meta.status]}</Badge> },
    meta.trialEndsAt ? { label: "Trial ends", value: formatDate(meta.trialEndsAt) } : null,
    meta.currentPeriodEnd ? { label: meta.status === "canceled" ? "Access until" : "Renews", value: formatDate(meta.currentPeriodEnd) } : null,
    meta.cancelledAt ? { label: "Cancelled", value: formatDate(meta.cancelledAt) } : null,
    { label: "Price", value: <span className="text-muted-foreground">Set with your account team</span> },
  ];

  return (
    <PageStack>
      {!isOwner && (
        <Reveal>
          <Notice tone="locked" title="View only">
            Only the organization owner can change plans or cancel.
          </Notice>
        </Reveal>
      )}

      {(meta.status === "past_due" || meta.status === "unpaid") && (
        <Reveal>
          <Notice tone="warning" title="Payment needs attention">
            Your subscription is {STATUS_LABEL[meta.status].toLowerCase()}. Contact your account team to keep your plan&apos;s limits.
          </Notice>
        </Reveal>
      )}

      {actionError && (
        <Reveal>
          <ErrorPanel compact title="That change didn't go through" message={actionError} onRetry={reload} />
        </Reveal>
      )}

      <Section
        title={`${currentPlan.name} plan`}
        description={currentPlan.description ?? "Your current plan."}
        actions={
          canCancel && isOwner ? (
            <Button variant="ghost" size="sm" onClick={() => setPending({ kind: "cancel" })} loading={busy === "cancel"} disabled={busy !== null}>
              Cancel subscription
            </Button>
          ) : undefined
        }
      >
        <PropertyList items={planFacts.filter((item): item is PropertyItem => item !== null)} />
      </Section>

      <Section title="Usage" description="How much of this plan's limits you've used.">
        <div className="grid grid-cols-1 gap-x-10 gap-y-5 sm:grid-cols-2">
          {TRACKED_USAGE_METRICS.map((key) => (
            <UsageMeter key={key} label={USAGE_METRIC_LABELS[key]} entry={usage[key]} />
          ))}
        </div>
        {limitOnly.length > 0 && (
          <div className="mt-5 border-t border-border pt-4">
            <p className={cn(typography.eyebrow, "mb-3")}>Other plan limits</p>
            <PropertyList
              items={limitOnly.map((key) => ({ label: USAGE_METRIC_LABELS[key], value: <span className={typography.numeric}>{formatPlanLimit(usage[key].limit)}</span> }))}
              className="sm:grid sm:grid-cols-2 sm:gap-x-10"
            />
          </div>
        )}
      </Section>

      <Section title="Plans" description="Changes apply immediately. Pricing is agreed with your account team.">
        <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {sortedPlans.map((plan) => {
            const isCurrent = plan.slug === currentSlug;
            const direction = PLAN_TIERS.indexOf(plan.slug) > PLAN_TIERS.indexOf(currentSlug) ? "upgrade" : "downgrade";
            return (
              <PlanOption
                key={plan.slug}
                plan={plan}
                isCurrent={isCurrent}
                direction={direction}
                canChange={isOwner}
                disabled={busy !== null}
                busy={busy === plan.slug}
                onSelect={() => setPending({ kind: "change", plan, direction })}
              />
            );
          })}
        </ul>
      </Section>

      <Section title="Invoices" description="Newest first." flush>
        {invoices.length === 0 ? (
          <EmptyState
            compact
            icon={<Receipt size={18} />}
            title="No invoices yet"
            description="Invoices appear here once your subscription starts billing."
            className="m-5"
          />
        ) : (
          <Table framed={false}>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoices.map((invoice) => (
                <TableRow key={invoice.id}>
                  <TableCell className={typography.numeric}>{invoice.id}</TableCell>
                  <TableCell className="text-muted-foreground">{formatDate(invoice.createdAt)}</TableCell>
                  <TableCell>
                    <Badge variant={INVOICE_STATUS_VARIANT[invoice.status]} size="sm" dot>
                      {INVOICE_STATUS_LABEL[invoice.status]}
                    </Badge>
                  </TableCell>
                  <TableCell className={cn("text-right", typography.numeric)}>{formatCurrency(invoice.amountCents, invoice.currency)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>

      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => !open && setPending(null)}
        tone={pending?.kind === "change" && pending.direction === "upgrade" ? "primary" : "danger"}
        title={
          pending?.kind === "cancel"
            ? "Cancel your subscription?"
            : pending
              ? `${pending.direction === "upgrade" ? "Upgrade" : "Downgrade"} to ${pending.plan.name}?`
              : ""
        }
        description={
          pending?.kind === "cancel"
            ? "You'll move to the Free plan immediately. Nothing is deleted — your brand, competitors and history stay exactly as they are."
            : pending?.direction === "downgrade"
              ? "The new plan's limits apply immediately. Nothing is deleted."
              : "The new plan's limits apply immediately."
        }
        confirmLabel={
          pending?.kind === "cancel" ? "Cancel subscription" : pending ? `${pending.direction === "upgrade" ? "Upgrade" : "Downgrade"} to ${pending.plan.name}` : "Confirm"
        }
        onConfirm={() => {
          if (pending?.kind === "cancel") return handleCancel();
          if (pending?.kind === "change") return handleChangePlan(currentSlug, pending.plan);
        }}
      />
    </PageStack>
  );
}

function PlanOption({
  plan,
  isCurrent,
  direction,
  canChange,
  disabled,
  busy,
  onSelect,
}: {
  plan: Plan;
  isCurrent: boolean;
  direction: "upgrade" | "downgrade";
  canChange: boolean;
  disabled: boolean;
  busy: boolean;
  onSelect: () => void;
}) {
  const features = [
    `${formatPlanLimit(plan.limits.competitors_tracked)} competitors tracked`,
    `${formatPlanLimit(plan.limits.ai_queries_per_month)} AI queries / month`,
    `${formatPlanLimit(plan.limits.team_members)} team members`,
    plan.limits.agents ? "AI agents" : null,
    plan.limits.white_label ? "White-label branding" : null,
  ].filter((f): f is string => f !== null);

  return (
    <li
      className={cn(
        "flex flex-col gap-4 rounded-xl border p-4",
        isCurrent ? "border-accent bg-accent-muted/40" : "border-border bg-surface-raised",
      )}
      aria-current={isCurrent ? "true" : undefined}
    >
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-[14px] font-semibold text-foreground">{plan.name}</h3>
          {isCurrent && (
            <Badge variant="accent" size="sm">
              Current plan
            </Badge>
          )}
        </div>
        {plan.description && <p className={typography.meta}>{plan.description}</p>}
      </div>
      <ul className="flex flex-1 flex-col gap-1.5">
        {features.map((feature) => (
          <li key={feature} className="flex items-start gap-2 text-[12.5px] text-muted-foreground">
            <Check size={13} className="mt-0.5 shrink-0 text-subtle-foreground" aria-hidden="true" />
            {feature}
          </li>
        ))}
      </ul>
      {!isCurrent && canChange && (
        <Button variant={direction === "upgrade" ? "primary" : "secondary"} size="sm" onClick={onSelect} loading={busy} disabled={disabled}>
          {direction === "upgrade" ? "Upgrade" : "Downgrade"} to {plan.name}
        </Button>
      )}
    </li>
  );
}
