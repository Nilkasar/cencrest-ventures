/**
 * Minimal robots.txt parser for the Epic 3 crawler.
 *
 * Deliberately NOT a full RFC 9309 implementation (no wildcard `*`/`$`
 * pattern matching inside paths, no `Crawl-delay` beyond a simple numeric
 * read) — this crawler only ever needs "is this path disallowed for our
 * user-agent" and "what sitemaps does this site declare," and a minimal,
 * auditable parser is safer than a dependency for something that parses
 * untrusted text. If a future epic needs wildcard support, extend this
 * file — don't add a second robots parser.
 */

export interface RobotsRules {
  isAllowed(path: string): boolean;
  sitemapUrls: string[];
}

interface RuleGroup {
  userAgents: string[];
  disallow: string[];
  allow: string[];
}

const OUR_USER_AGENT = 'BeBestCrawler';

export function parseRobotsTxt(content: string): RobotsRules {
  const lines = content.split(/\r?\n/);
  const groups: RuleGroup[] = [];
  const sitemapUrls: string[] = [];
  let current: RuleGroup | null = null;
  let sawRuleSinceLastAgent = false;

  for (const rawLine of lines) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;

    const sep = line.indexOf(':');
    if (sep === -1) continue;
    const field = line.slice(0, sep).trim().toLowerCase();
    const value = line.slice(sep + 1).trim();

    if (field === 'sitemap') {
      if (value) sitemapUrls.push(value);
      continue;
    }

    if (field === 'user-agent') {
      // A new User-agent line right after a Disallow/Allow starts a NEW
      // group (per the spec, consecutive User-agent lines with no rules
      // between them belong to the SAME group).
      if (!current || sawRuleSinceLastAgent) {
        current = { userAgents: [], disallow: [], allow: [] };
        groups.push(current);
        sawRuleSinceLastAgent = false;
      }
      current.userAgents.push(value.toLowerCase());
      continue;
    }

    if (!current) continue; // rule with no preceding User-agent — ignore

    if (field === 'disallow') {
      sawRuleSinceLastAgent = true;
      if (value) current.disallow.push(value);
    } else if (field === 'allow') {
      sawRuleSinceLastAgent = true;
      if (value) current.allow.push(value);
    }
  }

  const ourGroup =
    groups.find((g) => g.userAgents.includes(OUR_USER_AGENT.toLowerCase())) ??
    groups.find((g) => g.userAgents.includes('*'));

  const rules = ourGroup ? [...ourGroup.allow.map((p) => ({ p, allow: true })), ...ourGroup.disallow.map((p) => ({ p, allow: false }))] : [];

  return {
    sitemapUrls,
    isAllowed(path: string): boolean {
      if (!ourGroup) return true;
      // Longest-matching-prefix wins (standard robots.txt precedence rule),
      // ties broken in favor of Allow.
      let best: { p: string; allow: boolean } | null = null;
      for (const rule of rules) {
        if (rule.p === '') continue; // "Disallow:" with empty value means allow-all
        if (path.startsWith(rule.p)) {
          if (!best || rule.p.length > best.p.length || (rule.p.length === best.p.length && rule.allow)) {
            best = rule;
          }
        }
      }
      return best ? best.allow : true;
    },
  };
}

export const CRAWLER_USER_AGENT = OUR_USER_AGENT;
