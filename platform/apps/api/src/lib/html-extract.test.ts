import { describe, expect, it } from 'vitest';
import { extractPageData, sanitizeExtractedText } from './html-extract.js';

describe('sanitizeExtractedText', () => {
  it('strips tags and decodes basic entities', () => {
    expect(sanitizeExtractedText('<b>Hello &amp; welcome</b>', 100)).toBe('Hello & welcome');
  });

  it('strips tags (including scripts) rather than executing/preserving them', () => {
    // Tag-stripping replaces each tag with a space (so adjacent words never
    // fuse together), then whitespace collapses to one space.
    expect(sanitizeExtractedText('<script>alert(1)</script>Real title', 100)).toBe('alert(1) Real title');
  });

  it('truncates to maxLen', () => {
    expect(sanitizeExtractedText('a'.repeat(50), 10)).toHaveLength(10);
  });

  it('returns null for empty/whitespace-only input', () => {
    expect(sanitizeExtractedText('   ', 10)).toBeNull();
    expect(sanitizeExtractedText(null, 10)).toBeNull();
    expect(sanitizeExtractedText(undefined, 10)).toBeNull();
  });
});

describe('extractPageData', () => {
  const baseUrl = 'https://example.com/page';

  it('extracts title, meta description, h1, canonical', () => {
    const html = `
      <html><head>
        <title>My Page Title</title>
        <meta name="description" content="A great page about things.">
        <link rel="canonical" href="https://example.com/canonical-page">
      </head><body><h1>Welcome</h1><p>${'word '.repeat(50)}</p></body></html>`;
    const result = extractPageData(html, baseUrl);
    expect(result.title).toBe('My Page Title');
    expect(result.metaDescription).toBe('A great page about things.');
    expect(result.h1).toBe('Welcome');
    expect(result.canonicalUrl).toBe('https://example.com/canonical-page');
    expect(result.wordCount).toBeGreaterThan(40);
  });

  it('detects noindex from a robots meta tag', () => {
    const html = '<html><head><meta name="robots" content="noindex, nofollow"></head><body></body></html>';
    expect(extractPageData(html, baseUrl).isNoindex).toBe(true);
  });

  it('collects schema.org types from microdata and JSON-LD', () => {
    const html = `
      <div itemscope itemtype="https://schema.org/Product"></div>
      <script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization","name":"Acme"}</script>
    `;
    const result = extractPageData(html, baseUrl);
    expect(result.schemaTypes).toEqual(expect.arrayContaining(['Product', 'Organization']));
  });

  it('does not crash on malformed JSON-LD', () => {
    const html = '<script type="application/ld+json">{not valid json</script>';
    expect(() => extractPageData(html, baseUrl)).not.toThrow();
  });

  it('counts images missing alt text', () => {
    const html = '<img src="a.png" alt="a description"><img src="b.png"><img src="c.png" alt="">';
    const result = extractPageData(html, baseUrl);
    expect(result.imagesTotal).toBe(3);
    expect(result.imagesMissingAlt).toBe(2);
  });

  it('splits internal vs external links and dedupes internal ones', () => {
    const html = `
      <a href="/about">About</a>
      <a href="/about">About again</a>
      <a href="https://example.com/contact">Contact</a>
      <a href="https://other.com/page">External</a>
      <a href="javascript:void(0)">JS link (ignored)</a>
    `;
    const result = extractPageData(html, baseUrl);
    expect(result.internalLinks.sort()).toEqual(['https://example.com/about', 'https://example.com/contact']);
    expect(result.externalLinkCount).toBe(1);
  });

  it('sanitizes an XSS attempt in the title before it is ever returned', () => {
    const html = '<title><script>alert(1)</script>Legit Title</title>';
    expect(extractPageData(html, baseUrl).title).not.toContain('<script>');
  });

  it('produces a stable sha256 hash of the raw html', () => {
    const a = extractPageData('<html>same</html>', baseUrl);
    const b = extractPageData('<html>same</html>', baseUrl);
    const c = extractPageData('<html>different</html>', baseUrl);
    expect(a.rawHtmlHash).toBe(b.rawHtmlHash);
    expect(a.rawHtmlHash).not.toBe(c.rawHtmlHash);
    expect(a.rawHtmlHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('returns nulls/zeros gracefully for an empty document', () => {
    const result = extractPageData('', baseUrl);
    expect(result.title).toBeNull();
    expect(result.metaDescription).toBeNull();
    expect(result.h1).toBeNull();
    expect(result.canonicalUrl).toBeNull();
    expect(result.wordCount).toBe(0);
    expect(result.schemaTypes).toEqual([]);
  });
});
