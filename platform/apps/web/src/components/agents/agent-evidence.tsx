import Link from "next/link";

/** Known evidence keys this epic's agents actually attach (see
 *  `geo-agent.ts`/`seo-agent.ts`/`diagnose-gaps-step.ts`'s literal
 *  `evidence: {...}` shapes) mapped to the screen that owns that id's real
 *  data — there is no per-id detail route for an AI run/opportunity/
 *  recommendation/query set in this app (Epics 7/9/10/5 all show their data
 *  on one list screen, not a `/thing/:id` page), so a "real evidence link"
 *  here means "the screen where this id's row lives," not a deep link to a
 *  URL that doesn't exist. */
const EVIDENCE_LINK: Record<string, { label: string; href: string }> = {
  aiRunId: { label: "View in AI Visibility", href: "/ai-visibility" },
  querySetId: { label: "View in Query Universe", href: "/query-universe" },
  opportunityId: { label: "View in Opportunities", href: "/opportunities" },
  recommendationId: { label: "View in Recommendations", href: "/recommendations" },
  brandId: { label: "View in Settings", href: "/settings" },
};

/** Renders one `agent_events.evidence` (or `.payload`) JSONB object as a
 *  small, real key -> value disclosure — never re-narrated as prose, per
 *  this epic's own "real evidence, not a vague string" requirement.
 *  Anything matching a known id key above also gets a direct link to the
 *  screen that owns it. Primitive values render inline; arrays/objects
 *  render as compact JSON so nothing is silently dropped. */
export function AgentEvidence({ evidence }: { evidence: Record<string, unknown> }) {
  const entries = Object.entries(evidence);
  if (entries.length === 0) return null;

  return (
    <dl className="flex flex-col gap-1 mt-1.5 rounded-md border border-border bg-surface px-2.5 py-2">
      {entries.map(([key, value]) => {
        const link = EVIDENCE_LINK[key];
        return (
          <div key={key} className="flex items-start gap-2 text-[11.5px]">
            <dt className="font-mono text-subtle-foreground shrink-0">{key}</dt>
            <dd className="text-foreground break-all min-w-0">
              {typeof value === "object" && value !== null ? (
                <code className="font-mono text-[11px]">{JSON.stringify(value)}</code>
              ) : (
                String(value)
              )}
              {link && (
                <Link href={link.href} className="ml-2 text-accent hover:underline underline-offset-4 whitespace-nowrap">
                  {link.label}
                </Link>
              )}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
