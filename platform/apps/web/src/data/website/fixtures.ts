import { currentOrganization } from "@/data/fixtures";
import type { CrawlStepKey, IssueSeverity, IssueType, Page, PageIssue } from "./types";

/**
 * The brand this screen crawls. Deliberately a small, self-contained
 * fixture rather than a read through `useBrandProfile`/`onboarding-client`
 * — that module now calls the real Epic 2 API (see
 * `docs/epics/02-brand-intelligence-frontend.md`'s "post-verification
 * fixes"), which this epic has no live backend to satisfy. Tied to the same
 * `currentOrganization` fixture everything else in the shell uses, so the
 * tenant story stays consistent.
 */
export const crawlBrand = {
  id: "brand_fixture_1",
  organizationId: currentOrganization.id,
  name: currentOrganization.name,
  websiteUrl: "https://www.northwindlogistics.com",
};

// ---------------------------------------------------------------------------
// Crawl step schedule
//
// A real crawl is a background job that runs for minutes (per the epic's UI
// surface note, quoting `CUSTOMER_JOURNEY.md` Stage 3 Step 4: "10-15
// minutes, customer can leave"). Compressing that into an actual 10-15
// minute wait would make this screen unreviewable, so the simulated
// timeline below runs in ~26 seconds of wall-clock time — long enough that
// the step-by-step progression is visibly real (not an instant 0-to-100
// jump), short enough to watch complete. `getCrawlProgress` derives the
// current step from elapsed time against this fixed schedule, so a page
// reload mid-crawl reconstructs the same state instead of losing progress.
export const CRAWL_STEP_SCHEDULE: { key: CrawlStepKey; label: string; description: string; durationMs: number }[] = [
  {
    key: "queued",
    label: "Queued",
    description: "Waiting for a crawl slot to free up.",
    durationMs: 1200,
  },
  {
    key: "validating",
    label: "Validating site & robots.txt",
    description: "Resolving the root URL's DNS and reading robots.txt before any page is fetched — including a re-check of the resolved IP, not just the hostname.",
    durationMs: 2600,
  },
  {
    key: "discovering",
    label: "Discovering pages",
    description: "Reading the sitemap and following internal links, up to 3 levels deep.",
    durationMs: 3200,
  },
  {
    key: "crawling",
    label: "Fetching pages",
    description: "Requesting each page at up to 2 requests/second, extracting titles, headings, and structured data.",
    durationMs: 14000,
  },
  {
    key: "analyzing",
    label: "Analyzing for issues",
    description: "Checking every crawled page for missing metadata, thin content, and broken links.",
    durationMs: 3400,
  },
  {
    key: "finalizing",
    label: "Finalizing report",
    description: "Grouping issues by severity and saving this crawl to your site's history.",
    durationMs: 1400,
  },
];

export const CRAWL_TOTAL_DURATION_MS = CRAWL_STEP_SCHEDULE.reduce((sum, step) => sum + step.durationMs, 0);

/** How many pages a fresh crawl of `crawlBrand.websiteUrl` "finds" — fixed,
 *  not random, so the same job id always produces the same result on
 *  reload. Comfortably under the spec's 500-page cap. */
export const FIXTURE_PAGES_FOUND = 236;

/** How far into `pagesFound` a job gets before a simulated SSRF-style
 *  failure (triggered via `?bbDemoError=1`, same convention as the CRM's
 *  `data/crm/client.ts`) halts it. */
export const FIXTURE_FAILURE_AT_PAGE = 132;

export const STATUS_LABEL: Record<string, string> = {
  pending: "Queued",
  running: "Running",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
};

export const SEVERITY_LABEL: Record<IssueSeverity, string> = {
  critical: "Critical",
  warning: "Warning",
  info: "Info",
};

