/**
 * SEO Agent step: read the brand's already-crawled `pages`/`page_issues`
 * (Epic 3) — READ-ONLY, no new crawl is triggered here (triggering a real
 * crawl means a real outbound HTTP fetch, which this build's hard
 * constraint forbids agents from doing as a side effect of a "diagnose"
 * step; `POST /brands/me/crawl` remains the explicit, human-initiated way
 * to get fresh crawl data). If the brand has never been crawled, this step
 * reports that honestly rather than fabricating findings.
 *
 * **Prompt-injection note (this epic's own required test, see
 * `seo-agent.test.ts`).** `detail`/`title` below are raw, human- or
 * crawler-authored strings that may contain adversarial text (a page
 * author trying to plant an instruction for whatever eventually reads its
 * content). This function does exactly one thing with them: places them,
 * quoted, inside a plain observation STRING and an evidence DATA object —
 * it never concatenates them into a prompt sent to any AI provider (this
 * step makes no AI provider call at all) and never evaluates/executes them
 * as code or as instructions to this agent. The agent's own subsequent
 * behavior (which recommendations get generated) is driven entirely by
 * `lib/opportunities/recompute.ts`/`lib/recommendations/generator.ts`'s
 * deterministic, template-based logic — neither reads this function's
 * output at all, so page content could not steer them even if it wanted to.
 */
import { withOrgContext, type page_issues } from '@bebest/database';

export interface PageIssueFinding {
  pageIssueId: string;
  pageId: string;
  pageUrl: string;
  pageTitle: string | null;
  issueType: string;
  severity: string;
  detail: string | null;
}

const SEVERITY_RANK: Record<string, number> = { high: 3, medium: 2, low: 1 };

export async function readPageIssuesStep(organizationId: string, brandId: string, limit = 3): Promise<PageIssueFinding[]> {
  const issues: page_issues[] = await withOrgContext(organizationId, (tx) =>
    tx.page_issues.findMany({ where: { organization_id: organizationId, brand_id: brandId } }),
  );
  if (issues.length === 0) return [];

  const pageIds = [...new Set(issues.map((i) => i.page_id))];
  const pages = await withOrgContext(organizationId, (tx) =>
    tx.pages.findMany({ where: { organization_id: organizationId, id: { in: pageIds } } }),
  );
  const pageById = new Map(pages.map((p) => [p.id, p]));

  return issues
    .sort((a, b) => (SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0))
    .slice(0, limit)
    .map((issue) => {
      const page = pageById.get(issue.page_id);
      return {
        pageIssueId: issue.id,
        pageId: issue.page_id,
        pageUrl: page?.url ?? 'unknown',
        pageTitle: page?.title ?? null,
        issueType: issue.issue_type,
        severity: issue.severity,
        detail: issue.detail,
      };
    });
}
