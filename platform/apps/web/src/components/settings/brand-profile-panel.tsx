"use client";

import Link from "next/link";
import {
  AlertCircle,
  BadgeCheck,
  Building2,
  Compass,
  FileCheck2,
  Pencil,
  Target,
  Users,
} from "lucide-react";
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
} from "@bebest/ui";
import { useBrandProfile } from "@/hooks/use-brand-profile";
import { currentOrganization } from "@/data/fixtures";
import { WIZARD_STEPS } from "@/components/onboarding/steps";
import { completedStepCount, resumeStep } from "@/lib/onboarding-client";
import {
  CLAIM_CONFIDENCE_LABEL,
  CLAIM_CONFIDENCE_VARIANT,
  COMPANY_SIZE_LABEL,
  COMPETITOR_PRIORITY_LABEL,
  COMPETITOR_PRIORITY_VARIANT,
} from "@/data/brand-constants";
import type { OnboardingStepKey } from "@/data/types";

function hrefFor(step: OnboardingStepKey): string {
  return WIZARD_STEPS.find((s) => s.key === step)?.href ?? "/onboarding";
}

function SectionEmpty({ step, label }: { step: OnboardingStepKey; label: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <p className="text-[13px] text-muted-foreground">{label} hasn&apos;t been set up yet.</p>
      <Button variant="secondary" size="sm" asChild>
        <Link href={hrefFor(step)}>Set up</Link>
      </Button>
    </div>
  );
}

function EditLink({ step }: { step: OnboardingStepKey }) {
  return (
    <Button variant="ghost" size="sm" asChild>
      <Link href={hrefFor(step)}>
        <Pencil size={13} /> Edit
      </Link>
    </Button>
  );
}

