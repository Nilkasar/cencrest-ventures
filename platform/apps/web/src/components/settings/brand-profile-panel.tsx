"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { BadgeCheck, Building2, ExternalLink, Pencil } from "lucide-react";
import { Badge, Button, EmptyState, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, cn } from "@bebest/ui";
import { ErrorPanel } from "@/components/patterns/error-panel";
import { PageStack } from "@/components/patterns/motion";
import { PropertyList, Section } from "@/components/patterns/section";
import { SectionSkeleton } from "@/components/patterns/states";
import { typography } from "@/components/patterns/typography";
import { useBrandProfile } from "@/hooks/use-brand-profile";
import { useCurrentOrg } from "@/lib/session-context";
import { WIZARD_STEPS } from "@/components/onboarding/steps";
import { completedStepCount, resumeStep } from "@/lib/onboarding-client";
import { formatDate } from "@/lib/format";
import {
  CLAIM_CONFIDENCE_LABEL,
  CLAIM_CONFIDENCE_VARIANT,
  COMPANY_SIZE_LABEL,
  COMPETITOR_PRIORITY_LABEL,
  COMPETITOR_PRIORITY_VARIANT,
} from "@/data/brand-constants";
import type { OnboardingStepKey } from "@/data/types";

/**
 * Settings > Brand profile — a read-only summary of what the guided setup
 * captured (README §3.5: "Section + PropertyList with an Edit ghost button
 * in actions"). Every edit goes back through the matching onboarding step,
 * which owns validation and saving; a step that hasn't been done yet shows
 * one "Set up" action in place of its content.
 */

function hrefFor(step: OnboardingStepKey): string {
  return WIZARD_STEPS.find((s) => s.key === step)?.href ?? "/onboarding";
}

function EditLink({ step, label }: { step: OnboardingStepKey; label: string }) {
  return (
    <Button variant="ghost" size="sm" asChild>
      <Link href={hrefFor(step)}>
        <Pencil size={13} aria-hidden="true" /> Edit<span className="sr-only"> {label}</span>
      </Link>
    </Button>
  );
}

function NotSetUp({ step, label, why }: { step: OnboardingStepKey; label: string; why: string }) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-dashed border-border-strong/60 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="text-[13px] font-medium text-foreground">{label} isn&apos;t set up yet</p>
        <p className={typography.meta}>{why}</p>
      </div>
      <Button variant="secondary" size="sm" asChild className="shrink-0 self-start sm:self-auto">
        <Link href={hrefFor(step)}>Set up {label.toLowerCase()}</Link>
      </Button>
    </div>
  );
}

function TagList({ values, variant = "outline" }: { values: string[]; variant?: "outline" | "neutral" }) {
  if (values.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {values.map((value) => (
        <Badge key={value} variant={variant} size="sm">
          {value}
        </Badge>
      ))}
    </div>
  );
}

