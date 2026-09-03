import Link from "next/link";
import { AlertCircle, ArrowRight, CheckCircle2, Sparkles } from "lucide-react";
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@bebest/ui";
import { providerLabel } from "@/data/ai-visibility/labels";
import { QUERY_CATEGORY_META } from "@/data/query-universe/constants";
import { checkLabel, CHECK_SEVERITY_BADGE_VARIANT } from "@/data/seo/labels";
import type { FreeSnapshotReport } from "@/data/snapshot/types";

/**
 * The public report page's core render — `docs/epics/17-free-snapshot.md`'s
 * "UI surface" requirement that this "needs the same design-system quality
 * bar as the authenticated app." Every number below is read straight off
 * `FreeSnapshotReport` (the exact object `lib/free-snapshot/report.ts`
 * built from the real crawl/AI-run/SEO-checklist computations, per
 * `GET /snapshot/:token`) — nothing here is re-derived or re-labeled with a
 * second copy of a formula; category/severity/provider labels are the
 * SAME lookup tables the authenticated Query Universe / SEO Intelligence /
 * AI Visibility screens use, imported directly rather than duplicated.
 */
export function SnapshotReportView({ report }: { report: FreeSnapshotReport }) {
  const generated = new Date(report.generatedAt);

  return (
    <div className="flex flex-col gap-6">
      <ReportHeader report={report} generated={generated} />

      <div className="grid gap-6 lg:grid-cols-2">
        <AiVisibilityCard report={report} />
        <SeoCard report={report} />
      </div>

      <CompetitorsCard report={report} />

      <div className="grid gap-6 lg:grid-cols-2">
        <AiGapsCard report={report} />
        <SeoGapsCard report={report} />
      </div>

      <PrioritiesCard report={report} />

      <CtaCard report={report} />

      <p className="text-[11.5px] text-subtle-foreground leading-relaxed max-w-[80ch]">{report.simplificationNote}</p>
    </div>
  );
}

function ReportHeader({ report, generated }: { report: FreeSnapshotReport; generated: Date }) {
  let hostname = report.input.website;
  try {
    hostname = new URL(report.input.website).hostname;
  } catch {
    // Keep the raw string — the report renders whatever was submitted.
  }

  return (
    <div className="flex flex-col gap-2 pb-2">
      <div className="flex items-center gap-2">
        <p className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-subtle-foreground">
          AI + SEO Growth Snapshot
        </p>
        <Badge variant="accent" size="sm">
          Free sample
        </Badge>
      </div>
      <h1 className="font-display text-[28px] sm:text-[32px] font-semibold text-foreground tracking-[-0.02em]">
        {report.input.company}
      </h1>
      <p className="text-[13px] text-muted-foreground">
        {hostname} &middot; generated{" "}
        {generated.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}
      </p>
    </div>
  );
}

function ScoreStat({ label, value, suffix = "/100" }: { label: string; value: number; suffix?: string }) {
  return (
    <div className="rounded-lg border border-border p-3.5">
      <p className="text-[11.5px] font-medium text-muted-foreground">{label}</p>
      <p className="font-mono text-[20px] font-semibold text-foreground mt-1">
        {value.toFixed(1)}
        <span className="text-[13px] text-subtle-foreground font-normal">{suffix}</span>
      </p>
    </div>
  );
}

