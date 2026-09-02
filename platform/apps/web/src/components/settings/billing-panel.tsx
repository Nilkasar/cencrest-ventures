"use client";

import { useState } from "react";
import { CreditCard, Receipt } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@bebest/ui";
import { ErrorPanel } from "@/components/patterns/error-panel";
import { useAsyncData } from "@/lib/use-async-data";
import { formatCurrency, formatDate } from "@/lib/format";
import { currentUser } from "@/data/fixtures";
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
import { UsageMeter } from "./usage-meter";

/**
 * Settings > Billing. Wires directly into the real Epic 16 routes
 * (`@/data/billing/client.ts`) — current plan, usage bars for every
 * metered limit (the "at your limit" register `competitors-view.tsx`
 * established, per epic spec), upgrade/downgrade/cancel, and invoice
 * history. `manage_billing` is owner-only server-side
 * (`docs/08-security/SECURITY.md`); this panel mirrors that in the UI by
 * disabling mutating actions for a non-owner (the Team tab already reads
 * `currentUser.role` the same fixture-backed way, per Epic 0's
 * not-yet-wired-session note in `data/fixtures.ts`) — the backend 403 is
 * still the real enforcement if this check is ever bypassed.
 */

const STATUS_LABEL: Record<SubscriptionSnapshot["subscription"]["status"], string> = {
  active: "Active",
  trialing: "Trialing",
  past_due: "Past due",
  unpaid: "Unpaid",
  canceled: "Canceled",
  incomplete: "Incomplete",
};

const STATUS_VARIANT: Record<SubscriptionSnapshot["subscription"]["status"], "success" | "warning" | "neutral" | "accent"> = {
  active: "success",
  trialing: "accent",
  past_due: "warning",
  unpaid: "warning",
  canceled: "neutral",
  incomplete: "warning",
};

const INVOICE_STATUS_VARIANT: Record<Invoice["status"], "success" | "warning" | "danger" | "neutral"> = {
  paid: "success",
  open: "warning",
  void: "neutral",
  uncollectible: "danger",
};

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatPlanLimit(value: number | null): string {
  return value === null ? "Unlimited" : value.toLocaleString();
}

async function loadBillingData() {
  const [subscription, plans, invoices] = await Promise.all([getSubscription(), listPlans(), listInvoices()]);
  return { subscription, plans, invoices };
}

