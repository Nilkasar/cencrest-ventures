/**
 * HTML metadata extraction + sanitization for the Epic 3 crawler.
 *
 * Deliberately regex-based, not a real DOM parser (no `cheerio`/`jsdom`
 * dependency exists in `apps/api` today, and adding one is out of scope for
 * this pass — see docs/epics/03-website-intelligence-backend.md's "not
 * done" list). This is a KNOWN limitation: malformed/adversarial HTML can
 * defeat a regex extractor in ways a real parser wouldn't. It does not
 * weaken the security posture, though — nothing here ever stores or
 * executes raw HTML; every extracted field is sanitized (tags stripped,
 * length-capped) before it reaches `sanitizeExtractedText`, and the raw
 * HTML string itself is never persisted, only hashed (`raw_html_hash`).
 *
 * "Sanitize before storage" (docs/epics/03-website-intelligence.md) means:
 * crawled content is untrusted input. A malicious page could put a fake
 * "IGNORE PREVIOUS INSTRUCTIONS" string in its <title>, or literal <script>
 * markup, hoping either to render as a live element in `apps/web` or to be
 * read as an instruction by an LLM in a later epic when this data feeds
 * GEO analysis (Epic 7+). Every text field this module returns is stripped
 * of tags and control characters and length-capped BEFORE it is ever
 * written to the `pages` table.
 */

import { createHash } from 'node:crypto';

const HTML_ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
};

/** Strips all tags, decodes a small safe set of entities, collapses
 * whitespace, and truncates. This is the ONE place any HTML-derived string
 * passes through before being written to the database — never write an
 * extracted field directly. */
export function sanitizeExtractedText(input: string | null | undefined, maxLen: number): string | null {
  if (!input) return null;
  let text = input.replace(/<[^>]*>/g, ' ');
  text = text.replace(/&[a-zA-Z]+;|&#\d+;/g, (m) => HTML_ENTITIES[m] ?? ' ');
  // eslint-disable-next-line no-control-regex
  text = text.replace(/[\x00-\x1F\x7F]/g, '');
  text = text.replace(/\s+/g, ' ').trim();
  if (!text) return null;
  return text.length > maxLen ? text.slice(0, maxLen) : text;
}

export interface ExtractedPage {
  title: string | null;
  metaDescription: string | null;
  h1: string | null;
  canonicalUrl: string | null;
  wordCount: number;
  schemaTypes: string[];
  isNoindex: boolean;
  imagesTotal: number;
  imagesMissingAlt: number;
  /** Absolute, same-origin http(s) links discovered in the page, deduped. */
  internalLinks: string[];
  externalLinkCount: number;
  rawHtmlHash: string;
}

function matchAttr(tag: string, name: string): string | null {
  const re = new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, 'i');
  return re.exec(tag)?.[1] ?? null;
}

export function extractPageData(html: string, pageUrl: string): ExtractedPage {
  const rawHtmlHash = createHash('sha256').update(html).digest('hex');

  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const title = sanitizeExtractedText(titleMatch?.[1], 500);

  const h1Match = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  const h1 = sanitizeExtractedText(h1Match?.[1], 500);

  let metaDescription: string | null = null;
  let isNoindex = false;
  const metaTagRe = /<meta\s+[^>]*>/gi;
  let metaTag: RegExpExecArray | null;
  while ((metaTag = metaTagRe.exec(html))) {
    const tag = metaTag[0];
    const name = (matchAttr(tag, 'name') ?? '').toLowerCase();
    const content = matchAttr(tag, 'content') ?? '';
    if (name === 'description' && metaDescription === null) {
      metaDescription = sanitizeExtractedText(content, 2000);
    }
    if (name === 'robots' && /noindex/i.test(content)) {
      isNoindex = true;
    }
  }

  let canonicalUrl: string | null = null;
  const linkTagRe = /<link\s+[^>]*>/gi;
  let linkTag: RegExpExecArray | null;
  while ((linkTag = linkTagRe.exec(html))) {
    const tag = linkTag[0];
    const rel = (matchAttr(tag, 'rel') ?? '').toLowerCase();
    if (rel === 'canonical') {
      const href = matchAttr(tag, 'href');
      if (href) {
        try {
          canonicalUrl = new URL(href, pageUrl).toString().slice(0, 2048);
        } catch {
          // ignore unparseable canonical href
        }
      }
    }
  }

  const schemaTypes = new Set<string>();
  const microdataTypeRe = /itemtype\s*=\s*["']https?:\/\/schema\.org\/([A-Za-z]+)["']/gi;
  let microMatch: RegExpExecArray | null;
  while ((microMatch = microdataTypeRe.exec(html))) {
    schemaTypes.add(microMatch[1]!);
  }
  const ldJsonRe = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let ldMatch: RegExpExecArray | null;
  while ((ldMatch = ldJsonRe.exec(html))) {
    collectJsonLdTypes(ldMatch[1]!, schemaTypes);
  }

  const imgTagRe = /<img\s+[^>]*>/gi;
  let imagesTotal = 0;
  let imagesMissingAlt = 0;
  let imgTag: RegExpExecArray | null;
  while ((imgTag = imgTagRe.exec(html))) {
    imagesTotal++;
    const alt = matchAttr(imgTag[0], 'alt');
    if (alt === null || alt.trim() === '') imagesMissingAlt++;
  }

  let pageOrigin: string | null = null;
  try {
    pageOrigin = new URL(pageUrl).origin;
  } catch {
    // pageUrl already validated by safeFetch upstream; defensive only
  }

  const internalLinks = new Set<string>();
  let externalLinkCount = 0;
  const anchorRe = /<a\s+[^>]*>/gi;
  let anchorTag: RegExpExecArray | null;
  while ((anchorTag = anchorRe.exec(html))) {
    const href = matchAttr(anchorTag[0], 'href');
    if (!href) continue;
    let resolved: URL;
    try {
      resolved = new URL(href, pageUrl);
    } catch {
      continue;
    }
    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') continue;
    resolved.hash = '';
    if (pageOrigin && resolved.origin === pageOrigin) {
      internalLinks.add(resolved.toString());
    } else {
      externalLinkCount++;
    }
  }

  const bodyMatch = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(html);
  const bodyText = sanitizeExtractedText(bodyMatch?.[1] ?? html, 5_000_000) ?? '';
  const wordCount = bodyText.length === 0 ? 0 : bodyText.split(/\s+/).filter(Boolean).length;

  return {
    title,
    metaDescription,
    h1,
    canonicalUrl,
    wordCount,
    schemaTypes: [...schemaTypes],
    isNoindex,
    imagesTotal,
    imagesMissingAlt,
    internalLinks: [...internalLinks],
    externalLinkCount,
    rawHtmlHash,
  };
}

/** Best-effort walk of a parsed JSON-LD value collecting every `@type`.
 * Wrapped in try/catch by the caller's context (this function itself never
 * throws — `JSON.parse` failures are swallowed since malformed JSON-LD on
 * an untrusted page is expected, not exceptional). */
function collectJsonLdTypes(rawJson: string, into: Set<string>): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    return;
  }
  walkForType(parsed, into, 0);
}

function walkForType(node: unknown, into: Set<string>, depth: number): void {
  if (depth > 10 || node === null || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node) walkForType(item, into, depth + 1);
    return;
  }
  const obj = node as Record<string, unknown>;
  const type = obj['@type'];
  if (typeof type === 'string') into.add(type);
  else if (Array.isArray(type)) {
    for (const t of type) if (typeof t === 'string') into.add(t);
  }
  for (const value of Object.values(obj)) walkForType(value, into, depth + 1);
}