function AiVisibilityCard({ report }: { report: FreeSnapshotReport }) {
  const { aiVisibility } = report;
  return (
    <Card>
      <CardHeader>
        <CardTitle>AI Visibility Score</CardTitle>
        <CardDescription>
          Sample run &middot; {aiVisibility.queriesRun} quer{aiVisibility.queriesRun === 1 ? "y" : "ies"} across{" "}
          {aiVisibility.providers.length} model{aiVisibility.providers.length === 1 ? "" : "s"}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div>
          <p className="font-mono text-[44px] font-semibold text-foreground leading-none">
            {aiVisibility.score.toFixed(1)}
            <span className="text-[18px] text-muted-foreground font-normal">/100</span>
          </p>
          <p className="font-mono text-[11px] text-subtle-foreground mt-2">Formula v{aiVisibility.formulaVersion}</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <ScoreStat label="Mentioned" value={aiVisibility.mentionScore} />
          <ScoreStat label="Recommended" value={aiVisibility.recommendationScore} />
          <ScoreStat label="Position" value={aiVisibility.positionScore} />
          <ScoreStat label="Coverage" value={aiVisibility.coverageScore} />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {aiVisibility.providers.map((provider) => (
            <Badge key={provider} variant="neutral" size="sm">
              {providerLabel(provider)}
            </Badge>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function SeoCard({ report }: { report: FreeSnapshotReport }) {
  const { seo } = report;
  return (
    <Card>
      <CardHeader>
        <CardTitle>SEO Health</CardTitle>
        <CardDescription>
          {seo.pagesAnalyzed} sample page{seo.pagesAnalyzed === 1 ? "" : "s"} crawled and checked
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="grid grid-cols-2 gap-3">
          <ScoreStat label="Technical score" value={seo.technicalScore} />
          <ScoreStat label="Content score" value={seo.contentScore} />
        </div>
        <div className="rounded-lg border border-border p-3.5">
          <p className="text-[11.5px] font-medium text-muted-foreground">Pages analyzed</p>
          <p className="font-mono text-[20px] font-semibold text-foreground mt-1">{seo.pagesAnalyzed}</p>
          <p className="text-[11.5px] text-subtle-foreground mt-1">
            A full paid analysis crawls far more of your site.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function CompetitorsCard({ report }: { report: FreeSnapshotReport }) {
  const { competitors } = report;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Where competitors appear vs. where you appear</CardTitle>
        <CardDescription>
          Share of this sample&apos;s AI answers that mentioned each name — your own mentions are folded into the
          AI Visibility Score above.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {competitors.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">
            No competitor mentions were detected in this sample — the full analysis runs a much larger query set.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {competitors.map((competitor) => (
              <div key={competitor.name} className="flex items-center gap-3">
                <div className="w-36 shrink-0 flex items-center gap-1.5">
                  <p className="text-[13px] font-medium text-foreground truncate">{competitor.name}</p>
                  {!competitor.autoDetected && (
                    <Badge variant="outline" size="sm" className="shrink-0">
                      Your pick
                    </Badge>
                  )}
                </div>
                <div className="flex-1 h-2 rounded-full bg-surface overflow-hidden">
                  <div
                    className="h-full bg-accent"
                    style={{ width: `${Math.min(100, Math.max(0, competitor.mentionRate))}%` }}
                  />
                </div>
                <p className="font-mono text-[12.5px] text-muted-foreground w-10 text-right shrink-0">
                  {competitor.mentionRate}%
                </p>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AiGapsCard({ report }: { report: FreeSnapshotReport }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Top AI content gaps</CardTitle>
        <CardDescription>Sample queries where your brand didn&apos;t come up.</CardDescription>
      </CardHeader>
      <CardContent>
        {report.topAiGaps.length === 0 ? (
          <EmptyGapNote text="No AI-visibility gaps found in this sample — the full analysis may still surface some." />
        ) : (
          <ul className="flex flex-col gap-4">
            {report.topAiGaps.map((gap, i) => (
              <li key={`${gap.query}-${i}`} className="flex flex-col gap-1.5">
                <p className="text-[13.5px] text-foreground leading-snug">&ldquo;{gap.query}&rdquo;</p>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge variant="neutral" size="sm">
                    {QUERY_CATEGORY_META[gap.category]?.label ?? gap.category}
                  </Badge>
                  {gap.competitorMentionedInstead && (
                    <Badge variant="danger" size="sm">
                      Competitor mentioned instead
                    </Badge>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function SeoGapsCard({ report }: { report: FreeSnapshotReport }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Top technical &amp; content SEO gaps</CardTitle>
        <CardDescription>Issues found across the crawled sample pages.</CardDescription>
      </CardHeader>
      <CardContent>
        {report.topSeoGaps.length === 0 ? (
          <EmptyGapNote text="No major technical SEO issues found in this sample — the full crawl covers far more pages." />
        ) : (
          <ul className="flex flex-col gap-3">
            {report.topSeoGaps.map((gap) => (
              <li key={gap.issueType} className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <AlertCircle size={14} className="text-subtle-foreground shrink-0" aria-hidden="true" />
                  <p className="text-[13.5px] text-foreground truncate">{checkLabel(gap.issueType)}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-[11.5px] text-subtle-foreground">
                    {gap.pageCount} page{gap.pageCount === 1 ? "" : "s"}
                  </span>
                  <Badge variant={CHECK_SEVERITY_BADGE_VARIANT[gap.severity]} size="sm">
                    {gap.severity}
                  </Badge>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function EmptyGapNote({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-2.5">
      <CheckCircle2 size={16} className="text-success shrink-0 mt-0.5" aria-hidden="true" />
      <p className="text-[13px] text-muted-foreground leading-relaxed">{text}</p>
    </div>
  );
}

function PrioritiesCard({ report }: { report: FreeSnapshotReport }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Top 3 recommended priorities</CardTitle>
        <CardDescription>What to fix first, based on this sample.</CardDescription>
      </CardHeader>
      <CardContent>
        <ol className="flex flex-col gap-4">
          {report.topPriorities.map((priority, i) => (
            <li key={i} className="flex gap-3.5">
              <span className="flex items-center justify-center size-6 rounded-full bg-accent-muted text-accent font-mono text-[12px] font-semibold shrink-0">
                {i + 1}
              </span>
              <div className="flex flex-col gap-0.5">
                <p className="text-[13.5px] font-medium text-foreground leading-snug">{priority.title}</p>
                <p className="text-[12.5px] text-muted-foreground leading-relaxed">{priority.rationale}</p>
              </div>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}

function CtaCard({ report }: { report: FreeSnapshotReport }) {
  return (
    <Card className="bg-ink-950 border-ink-950">
      <CardContent className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 p-6">
        <div className="flex items-start gap-3">
          <Sparkles size={18} className="text-verdant-400 shrink-0 mt-0.5" aria-hidden="true" />
          <div>
            <p className="font-display text-[16px] font-semibold text-ink-0 tracking-[-0.01em]">{report.cta}</p>
            <p className="text-[12.5px] text-ink-0/60 mt-1 max-w-[52ch]">
              The full product tracks your complete query universe, every competitor, and a full-site crawl —
              continuously.
            </p>
          </div>
        </div>
        <Button asChild variant="primary" size="lg" className="shrink-0">
          <Link href="/login">
            Sign up <ArrowRight size={15} />
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}