export function BillingPanel() {
  const { reload, ...state } = useAsyncData(loadBillingData, []);
  const [busy, setBusy] = useState<PlanTier | "cancel" | null>(null);
  const [actionError, setActionError] = useState<string | undefined>(undefined);

  const isOwner = currentUser.role === "owner";

  async function handleChangePlan(currentSlug: PlanTier, targetSlug: PlanTier) {
    if (!isOwner || targetSlug === currentSlug) return;
    setBusy(targetSlug);
    setActionError(undefined);
    try {
      await changePlan(currentSlug, targetSlug);
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
    const confirmed = window.confirm(
      "Cancel your subscription? You'll move to the Free plan immediately. Nothing is deleted — your brand, competitors, and history stay exactly as they are.",
    );
    if (!confirmed) return;
    setBusy("cancel");
    setActionError(undefined);
    try {
      await cancelSubscription();
      reload();
    } catch (err) {
      setActionError(err instanceof BillingForbiddenError ? err.message : err instanceof Error ? err.message : "Couldn't cancel — try again.");
    } finally {
      setBusy(null);
    }
  }

  if (state.status === "loading") {
    return (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-28 w-full rounded-xl" />
        <Skeleton className="h-40 w-full rounded-xl" />
        <Skeleton className="h-56 w-full rounded-xl" />
      </div>
    );
  }

  if (state.status === "error") {
    return <ErrorPanel message={state.error.message} onRetry={reload} />;
  }

  const { subscription, plans, invoices } = state.data;
  const currentSlug = subscription.plan.slug;

  return (
    <div className="flex flex-col gap-6">
      {!isOwner && (
        <p className="text-[12.5px] text-subtle-foreground">
          You&apos;re viewing billing as {currentUser.role}. Only the organization owner can change plans or cancel.
        </p>
      )}

      <Card>
        <CardHeader className="flex-row items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <CardTitle>{subscription.plan.name} plan</CardTitle>
              <Badge variant={STATUS_VARIANT[subscription.subscription.status]} size="sm">
                {STATUS_LABEL[subscription.subscription.status]}
              </Badge>
            </div>
            {subscription.plan.description && <p className="text-[13px] text-muted-foreground">{subscription.plan.description}</p>}
            {subscription.subscription.currentPeriodEnd && (
              <p className="text-[12px] text-subtle-foreground">
                Current period ends {formatDate(subscription.subscription.currentPeriodEnd)}
              </p>
            )}
            {subscription.subscription.cancelledAt && (
              <p className="text-[12px] text-subtle-foreground">Cancelled on {formatDate(subscription.subscription.cancelledAt)}</p>
            )}
          </div>
          {currentSlug !== "free" && subscription.subscription.status !== "canceled" && (
            <Button variant="outline" size="sm" onClick={handleCancel} loading={busy === "cancel"} disabled={!isOwner || busy !== null}>
              Cancel subscription
            </Button>
          )}
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
          {TRACKED_USAGE_METRICS.map((key) => (
            <UsageMeter key={key} label={USAGE_METRIC_LABELS[key]} entry={subscription.usage[key]} />
          ))}
        </CardContent>
        {UNTRACKED_USAGE_METRICS.some((key) => subscription.usage[key].limit !== null) && (
          <CardContent className="pt-0 border-t border-border grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
            {UNTRACKED_USAGE_METRICS.map((key) => (
              <UsageMeter key={key} label={USAGE_METRIC_LABELS[key]} entry={subscription.usage[key]} />
            ))}
          </CardContent>
        )}
      </Card>

      {actionError && <ErrorPanel compact message={actionError} onRetry={reload} />}

      <section className="flex flex-col gap-3">
        <h3 className="font-mono text-[11px] uppercase tracking-[0.08em] text-subtle-foreground">Plans</h3>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {plans
            .slice()
            .sort((a, b) => PLAN_TIERS.indexOf(a.slug) - PLAN_TIERS.indexOf(b.slug))
            .map((plan) => (
              <PlanCard
                key={plan.slug}
                plan={plan}
                isCurrent={plan.slug === currentSlug}
                direction={PLAN_TIERS.indexOf(plan.slug) > PLAN_TIERS.indexOf(currentSlug) ? "upgrade" : "downgrade"}
                disabled={!isOwner || busy !== null}
                busy={busy === plan.slug}
                onSelect={() => handleChangePlan(currentSlug, plan.slug)}
              />
            ))}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h3 className="font-mono text-[11px] uppercase tracking-[0.08em] text-subtle-foreground">Invoice history</h3>
        {invoices.length === 0 ? (
          <EmptyState
            compact
            icon={<Receipt size={18} />}
            title="No invoices yet"
            description="Invoices appear here once your subscription starts billing."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoices.map((invoice) => (
                <TableRow key={invoice.id}>
                  <TableCell className="font-mono text-[12.5px]">{invoice.id}</TableCell>
                  <TableCell className="text-muted-foreground">{formatDate(invoice.createdAt)}</TableCell>
                  <TableCell className="font-mono">{formatCurrency(invoice.amountCents, invoice.currency)}</TableCell>
                  <TableCell>
                    <Badge variant={INVOICE_STATUS_VARIANT[invoice.status]} size="sm">
                      {capitalize(invoice.status)}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>
    </div>
  );
}

function PlanCard({
  plan,
  isCurrent,
  direction,
  disabled,
  busy,
  onSelect,
}: {
  plan: Plan;
  isCurrent: boolean;
  direction: "upgrade" | "downgrade";
  disabled: boolean;
  busy: boolean;
  onSelect: () => void;
}) {
  return (
    <Card className={isCurrent ? "border-accent" : undefined}>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-[15px]">{plan.name}</CardTitle>
          {isCurrent && (
            <Badge variant="accent" size="sm">
              Current
            </Badge>
          )}
        </div>
        {plan.description && <p className="text-[12.5px] text-muted-foreground">{plan.description}</p>}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <ul className="flex flex-col gap-1 text-[12.5px] text-muted-foreground">
          <li>{formatPlanLimit(plan.limits.competitors_tracked)} competitors tracked</li>
          <li>{formatPlanLimit(plan.limits.ai_queries_per_month)} AI queries / month</li>
          <li>{formatPlanLimit(plan.limits.team_members)} team members</li>
          {plan.limits.white_label && <li>White-label included</li>}
        </ul>
        <p className="text-[11.5px] text-subtle-foreground flex items-center gap-1.5">
          <CreditCard size={12} /> Pricing under negotiation — contact your account team
        </p>
        {!isCurrent && (
          <Button variant={direction === "upgrade" ? "primary" : "outline"} size="sm" onClick={onSelect} loading={busy} disabled={disabled}>
            {direction === "upgrade" ? "Upgrade" : "Downgrade"} to {plan.name}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
