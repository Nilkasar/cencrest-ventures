import { Badge } from "@bebest/ui";
import type { ContentQualityCheck } from "@/data/content/types";
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
  return (
    <span className={`inline-flex items-center gap-1 ${ok ? "text-success" : "text-muted-foreground"}`}>
      <span aria-hidden>{ok ? "✓" : "✗"}</span>
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

/**
 * The 5 quality-check results a generated draft always carries — this
 * epic's literal DoD requirement, verbatim: "every check's result stored
 * alongside the draft... a reviewer needs to see what was checked, not just
 * that something was." Rendered directly inline wherever a draft appears
 * (the "drafts awaiting approval" list AND the approval screen) — never
 * behind a click, per the epic's UI-surface requirement. Always renders all
 * 5 in `QUALITY_CHECK_ORDER`, even if a check result is unexpectedly
 * missing (defensive — `runAllQualityChecks` guarantees all 5 server-side,
 * but a partial fetch failure should show what's missing, not silently
 * collapse the list).
 */
export function QualityCheckList({ checks }: { checks: ContentQualityCheck[] }) {
  const byType = new Map(checks.map((c) => [c.checkType, c]));
  return (
    <div className="flex flex-col divide-y divide-border">
      {QUALITY_CHECK_ORDER.map((type) => {
        const check = byType.get(type);
        return (
          <div key={type} className="py-2.5 first:pt-0 last:pb-0 flex flex-col gap-1">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-[12.5px] font-medium text-foreground">{QUALITY_CHECK_LABEL[type]}</p>
              {check ? (
                <>
                  <Badge variant={QUALITY_CHECK_STATUS_BADGE_VARIANT[check.status]} size="sm">
                    {QUALITY_CHECK_STATUS_LABEL[check.status]}
                  </Badge>
                  {check.score !== null && <span className="font-mono text-[11px] text-subtle-foreground">{check.score}/100</span>}
                </>
              ) : (
                <Badge variant="outline" size="sm">
                  Not run
                </Badge>
              )}
            </div>
            {check && (
              <div className="text-[12px] text-muted-foreground leading-relaxed">
                <CheckDetails check={check} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
