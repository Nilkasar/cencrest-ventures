"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AlertCircle, ArrowRight, CheckCircle2, Globe, ListChecks, Loader2, MinusCircle, type LucideIcon } from "lucide-react";
import { Button, EmptyState, cn } from "@bebest/ui";
import { useOnboarding } from "@/components/onboarding/onboarding-context";
import { WIZARD_STEPS } from "@/components/onboarding/steps";
import {
  completeOnboarding,
  OnboardingIncompleteError,
  type CrawlKickoff,
  type OnboardingCompletion,
  type QuerySetKickoff,
} from "@/lib/onboarding-client";
import { formatDate } from "@/lib/format";
import type { OnboardingStepKey } from "@/data/types";

type State =
  | { kind: "finishing" }
  | { kind: "done"; result: OnboardingCompletion }
  | { kind: "incomplete"; missing: OnboardingStepKey[] }
  | { kind: "error"; message: string };

interface KickoffCopy {
  started: boolean;
  title: string;
  detail: string;
  href: string;
  linkLabel: string;
}

function crawlCopy(crawl: CrawlKickoff, website: string): KickoffCopy {
  const link = { href: "/website-intelligence", linkLabel: "Open Website Intelligence" };
  if (crawl.status === "started") {
    return {
      started: true,
      title: "First website crawl started",
      detail: `We're crawling ${website || "your site"} now. It usually takes 10–15 minutes and runs in the background.`,
      ...link,
    };
  }
  switch (crawl.reason) {
    case "no_website_url":
      return {
        started: false,
        title: "Website crawl skipped",
        detail: "Your brand profile has no website yet. Add one and start a crawl from Website Intelligence.",
        href: "/settings?tab=brand",
        linkLabel: "Add your website",
      };
    case "crawl_already_in_progress":
      return { started: true, title: "Website crawl already running", detail: "A crawl of your site was already in progress, so we didn't start another.", ...link };
    case "already_crawled":
      return { started: true, title: "Website already crawled", detail: "Your site was crawled before setup finished, so we didn't crawl it again.", ...link };
    default:
      return { started: true, title: "Website crawl", detail: "The first crawl was started when setup was first completed.", ...link };
  }
}

function querySetCopy(querySet: QuerySetKickoff): KickoffCopy {
  const link = { href: "/query-universe", linkLabel: "Open Query Universe" };
  if (querySet.status === "created") {
    return {
      started: true,
      title: "First query set created",
      detail: "The questions buyers ask AI assistants about your category — the set every AI Visibility run measures against.",
      ...link,
    };
  }
  if (querySet.reason === "active_query_set_exists") {
    return { started: true, title: "Query set already active", detail: "You already had an active query set, so we kept it.", ...link };
  }
  return { started: true, title: "Query set", detail: "Your first query set was created when setup was first completed.", ...link };
}

function KickoffRow({ icon: Icon, copy }: { icon: LucideIcon; copy: KickoffCopy }) {
  return (
    <li className="flex items-start gap-3.5 p-4">
      <span
        className={cn(
          "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border",
          copy.started ? "border-success/30 bg-success-muted text-success" : "border-border bg-surface text-muted-foreground",
        )}
        aria-hidden="true"
      >
        <Icon size={15} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="flex items-center gap-1.5 text-[13.5px] font-medium text-foreground">
          {copy.started ? (
            <CheckCircle2 size={13} className="shrink-0 text-success" aria-hidden="true" />
          ) : (
            <MinusCircle size={13} className="shrink-0 text-muted-foreground" aria-hidden="true" />
          )}
          {copy.title}
        </p>
        <p className="text-[12.5px] leading-relaxed text-muted-foreground">{copy.detail}</p>
        <Link
          href={copy.href}
          className="mt-1 inline-flex min-h-[32px] w-fit items-center gap-1 rounded-md text-[12.5px] font-medium text-accent underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {copy.linkLabel} <ArrowRight size={12} aria-hidden="true" />
        </Link>
      </div>
    </li>
  );
}

/**
 * The wizard's last step. Completion is recorded ON THE SERVER
 * (`POST /brands/me/onboarding/complete`), which also starts the first
 * crawl and the first active query set — this screen reports exactly what
 * it started, or why it skipped each. The call is idempotent, so landing
 * here again (reload, second device) shows the same outcome with
 * "already completed" copy instead of starting anything twice.
 */