export const ISSUE_TYPE_LABEL: Record<IssueType, string> = {
  missing_title: "Missing title tag",
  missing_meta: "Missing meta description",
  duplicate_title: "Duplicate title tag",
  missing_canonical: "Missing canonical URL",
  broken_link: "Broken internal link",
  redirect_chain: "Redirect chain",
  missing_alt: "Image missing alt text",
  missing_h1: "Missing H1 heading",
  title_too_long: "Title tag too long",
  meta_too_long: "Meta description too long",
  thin_content: "Thin content",
  noindex: "Page marked noindex",
};

/** One severity per issue type. The real `page_issues` table lets severity
 *  vary per row, but a fixed type→severity mapping is a reasonable
 *  simplification for fixture data and matches how these checks are
 *  actually authored in practice (a `missing_title` finding is always
 *  treated as critical, not sometimes-critical-sometimes-not). */
export const SEVERITY_BY_ISSUE_TYPE: Record<IssueType, IssueSeverity> = {
  missing_title: "critical",
  broken_link: "critical",
  noindex: "critical",
  duplicate_title: "warning",
  missing_canonical: "warning",
  thin_content: "warning",
  redirect_chain: "warning",
  title_too_long: "warning",
  missing_meta: "info",
  missing_h1: "info",
  missing_alt: "info",
  meta_too_long: "info",
};

const PATH_TEMPLATES = [
  "/",
  "/pricing",
  "/about",
  "/contact",
  "/careers",
  "/product/overview",
  "/product/features",
  "/product/integrations",
  "/solutions/enterprise",
  "/solutions/last-mile",
  "/blog",
  "/blog/post-{n}",
  "/case-studies/{n}",
  "/docs/getting-started",
  "/docs/api/{n}",
  "/resources/guides/{n}",
  "/customers/{n}",
  "/webinars/{n}",
  "/legal/privacy",
  "/legal/terms",
  "/support/faq",
  "/partners",
  "/events/{n}",
  "/press/{n}",
];

function pathForIndex(index: number): string {
  const template = PATH_TEMPLATES[index % PATH_TEMPLATES.length]!;
  if (!template.includes("{n}")) return template;
  const n = Math.floor(index / PATH_TEMPLATES.length) + 1;
  return template.replace("{n}", String(n));
}

/** The URL a crawl "just fetched" at a given page index — used by the
 *  progress screen's live "last fetched" line while the "crawling" step is
 *  active, without generating the full page/issue set before the crawl
 *  actually finishes. */
export function urlForPageIndex(index: number): string {
  return `${crawlBrand.websiteUrl}${pathForIndex(index)}`;
}