function hostOf(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

export function BrandProfilePanel() {
  const org = useCurrentOrg();
  const { profile, loading, error, reload } = useBrandProfile(org?.id ?? "");

  if (loading) {
    return (
      <div aria-busy="true" className="flex flex-col gap-5">
        <span className="sr-only">Loading brand profile…</span>
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
          <SectionSkeleton lines={5} titleWidth="w-32" className="lg:col-span-7" />
          <SectionSkeleton lines={4} titleWidth="w-40" className="lg:col-span-5" />
        </div>
        <SectionSkeleton lines={3} titleWidth="w-28" />
      </div>
    );
  }

  if (error || !profile) {
    return <ErrorPanel title="Your brand profile didn't load" message={error ?? "Something went wrong loading this — try again."} onRetry={reload} />;
  }

  if (profile.status === "not_started") {
    return (
      <EmptyState
        icon={<Building2 size={20} />}
        title="No brand profile yet"
        description="A short guided setup captures your company, competitors, industry, use cases and claims — every AI Visibility measurement starts from it. You can edit any of it here afterwards."
        action={
          <Button variant="primary" size="sm" asChild>
            <Link href="/onboarding">Start setup</Link>
          </Button>
        }
      />
    );
  }

  const { brand, competitors, useCases, brandClaims, completedSteps } = profile;
  const done = completedStepCount(profile);
  const total = WIZARD_STEPS.length;
  const resumeHref = hrefFor(resumeStep(profile));

  const basicsItems: { label: string; value: ReactNode }[] = [
    { label: "Company", value: brand.name || null },
    {
      label: "Website",
      value: brand.websiteUrl ? (
        <a
          href={brand.websiteUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 rounded-sm text-accent underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {hostOf(brand.websiteUrl)}
          <ExternalLink size={11} aria-hidden="true" />
          <span className="sr-only">(opens in a new tab)</span>
        </a>
      ) : null,
    },
    { label: "Description", value: brand.description ? <span className="leading-relaxed">{brand.description}</span> : null },
    { label: "Positioning", value: brand.positioning ? <span className="leading-relaxed">&ldquo;{brand.positioning}&rdquo;</span> : null },
    { label: "Also known as", value: brand.aliases.length > 0 ? <TagList values={brand.aliases} variant="neutral" /> : null },
    {
      label: "Differentiators",
      value:
        brand.differentiators.length > 0 ? (
          <ul className="flex flex-col gap-1">
            {brand.differentiators.map((item) => (
              <li key={item} className="flex items-start gap-2">
                <span className="mt-[7px] size-1 shrink-0 rounded-full bg-muted-foreground" aria-hidden="true" />
                {item}
              </li>
            ))}
          </ul>
        ) : null,
    },
  ];

  return (
    <PageStack>
      {profile.status === "in_progress" && (
        <Section
          title="Finish setting up your brand"
          description="Downstream measurements need a complete baseline. Pick up where you left off."
          actions={
            <Button variant="primary" size="sm" asChild>
              <Link href={resumeHref}>Continue setup</Link>
            </Button>
          }
        >
          <div className="flex items-center gap-3">
            <div
              className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface"
              role="progressbar"
              aria-label="Brand setup progress"
              aria-valuemin={0}
              aria-valuemax={total}
              aria-valuenow={done}
              aria-valuetext={`${done} of ${total} steps done`}
            >
              <div className="h-full rounded-full bg-accent" style={{ width: `${total > 0 ? (done / total) * 100 : 0}%` }} />
            </div>
            <span className={cn(typography.numeric, "shrink-0 text-muted-foreground")}>
              {done} of {total} steps
            </span>
          </div>
        </Section>
      )}

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-12">
        <Section
          title="Brand basics"
          description={
            profile.status === "completed" && profile.completedAt ? `Setup completed ${formatDate(profile.completedAt)}` : "How AI models should know you."
          }
          actions={completedSteps["brand-basics"] ? <EditLink step="brand-basics" label="brand basics" /> : undefined}
          className="lg:col-span-7"
        >
          {completedSteps["brand-basics"] ? (
            <PropertyList items={basicsItems} />
          ) : (
            <NotSetUp step="brand-basics" label="Brand basics" why="Your name, website and description anchor every measurement." />
          )}
        </Section>

        <Section
          title="Industry & category"
          description="Where you compete."
          actions={completedSteps.industry ? <EditLink step="industry" label="industry and category" /> : undefined}
          className="lg:col-span-5"
        >
          {completedSteps.industry ? (
            <PropertyList
              items={[
                { label: "Industries", value: brand.industries.length > 0 ? <TagList values={brand.industries} /> : null },
                { label: "Categories", value: brand.categories.length > 0 ? <TagList values={brand.categories} /> : null },
                { label: "Markets", value: brand.markets.length > 0 ? <TagList values={brand.markets} /> : null },
              ]}
            />
          ) : (
            <NotSetUp step="industry" label="Industry" why="Decides which buyer questions we ask AI assistants." />
          )}
        </Section>
      </div>

      <Section
        title="Competitors"
        description={
          completedSteps.competitors
            ? `${competitors.length} tracked — every score compares you against them.`
            : "Every score compares you against them."
        }
        actions={completedSteps.competitors ? <EditLink step="competitors" label="competitors" /> : undefined}
        flush={completedSteps.competitors && competitors.length > 0}
      >
        {!completedSteps.competitors ? (
          <NotSetUp step="competitors" label="Competitors" why="Without them there's nothing to compare your visibility against." />
        ) : competitors.length === 0 ? (
          <p className={typography.secondary}>No competitors added. Add a few so scores have something to compare against.</p>
        ) : (
          <Table framed={false}>
            <TableHeader>
              <TableRow>
                <TableHead>Competitor</TableHead>
                <TableHead>Website</TableHead>
                <TableHead>Priority</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {competitors.map((competitor) => (
                <TableRow key={competitor.id}>
                  <TableCell className="font-medium">{competitor.name}</TableCell>
                  <TableCell className="text-muted-foreground">{hostOf(competitor.websiteUrl)}</TableCell>
                  <TableCell>
                    <Badge variant={COMPETITOR_PRIORITY_VARIANT[competitor.priority]} size="sm">
                      {COMPETITOR_PRIORITY_LABEL[competitor.priority]}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-2">
        <Section
          title="Use cases"
          description="The jobs buyers hire you for."
          actions={completedSteps["use-cases"] ? <EditLink step="use-cases" label="use cases" /> : undefined}
          flush={completedSteps["use-cases"] && useCases.length > 0}
        >
          {!completedSteps["use-cases"] ? (
            <NotSetUp step="use-cases" label="Use cases" why="They shape the prompts we test across AI assistants." />
          ) : useCases.length === 0 ? (
            <p className={typography.secondary}>No use cases added.</p>
          ) : (
            <ul className="divide-y divide-border">
              {useCases.map((useCase) => (
                <li key={useCase.id} className="flex flex-col gap-1.5 px-5 py-4">
                  <p className="text-[13.5px] font-medium text-foreground">{useCase.title}</p>
                  {useCase.solutions.length > 0 && <p className={typography.meta}>{useCase.solutions.join(" · ")}</p>}
                  <TagList values={useCase.companySizes.map((size) => COMPANY_SIZE_LABEL.get(size) ?? size)} variant="neutral" />
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section
          title="Brand claims"
          description="What you want AI assistants to say about you."
          actions={completedSteps.claims ? <EditLink step="claims" label="brand claims" /> : undefined}
          flush={completedSteps.claims && brandClaims.length > 0}
        >
          {!completedSteps.claims ? (
            <NotSetUp step="claims" label="Brand claims" why="Optional — lets us check whether AI repeats what you claim." />
          ) : brandClaims.length === 0 ? (
            <p className={typography.secondary}>No claims added yet — optional, add them anytime.</p>
          ) : (
            <ul className="divide-y divide-border">
              {brandClaims.map((claim) => (
                <li key={claim.id} className="flex flex-col gap-2 px-5 py-4">
                  <p className="text-[13px] leading-relaxed text-foreground">{claim.claim}</p>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant={CLAIM_CONFIDENCE_VARIANT[claim.confidence]} size="sm">
                      {CLAIM_CONFIDENCE_LABEL.get(claim.confidence)} confidence
                    </Badge>
                    {claim.verified && (
                      <Badge variant="success" size="sm">
                        <BadgeCheck size={11} aria-hidden="true" /> Verified
                      </Badge>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </PageStack>
  );
}