export default function DoneStep() {
  const { profile, setProfile } = useOnboarding();
  const [state, setState] = useState<State>({ kind: "finishing" });
  const attempted = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const finish = useCallback(() => {
    completeOnboarding()
      .then((result) => {
        setState({ kind: "done", result });
        if (profile && profile.status !== "completed") {
          setProfile({ ...profile, status: "completed", completedAt: result.completedAt });
        }
      })
      .catch((err: unknown) => {
        if (err instanceof OnboardingIncompleteError) {
          setState({ kind: "incomplete", missing: err.missing });
          return;
        }
        setState({ kind: "error", message: err instanceof Error ? err.message : "Something went wrong finishing setup." });
      });
  }, [profile, setProfile]);

  useEffect(() => {
    if (attempted.current) return;
    attempted.current = true;
    finish();
  }, [finish]);

  // Move focus to the outcome heading so screen readers hear the result.
  useEffect(() => {
    if (state.kind !== "finishing") headingRef.current?.focus();
  }, [state.kind]);

  function retry() {
    setState({ kind: "finishing" });
    finish();
  }

  if (state.kind === "finishing") {
    return (
      <div className="flex flex-col items-center gap-4 py-14 text-center" role="status">
        <span className="flex size-14 items-center justify-center rounded-full bg-accent-muted text-accent">
          <Loader2 size={24} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
        </span>
        <p className="font-display text-[20px] font-semibold tracking-[-0.015em] text-foreground">Finishing setup…</p>
        <p className="max-w-[44ch] text-[13.5px] leading-relaxed text-muted-foreground">
          Saving your profile and starting your first website crawl and query set.
        </p>
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <EmptyState
        icon={<AlertCircle size={20} />}
        eyebrow="Couldn't finish"
        title="Setup didn't complete"
        description={`${state.message} Nothing was lost — everything you entered is saved.`}
        action={
          <Button variant="primary" size="sm" onClick={retry}>
            Try again
          </Button>
        }
      />
    );
  }

  if (state.kind === "incomplete") {
    const steps = WIZARD_STEPS.filter((s) => state.missing.includes(s.key));
    return (
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <p className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-subtle-foreground">Almost there</p>
          <h1 ref={headingRef} tabIndex={-1} style={{ outline: "none" }} className="font-display text-[26px] font-semibold tracking-[-0.02em] text-foreground outline-none">
            {steps.length === 1 ? "One step still needs attention" : `${steps.length} steps still need attention`}
          </h1>
          <p className="max-w-[52ch] text-[14px] leading-relaxed text-muted-foreground">
            Setup finishes once these are filled in — they&apos;re what every AI Visibility and SEO measurement compares against.
          </p>
        </div>
        <ul className="flex flex-col divide-y divide-border rounded-xl border border-border bg-surface-raised">
          {steps.map((step) => (
            <li key={step.key}>
              <Link
                href={step.href}
                className="flex min-h-[52px] items-center justify-between gap-3 px-4 py-3 text-[13.5px] font-medium text-foreground transition-colors hover:bg-foreground/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                <span className="flex items-center gap-2.5">
                  <AlertCircle size={15} className="text-warning" aria-hidden="true" />
                  {step.label}
                  <span className="sr-only">— needs attention</span>
                </span>
                <ArrowRight size={14} className="text-muted-foreground" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
        <div>
          <Button variant="ghost" size="sm" onClick={retry}>
            Check again
          </Button>
        </div>
      </div>
    );
  }

  const { result } = state;
  const crawl = crawlCopy(result.crawl, profile?.brand.websiteUrl ?? "");
  const querySet = querySetCopy(result.querySet);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col items-center gap-4 text-center">
        <div className="flex size-14 items-center justify-center rounded-full border border-success/30 bg-success-muted text-success">
          <CheckCircle2 size={26} aria-hidden="true" />
        </div>
        <div className="flex flex-col gap-2">
          <h1 ref={headingRef} tabIndex={-1} style={{ outline: "none" }} className="font-display text-[26px] font-semibold tracking-[-0.02em] text-foreground outline-none">
            {result.alreadyCompleted ? "Setup is complete." : "You're all set."}
          </h1>
          <p className="max-w-[50ch] text-[14px] leading-relaxed text-muted-foreground">
            {result.alreadyCompleted
              ? `Your brand profile was completed on ${formatDate(result.completedAt)}. You can review or edit it from Settings at any time.`
              : "Your brand profile is saved, and BeBest has started building your baseline. You can leave — everything below keeps running in the background."}
          </p>
        </div>
      </div>

      <section aria-label="What started" className="rounded-xl border border-border bg-surface-raised">
        <ul className="divide-y divide-border">
          <KickoffRow icon={Globe} copy={crawl} />
          <KickoffRow icon={ListChecks} copy={querySet} />
        </ul>
      </section>

      <div className="flex flex-col-reverse items-stretch gap-3 sm:flex-row sm:justify-center">
        <Button variant="secondary" size="lg" asChild>
          <Link href="/settings?tab=brand">View brand profile</Link>
        </Button>
        <Button variant="primary" size="lg" asChild>
          <Link href="/overview">
            Go to Overview <ArrowRight size={15} aria-hidden="true" />
          </Link>
        </Button>
      </div>
    </div>
  );
}
