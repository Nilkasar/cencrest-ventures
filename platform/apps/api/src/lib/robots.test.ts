import { describe, expect, it } from 'vitest';
import { parseRobotsTxt } from './robots.js';

describe('parseRobotsTxt', () => {
  it('allows everything when there are no matching rule groups', () => {
    const rules = parseRobotsTxt('User-agent: SomeOtherBot\nDisallow: /\n');
    expect(rules.isAllowed('/anything')).toBe(true);
  });

  it('applies wildcard (*) rules to our crawler', () => {
    const rules = parseRobotsTxt('User-agent: *\nDisallow: /admin\n');
    expect(rules.isAllowed('/admin/settings')).toBe(false);
    expect(rules.isAllowed('/public')).toBe(true);
  });

  it('prefers a rule group specifically addressed to our user-agent over *', () => {
    const rules = parseRobotsTxt(
      ['User-agent: *', 'Disallow: /', '', 'User-agent: BeBestCrawler', 'Disallow: /private', 'Allow: /'].join('\n'),
    );
    expect(rules.isAllowed('/anything')).toBe(true);
    expect(rules.isAllowed('/private/data')).toBe(false);
  });

  it('longest-prefix-match wins between Allow and Disallow', () => {
    const rules = parseRobotsTxt('User-agent: *\nDisallow: /docs\nAllow: /docs/public\n');
    expect(rules.isAllowed('/docs/secret')).toBe(false);
    expect(rules.isAllowed('/docs/public/page')).toBe(true);
  });

  it('an empty Disallow value means allow-all for that group', () => {
    const rules = parseRobotsTxt('User-agent: *\nDisallow:\n');
    expect(rules.isAllowed('/anything')).toBe(true);
  });

  it('collects Sitemap directives regardless of case/position', () => {
    const rules = parseRobotsTxt(
      ['Sitemap: https://example.com/sitemap.xml', 'User-agent: *', 'Disallow:', 'sitemap: https://example.com/sitemap2.xml'].join(
        '\n',
      ),
    );
    expect(rules.sitemapUrls).toEqual(['https://example.com/sitemap.xml', 'https://example.com/sitemap2.xml']);
  });

  it('ignores comments and blank lines', () => {
    const rules = parseRobotsTxt(['# comment', '', 'User-agent: *', '# another comment', 'Disallow: /x'].join('\n'));
    expect(rules.isAllowed('/x/y')).toBe(false);
    expect(rules.isAllowed('/y')).toBe(true);
  });
});
