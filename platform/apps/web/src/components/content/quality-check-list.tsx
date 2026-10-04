import { AlertTriangle, Check, CheckCircle2, CircleDashed, X, XCircle } from "lucide-react";
import { Badge, cn } from "@bebest/ui";
import type { ContentQualityCheck, QualityCheckStatus } from "@/data/content/types";
import {
  QUALITY_CHECK_LABEL,
  QUALITY_CHECK_ORDER,
  QUALITY_CHECK_STATUS_BADGE_VARIANT,
  QUALITY_CHECK_STATUS_LABEL,
} from "@/data/content/labels";

/** Narrow, per-`checkType` shapes of `content_quality_checks.details` — read
 *  directly from `apps/api/src/lib/content/quality-checks.ts`'s own result
 *  builders, not guessed. Cast at this single render site rather than
 *  threading a discriminated-union type through the wire-shaped
 *  `ContentQualityCheck` itself. */
interface FactCheckDetails {
  riskyPhrasesFound: string[];
  groundedPhrases: string[];
  brandClaimsConsidered: number;
  verifiedClaimsConsidered: number;
}
interface BrandVoiceDetails {
  brandNameMentioned: boolean;
  aiDisclaimerPhrasesFound: string[];
}
interface DuplicateContentDetails {
  pagesChecked: number;
  mostSimilarUrl: string | null;
  titleSimilarity: number;
  exactTitleMatch: boolean;
}
interface SeoChecklistDetails {
  contentChecklist: { pagesAnalyzed: number; averageWordCount: number; thinContentPages: number; pagesWithSchemaMarkup: number; pagesWithoutSchemaMarkup: number };
  titleLength: number;
  titleLengthOk: boolean;
  metaDescriptionLength: number;
  metaDescriptionOk: boolean;
}
interface GeoStructureDetails {
  signals: { hasNumberedList: boolean; hasFaqSignal: boolean; hasCitableStatement: boolean; hasEntityAssociation: boolean };
}

function Signal({ ok, label }: { ok: boolean; label: string }) {
  const Icon = ok ? Check : X;
  return (
    <span className={cn("inline-flex items-center gap-1.5", ok ? "text-foreground" : "text-muted-foreground")}>
      <Icon size={12} className={ok ? "text-success" : "text-subtle-foreground"} aria-hidden="true" />
      <span className="sr-only">{ok ? "Yes:" : "No:"}</span>
      {label}
    </span>
  );
}

function CheckDetails({ check }: { check: ContentQualityCheck }) {
  const d = check.details;
  switch (check.checkType) {
    case "fact_check": {
      const details = d as unknown as FactCheckDetails;
      if (details.riskyPhrasesFound?.length > 0) {
        return (
          <p>
            Ungrounded claim{details.riskyPhrasesFound.length > 1 ? "s" : ""} found:{" "}
            <span className="text-foreground">{details.riskyPhrasesFound.join(", ")}</span> — no verified brand claim backs
            {details.riskyPhrasesFound.length > 1 ? " these" : " this"}.
          </p>
        );
      }
      return (
        <p>
          No ungrounded absolute/superlative claims
          {details.groundedPhrases?.length > 0 ? ` (${details.groundedPhrases.join(", ")} backed by a verified brand claim)` : ""} — checked against{" "}
          {details.verifiedClaimsConsidered} verified brand claim{details.verifiedClaimsConsidered === 1 ? "" : "s"}.
        </p>
      );
    }
    case "brand_voice": {
      const details = d as unknown as BrandVoiceDetails;
      return (
        <div className="flex flex-col gap-0.5">
          <Signal ok={details.brandNameMentioned} label="Brand named in the content" />
          <Signal ok={details.aiDisclaimerPhrasesFound?.length === 0} label="No AI-disclaimer phrases leaked into the copy" />
        </div>
      );
    }
    case "duplicate_content": {
      const details = d as unknown as DuplicateContentDetails;
      if (details.pagesChecked === 0) return <p>No previously-crawled pages to compare against yet.</p>;
      return (
        <p>
          {Math.round(details.titleSimilarity * 100)}% title similarity to the closest existing page
          {details.mostSimilarUrl ? (
            <>
              {" "}
              (<span className="text-foreground break-all">{details.mostSimilarUrl}</span>)
            </>
          ) : null}{" "}
          out of {details.pagesChecked} checked{details.exactTitleMatch ? " — exact title match." : "."}
        </p>
      );
    }
    case "seo_checklist": {
      const details = d as unknown as SeoChecklistDetails;
      return (
        <div className="flex flex-col gap-0.5">
          <Signal ok={details.titleLengthOk} label={`Title length ${details.titleLength} chars (target 50–60)`} />
          <Signal ok={details.metaDescriptionOk} label={`Meta description ${details.metaDescriptionLength} chars (target 140–160)`} />
          <Signal ok={details.contentChecklist.thinContentPages === 0} label={`Not thin content (avg ${details.contentChecklist.averageWordCount} words)`} />
          <Signal ok={details.contentChecklist.pagesWithSchemaMarkup > 0} label="Has structured-data markup" />
        </div>
      );
    }
    case "geo_structure": {
      const details = d as unknown as GeoStructureDetails;
      return (
        <div className="flex flex-col gap-0.5">
          <Signal ok={details.signals.hasNumberedList} label="Numbered-list structure" />
          <Signal ok={details.signals.hasFaqSignal} label="FAQ-style Q&A framing" />
          <Signal ok={details.signals.hasCitableStatement} label="A named, citable statement (stat, study, source)" />
          <Signal ok={details.signals.hasEntityAssociation} label="Brand explicitly associated with the target query" />
        </div>
      );
    }
    default:
      return null;
  }
}