function titleForPath(path: string): string {
  if (path === "/") return "Northwind Logistics | Freight, warehousing, and last-mile delivery";
  const segment = path.split("/").filter(Boolean).pop() ?? "page";
  const words = segment
    .replace(/-/g, " ")
    .split(" ")
    .map((w) => (w.length ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(" ");
  return `${words} | Northwind Logistics`;
}

/** Deterministic per-page id/url/title/etc. and the issues (if any) it
 *  produces, for a given `crawlJobId` and page index. Pure function of its
 *  inputs — no `Math.random()` — so results are reproducible across
 *  reloads without needing to persist the raw generation logic. */
function buildPage(crawlJobId: string, index: number, crawledAt: string): { page: Page; issues: PageIssue[] } {
  const path = pathForIndex(index);
  const url = `${crawlBrand.websiteUrl}${path}`;
  const missingTitle = index % 23 === 0 && index > 0;
  const duplicateTitle = index % 17 === 0 && index > 0 && index % 34 !== 0;
  const missingMeta = index % 11 === 0;
  const missingCanonical = index % 13 === 0 && index > 0;
  const missingH1 = index % 19 === 0 && index > 0;
  const missingAlt = index % 29 === 0;
  const titleTooLong = index % 31 === 0 && index > 0;
  const metaTooLong = index % 37 === 0 && index > 0;
  const thinContent = index % 9 === 0 && index > 0;
  const brokenLink = index % 41 === 0 && index > 0;
  const redirectChain = index % 43 === 0 && index > 0;
  const noindex = index % 47 === 0 && index > 0;

  const statusCode = brokenLink ? 404 : redirectChain ? 301 : 200;
  const wordCount = thinContent ? 90 + (index % 60) : 420 + ((index * 37) % 900);
  const title = missingTitle ? null : duplicateTitle ? "Northwind Logistics" : titleTooLong
    ? `${titleForPath(path)} — Everything you need to know about our freight, warehousing, and last-mile delivery network`
    : titleForPath(path);
  const metaDescription = missingMeta
    ? null
    : metaTooLong
      ? "Northwind Logistics provides end-to-end freight, warehousing, and last-mile delivery for enterprise shippers across North America, with real-time tracking, dedicated account management, and flexible capacity — learn more about how our network can support your supply chain."
      : `Learn about ${titleForPath(path).split(" | ")[0]!.toLowerCase()} at Northwind Logistics.`;
  const h1 = missingH1 ? null : titleForPath(path).split(" | ")[0]!;
  const canonical = missingCanonical ? null : url;
  const schemaTypes = index % 5 === 0 ? ["Organization"] : index % 7 === 0 ? ["BreadcrumbList"] : [];

  const page: Page = {
    id: `page_${crawlJobId}_${index}`,
    organizationId: crawlBrand.organizationId,
    crawlJobId,
    brandId: crawlBrand.id,
    url,
    title,
    metaDescription,
    h1,
    canonical,
    statusCode,
    wordCount,
    loadMs: 180 + (index % 40) * 15,
    internalLinks: 8 + (index % 12),
    externalLinks: index % 6,
    schemaTypes,
    crawledAt,
  };

  const issues: PageIssue[] = [];
  function addIssue(issueType: IssueType, detail: string) {
    issues.push({
      id: `issue_${crawlJobId}_${index}_${issueType}`,
      organizationId: crawlBrand.organizationId,
      brandId: crawlBrand.id,
      pageId: page.id,
      issueType,
      severity: SEVERITY_BY_ISSUE_TYPE[issueType],
      detail,
      createdAt: crawledAt,
    });
  }

  if (missingTitle) addIssue("missing_title", `${url} has no <title> tag.`);
  if (duplicateTitle) addIssue("duplicate_title", `Title "Northwind Logistics" is reused across multiple pages, including ${url}.`);
  if (missingMeta) addIssue("missing_meta", `${url} has no meta description.`);
  if (missingCanonical) addIssue("missing_canonical", `${url} has no canonical URL set.`);
  if (missingH1) addIssue("missing_h1", `${url} has no H1 heading.`);
  if (missingAlt) addIssue("missing_alt", `${url} has at least one image with no alt text.`);
  if (titleTooLong) addIssue("title_too_long", `Title tag on ${url} is ${title!.length} characters (recommended under 60).`);
  if (metaTooLong) addIssue("meta_too_long", `Meta description on ${url} is ${metaDescription!.length} characters (recommended under 160).`);
  if (thinContent) addIssue("thin_content", `${url} has only ${wordCount} words of body content.`);
  if (brokenLink) addIssue("broken_link", `${url} returned a 404.`);
  if (redirectChain) addIssue("redirect_chain", `${url} redirects (301) before resolving — consider linking to the final destination directly.`);
  if (noindex) addIssue("noindex", `${url} carries a noindex directive and will not appear in AI or search citations.`);

  return { page, issues };
}

/** Generates the full result set for a crawl job that fetched `pageCount`
 *  pages — used both for a job that completed normally (`pageCount ===
 *  job.pagesFound`) and one that failed partway through (`pageCount ===
 *  the count at the moment of failure`), so a failed job still shows real
 *  partial results rather than nothing. */
export function generateCrawlResults(crawlJobId: string, pageCount: number, crawledAt: string): { pages: Page[]; issues: PageIssue[] } {
  const pages: Page[] = [];
  const issues: PageIssue[] = [];
  for (let i = 0; i < pageCount; i++) {
    const { page, issues: pageIssues } = buildPage(crawlJobId, i, crawledAt);
    pages.push(page);
    issues.push(...pageIssues);
  }
  return { pages, issues };
}
