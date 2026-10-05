import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

/** Known evidence keys this epic's agents actually attach (see
 *  `geo-agent.ts`/`seo-agent.ts`/`diagnose-gaps-step.ts`'s literal
 *  `evidence: {...}` shapes) mapped to the screen that owns that id's real
 *  data — there is no per-id detail route for an AI run/opportunity/
 *  recommendation/query set in this app, so a "real evidence link" here
 *  means "the screen where this id's row lives". */
const EVIDENCE_LINK: Record<string, { label: string; href: string }> = {
  aiRunId: { label: "AI Visibility", href: "/ai-visibility" },
  querySetId: { label: "Query Universe", href: "/query-universe" },
  opportunityId: { label: "Opportunities", href: "/opportunities" },
  recommendationId: { label: "Recommendations", href: "/recommendations" },
  brandId: { label: "Settings", href: "/settings" },
};

/** "aiRunId" → "Ai run id" → readable key label, keeping the raw key in a
 *  tooltip so nothing is lost. */
function humanizeKey(key: string): string {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/_/g, " ").toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Renders one `agent_events.evidence` JSONB object as a real key → value
 *  list — never re-narrated as prose. Known id keys also link to the
 *  screen that owns them. Primitive values render inline; arrays/objects
 *  render as compact JSON so nothing is silently dropped. */
export function AgentEvidence({ evidence }: { evidence: Record<string, unknown> }) {
  const entries = Object.entries(evidence);
  if (entries.length === 0) return null;

  return (
    <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1.5 rounded-lg border border-border bg-surface/60 px-3 py-2.5 sm:grid-cols-[minmax(96px,auto)_minmax(0,1fr)]">
      {entries.map(([key, value]) => {
        const link = EVIDENCE_LINK[key];
        return (
          <div key={key} className="contents">
            <dt className="text-[12px] text-muted-foreground" title={key}>
              {humanizeKey(key)}
            </dt>
            <dd className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-[12px] text-foreground">
              {typeof value === "object" && value !== null ? (
                <code className="break-all font-mono text-[11.5px]">{JSON.stringify(value)}</code>
              ) : (
                <span className="break-all font-mono text-[11.5px]">{String(value)}</span>
              )}
              {link && (
                <Link
                  href={link.href}
                  className="inline-flex shrink-0 items-center gap-0.5 rounded-sm font-medium text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Open in {link.label} <ArrowUpRight size={11} aria-hidden="true" />
                </Link>
              )}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
