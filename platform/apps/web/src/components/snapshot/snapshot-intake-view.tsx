"use client";

import { useState } from "react";
import { ArrowUp, Clock, CreditCard, Gauge, ListChecks, Search, ShieldCheck, Users } from "lucide-react";
import { Button } from "@bebest/ui";
import { SnapshotIntakeForm } from "./snapshot-intake-form";
import { SnapshotConfirmation } from "./snapshot-confirmation";
import { SnapshotSamplePreview } from "./snapshot-sample-preview";
import type { SnapshotSubmitResponse } from "@/data/snapshot/types";

/**
 * `docs/epics/17-free-snapshot.md`'s "UI surface": the intake form and the
 * confirmation screen, both on this one route — a successful submit swaps
 * the form out for the confirmation view in place, no navigation, so the
 * visitor never loses the response payload (including the report token)
 * to a page transition.
 *
 * Laid out as a landing page rather than a bare form. Every "Get Free
 * Snapshot" CTA on the marketing site points here, so this is the first
 * screen a cold prospect sees, and it previously offered a heading, six
 * inputs and nothing to judge the offer by.
 *
 * The layout is four full-width rows rather than two tall columns. A
 * sidebar arrangement was tried first and rendered with ~1400px of dead
 * space under the form card, because the supporting column was far longer
 * than the form — the same "empty" problem in a new place. Rows keep the
 * form beside the hero (above the fold on desktop) while every section
 * below it uses the full measure.
 *
 * Only claims that are true of the shipped pipeline appear here — no client
 * counts, logos or testimonials, because there are none yet.
 */

const DELIVERABLES = [
  {
    icon: Gauge,
    title: "Your AI Visibility Score",
    body: "One number per model — ChatGPT, Claude, Gemini and Perplexity — for how often you surface in category buying questions.",
  },
  {
    icon: Users,
    title: "Who AI recommends instead",
    body: "The brands currently winning the answers in your category, and how far ahead of you they are.",
  },
  {
    icon: Search,
    title: "Why you're being skipped",
    body: "A basic SEO and crawlability pass on your site, plus the sources those models actually cited.",
  },
  {
    icon: ListChecks,
    title: "What to fix first",
    body: "The two or three highest-impact moves, drawn from what the run found rather than a generic checklist.",
  },
] as const;

const STEPS = [
  { n: "01", title: "You submit the form", body: "Six fields, four of them required. Takes under a minute." },
  { n: "02", title: "We run the queries", body: "A sample of category buying questions across all four models, plus a crawl of your site." },
  { n: "03", title: "We compute the score", body: "The same deterministic scoring the paid audit uses, on a smaller prompt set." },
  { n: "04", title: "You get the report", body: "A link lands in your inbox. You can watch it build in the browser too." },
] as const;

const ASSURANCES = [
  { icon: CreditCard, label: "No credit card" },
  { icon: Clock, label: "Usually minutes" },
  { icon: ShieldCheck, label: "We never sell your data" },
] as const;

const FAQS = [
  {
    q: "Is it actually free?",
    a: "Yes. No card, no trial that converts, no obligation. The snapshot costs us real AI spend to run, and we offer it because seeing your own score is a better argument than anything we could write here.",
  },
  {
    q: "How is this different from the paid audit?",
    a: "Same scoring engine, much smaller prompt set. The snapshot samples your category; the full audit runs a far larger prompt universe, maps every citation source, and produces a prioritised plan.",
  },
  {
    q: "What do you do with my email?",
    a: "Send you the report and follow up once. We don't sell or share it.",
  },
] as const;

const SECTION_HEADING = "font-display text-[22px] font-semibold text-foreground tracking-[-0.015em]";