const STATUS_ICON: Record<QualityCheckStatus, typeof CheckCircle2> = {
  pass: CheckCircle2,
  warning: AlertTriangle,
  fail: XCircle,
};

const STATUS_TONE: Record<QualityCheckStatus, string> = {
  pass: "text-success",
  warning: "text-warning",
  fail: "text-danger",
};

const PIP_TONE: Record<QualityCheckStatus, string> = {
  pass: "bg-success",
  warning: "bg-warning",
  fail: "bg-danger",
};

/** One-line verdict for a draft's five checks: a pip per check in run
 *  order plus "4 of 5 passed". Status is in the text, not only the color. */
export function QualitySummary({ checks, className }: { checks: ContentQualityCheck[]; className?: string }) {
  const byType = new Map(checks.map((c) => [c.checkType, c]));
  const passed = checks.filter((c) => c.status === "pass").length;
  const failed = checks.filter((c) => c.status === "fail").length;
  const warned = checks.filter((c) => c.status === "warning").length;
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <span className="flex items-center gap-1" aria-hidden="true">
        {QUALITY_CHECK_ORDER.map((type) => {
          const check = byType.get(type);
          return (
            <span
              key={type}
              title={`${QUALITY_CHECK_LABEL[type]}: ${check ? QUALITY_CHECK_STATUS_LABEL[check.status] : "Not run"}`}
              className={cn("h-2 w-4 rounded-full", check ? PIP_TONE[check.status] : "bg-border-strong/60")}
            />
          );
        })}
      </span>
      <span className="text-[12.5px] text-muted-foreground">
        <span className="font-medium text-foreground">{passed} of {QUALITY_CHECK_ORDER.length}</span> passed
        {failed > 0 && ` · ${failed} failed`}
        {warned > 0 && ` · ${warned} warning${warned === 1 ? "" : "s"}`}
      </span>
    </div>
  );
}

/**
 * The 5 quality-check results a generated draft always carries — Epic 11's
 * DoD: "a reviewer needs to see what was checked, not just that something
 * was." Rendered inline wherever a draft appears (the review queue and the
 * approval screen), never behind a click. Always renders all 5 in
 * `QUALITY_CHECK_ORDER`, even if one is unexpectedly missing, so a partial
 * fetch failure shows what's missing instead of collapsing the list.
 */
export function QualityCheckList({ checks, columns = 1 }: { checks: ContentQualityCheck[]; columns?: 1 | 2 }) {
  const byType = new Map(checks.map((c) => [c.checkType, c]));
  return (
    <ul className={cn("grid gap-x-6", columns === 2 ? "md:grid-cols-2" : "grid-cols-1")}>
      {QUALITY_CHECK_ORDER.map((type) => {
        const check = byType.get(type);
        const Icon = check ? STATUS_ICON[check.status] : CircleDashed;
        return (
          <li key={type} className="flex gap-2.5 border-b border-border py-3 last:border-b-0">
            <Icon size={15} className={cn("mt-0.5 shrink-0", check ? STATUS_TONE[check.status] : "text-subtle-foreground")} aria-hidden="true" />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-[13px] font-medium text-foreground">{QUALITY_CHECK_LABEL[type]}</p>
                {check ? (
                  <Badge variant={QUALITY_CHECK_STATUS_BADGE_VARIANT[check.status]} size="sm">
                    {QUALITY_CHECK_STATUS_LABEL[check.status]}
                  </Badge>
                ) : (
                  <Badge variant="outline" size="sm">
                    Not run
                  </Badge>
                )}
                {check?.score !== null && check?.score !== undefined && (
                  <span className="ml-auto font-mono text-[11.5px] tabular-nums text-muted-foreground">{check.score}/100</span>
                )}
              </div>
              {check && (
                <div className="text-[12.5px] leading-relaxed text-muted-foreground">
                  <CheckDetails check={check} />
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