export function BrandProfilePanel() {
  const { profile, loading, error, reload } = useBrandProfile(currentOrganization.id);

  if (loading) {
    return (
      <div className="flex flex-col gap-4">
        {[0, 1, 2].map((i) => (
          <div key={i} className="rounded-xl border border-border bg-surface-raised p-5">
            <Skeleton className="h-4 w-32 mb-4" />
            <SkeletonText lines={2} />
          </div>
        ))}
      </div>
    );
  }

  if (error || !profile) {
    return (
      <EmptyState
        icon={<AlertCircle size={20} />}
        eyebrow="Couldn't load"
        title="Your brand profile didn't load"
        description={error ?? "Something went wrong loading this — try again."}
        action={
          <Button variant="primary" size="sm" onClick={reload}>
            Try again
          </Button>
        }
      />
    );
  }

  if (profile.status === "not_started") {
    return (
      <EmptyState
        icon={<Building2 size={20} />}
        eyebrow="Brand profile"
        title="No brand profile yet"
        description="Company name, website, competitors, industry, use cases, and brand claims are captured in a short guided setup — and stay editable here afterward."
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
  const resumeHref = hrefFor(resumeStep(profile));

  return (
    <div className="flex flex-col gap-5">
      {profile.status === "in_progress" && (
        <div className="flex items-center justify-between gap-4 rounded-lg border border-accent/30 bg-accent-muted px-4 py-3">
          <div className="flex flex-col gap-0.5">
            <p className="text-[13px] font-medium text-accent">Setup is in progress — {done} of {WIZARD_STEPS.length} steps done</p>
            <p className="text-[12px] text-accent/80">Finish the rest so downstream measurements have a complete baseline.</p>
          </div>
          <Button variant="primary" size="sm" asChild>
            <Link href={resumeHref}>Finish setup</Link>
          </Button>
        </div>
      )}
      {profile.status === "completed" && profile.completedAt && (
        <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-subtle-foreground">
          Setup completed {new Date(profile.completedAt).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}
        </p>
      )}

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Building2 size={16} className="text-muted-foreground" /> Brand basics
          </CardTitle>
          {completedSteps["brand-basics"] && <EditLink step="brand-basics" />}
        </CardHeader>
        <CardContent>
          {!completedSteps["brand-basics"] ? (
            <SectionEmpty step="brand-basics" label="Brand basics" />
          ) : (
            <div className="flex flex-col gap-3">
              <div>
                <p className="text-[15px] font-medium text-foreground">{brand.name}</p>
                <a href={brand.websiteUrl} target="_blank" rel="noreferrer" className="text-[12.5px] text-accent hover:underline">
                  {brand.websiteUrl.replace(/^https?:\/\//, "")}
                </a>
              </div>
              <p className="text-[13px] leading-relaxed text-muted-foreground">{brand.description}</p>
              {brand.positioning && (
                <p className="border-l-2 border-border pl-3 text-[13px] italic leading-relaxed text-foreground">
                  &ldquo;{brand.positioning}&rdquo;
                </p>
              )}
              {brand.aliases.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {brand.aliases.map((alias) => (
                    <Badge key={alias} variant="neutral" size="sm">
                      {alias}
                    </Badge>
                  ))}
                </div>
              )}
              {brand.differentiators.length > 0 && (
                <ul className="flex flex-col gap-1 text-[13px] text-foreground">
                  {brand.differentiators.map((item) => (
                    <li key={item} className="flex items-start gap-2">
                      <span className="mt-1.5 size-1 shrink-0 rounded-full bg-accent" aria-hidden="true" />
                      {item}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Users size={16} className="text-muted-foreground" /> Competitors
          </CardTitle>
          {completedSteps.competitors && <EditLink step="competitors" />}
        </CardHeader>
        <CardContent>
          {!completedSteps.competitors ? (
            <SectionEmpty step="competitors" label="Competitors" />
          ) : competitors.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">No competitors added.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Website</TableHead>
                  <TableHead>Priority</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {competitors.map((competitor) => (
                  <TableRow key={competitor.id}>
                    <TableCell className="font-medium">{competitor.name}</TableCell>
                    <TableCell className="text-muted-foreground">{competitor.websiteUrl.replace(/^https?:\/\//, "")}</TableCell>
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
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Compass size={16} className="text-muted-foreground" /> Industry &amp; category
          </CardTitle>
          {completedSteps.industry && <EditLink step="industry" />}
        </CardHeader>
        <CardContent>
          {!completedSteps.industry ? (
            <SectionEmpty step="industry" label="Industry & category" />
          ) : (
            <div className="flex flex-col gap-3">
              {[
                { label: "Industries", values: brand.industries },
                { label: "Categories", values: brand.categories },
                { label: "Markets", values: brand.markets },
              ].map((group) => (
                <div key={group.label} className="flex flex-col gap-1.5">
                  <p className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-subtle-foreground">{group.label}</p>
                  {group.values.length === 0 ? (
                    <p className="text-[12.5px] text-muted-foreground">Not set</p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {group.values.map((value) => (
                        <Badge key={value} variant="outline" size="sm">
                          {value}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Target size={16} className="text-muted-foreground" /> Use cases
          </CardTitle>
          {completedSteps["use-cases"] && <EditLink step="use-cases" />}
        </CardHeader>
        <CardContent>
          {!completedSteps["use-cases"] ? (
            <SectionEmpty step="use-cases" label="Use cases" />
          ) : (
            <div className="flex flex-col gap-4">
              {useCases.map((useCase) => (
                <div key={useCase.id} className="flex flex-col gap-1.5 border-b border-border pb-4 last:border-0 last:pb-0">
                  <p className="text-[13.5px] font-medium text-foreground">{useCase.title}</p>
                  <p className="text-[12.5px] leading-relaxed text-muted-foreground">{useCase.solutions.join(" · ")}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {useCase.companySizes.map((size) => (
                      <Badge key={size} variant="neutral" size="sm">
                        {COMPANY_SIZE_LABEL.get(size) ?? size}
                      </Badge>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <FileCheck2 size={16} className="text-muted-foreground" /> Brand claims
          </CardTitle>
          {completedSteps.claims && <EditLink step="claims" />}
        </CardHeader>
        <CardContent>
          {!completedSteps.claims ? (
            <SectionEmpty step="claims" label="Brand claims" />
          ) : brandClaims.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">No claims added yet — optional, add them anytime.</p>
          ) : (
            <div className="flex flex-col gap-3">
              {brandClaims.map((claim) => (
                <div key={claim.id} className="flex flex-col gap-1 border-b border-border pb-3 last:border-0 last:pb-0">
                  <p className="text-[13px] leading-relaxed text-foreground">{claim.claim}</p>
                  <div className="flex items-center gap-1.5">
                    <Badge variant={CLAIM_CONFIDENCE_VARIANT[claim.confidence]} size="sm">
                      {CLAIM_CONFIDENCE_LABEL.get(claim.confidence)} confidence
                    </Badge>
                    {claim.verified && (
                      <Badge variant="success" size="sm" className="gap-1">
                        <BadgeCheck size={11} /> Verified
                      </Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