export function SnapshotIntakeView() {
  const [submitted, setSubmitted] = useState<SnapshotSubmitResponse | undefined>();

  // Post-submit the persuasion is spent, so the confirmation gets the page to
  // itself in a reading-width column rather than being stranded in one grid
  // column beside a sales pitch the visitor has already accepted.
  if (submitted) {
    return (
      <div className="mx-auto max-w-2xl">
        <SnapshotConfirmation response={submitted} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-14 lg:gap-20">
      {/* Row 1 — the pitch and the form side by side, so a desktop visitor
          never has to scroll to find the one interactive thing here. Explicit
          row/column placement (rather than `order-*`) keeps the DOM order
          pitch → form → proof, which is what a phone reads top to bottom;
          `order-*` put the bare form first on mobile, before anything had
          made the case for filling it in. The sample report takes the second
          row of the left column so it fills the space beside the form
          instead of leaving a gap there. */}
      <div className="grid gap-8 lg:grid-cols-12 lg:gap-x-12 lg:gap-y-10">
        <header className="flex flex-col gap-4 lg:col-span-7 lg:col-start-1 lg:row-start-1">
          <p className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-subtle-foreground">
            Free AI + SEO Growth Snapshot
          </p>
          <h1 className="font-display text-[34px] sm:text-[44px] font-semibold text-foreground tracking-[-0.025em] leading-[1.08]">
            See why AI recommends your competitors.
          </h1>
          <p className="text-[15px] text-muted-foreground leading-relaxed max-w-[58ch]">
            We run a real, computed sample — your AI Visibility Score across ChatGPT, Claude, Gemini and Perplexity, a
            basic SEO pass on your site, and the gaps worth fixing first. Nothing here is a mock-up: the numbers in
            your report come from queries we actually run.
          </p>
          <ul className="flex flex-wrap items-center gap-x-5 gap-y-2 pt-1">
            {ASSURANCES.map(({ icon: Icon, label }) => (
              <li key={label} className="flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
                <Icon size={14} className="text-accent" aria-hidden="true" />
                {label}
              </li>
            ))}
          </ul>
        </header>

        <div className="lg:col-span-5 lg:col-start-8 lg:row-start-1 lg:row-span-2">
          <div
            id="snapshot-form"
            className="rounded-xl border border-border bg-surface-raised shadow-md p-6 sm:p-7 scroll-mt-8"
          >
            <div className="flex flex-col gap-1.5 mb-6">
              <h2 className="font-display text-[19px] font-semibold text-foreground tracking-[-0.01em]">
                Get your snapshot
              </h2>
              <p className="text-[13px] text-muted-foreground leading-relaxed">
                Four required fields. The two optional ones sharpen the competitor comparison.
              </p>
            </div>
            <SnapshotIntakeForm onSubmitted={setSubmitted} />
          </div>
        </div>

        <div className="lg:col-span-7 lg:col-start-1 lg:row-start-2">
          <SnapshotSamplePreview />
        </div>
      </div>

      {/* Row 2 — the deliverables, four across at full width. */}
      <section aria-labelledby="snapshot-deliverables" className="flex flex-col gap-6">
        <h2 id="snapshot-deliverables" className={SECTION_HEADING}>
          What lands in your inbox
        </h2>
        <ul className="grid gap-x-8 gap-y-7 sm:grid-cols-2 lg:grid-cols-4">
          {DELIVERABLES.map(({ icon: Icon, title, body }) => (
            <li key={title} className="flex flex-col gap-2.5">
              <span
                className="flex size-9 items-center justify-center rounded-lg border border-border bg-surface text-accent"
                aria-hidden="true"
              >
                <Icon size={16} />
              </span>
              <h3 className="text-[14px] font-medium text-foreground">{title}</h3>
              <p className="text-[13px] text-muted-foreground leading-relaxed">{body}</p>
            </li>
          ))}
        </ul>
      </section>

      {/* Row 3 — the four steps as a horizontal track. The rule above each
          step replaces the vertical connector the stacked version used. */}
      <section aria-labelledby="snapshot-steps" className="flex flex-col gap-6">
        <h2 id="snapshot-steps" className={SECTION_HEADING}>
          How it runs
        </h2>
        <ol className="grid gap-x-8 gap-y-7 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map(({ n, title, body }) => (
            <li key={n} className="flex flex-col gap-2.5 border-t border-border pt-4">
              <span className="font-mono text-[11px] font-medium tracking-[0.1em] text-accent">{n}</span>
              <h3 className="text-[14px] font-medium text-foreground">{title}</h3>
              <p className="text-[13px] text-muted-foreground leading-relaxed">{body}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* Row 4 — the FAQ, then a closing CTA back up to the form so the page
          does not end in a dead end for anyone who read the whole thing. */}
      <section aria-labelledby="snapshot-faq" className="flex flex-col gap-6">
        <h2 id="snapshot-faq" className={SECTION_HEADING}>
          Before you ask
        </h2>
        <dl className="grid gap-x-8 gap-y-7 sm:grid-cols-2 lg:grid-cols-3">
          {FAQS.map(({ q, a }) => (
            <div key={q} className="flex flex-col gap-2 border-t border-border pt-4">
              <dt className="text-[14px] font-medium text-foreground">{q}</dt>
              <dd className="text-[13px] text-muted-foreground leading-relaxed">{a}</dd>
            </div>
          ))}
        </dl>
      </section>

      <div className="flex flex-col items-center gap-4 rounded-xl border border-border bg-surface-raised px-6 py-10 text-center">
        <p className="font-display text-[20px] font-semibold text-foreground tracking-[-0.015em]">
          Find out where you stand.
        </p>
        <p className="text-[13.5px] text-muted-foreground leading-relaxed max-w-[52ch]">
          Four fields, no card, and a report built from queries we actually run.
        </p>
        <Button asChild variant="primary" size="lg">
          <a href="#snapshot-form">
            Get my free snapshot <ArrowUp size={15} aria-hidden="true" />
          </a>
        </Button>
      </div>
    </div>
  );
}
