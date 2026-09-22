/**
 * Real Google Search Console `SEODataProvider` implementation. Replaces
 * `MockSearchConsoleProvider` in `resolve-provider-for-org.ts` when a
 * genuine OAuth access token (not a `mock:` placeholder) is present on the
 * org's `integrations` row. All three interface methods call the GSC Search
 * Analytics API; the fourth method (`getSiteUrl`) is not part of
 * `SEODataProvider` but is called from `routes/integrations.ts`'s OAuth
 * callback to auto-detect which site to store in `config_enc`.
 */
import { google } from 'googleapis';
import { classifyIntent, type SEODataProvider, type KeywordData, type RankingData } from './seo-data-provider.js';

function makeAuth(accessToken: string) {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  return auth;
}

function daysAgoISO(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

const TODAY = () => new Date().toISOString().slice(0, 10);

export class GoogleSearchConsoleProvider implements SEODataProvider {
  readonly name = 'search_console';
  private readonly accessToken: string;
  private readonly siteUrl: string | undefined;

  constructor(accessToken: string, siteUrl?: string) {
    this.accessToken = accessToken;
    this.siteUrl = siteUrl;
  }

  async getSiteUrl(): Promise<string | null> {
    const auth = makeAuth(this.accessToken);
    const sc = google.webmasters({ version: 'v3', auth });
    const res = await sc.sites.list();
    const sites = res.data.siteEntry ?? [];
    const verified = sites.find((s) => s.permissionLevel !== 'siteUnverifiedUser');
    return verified?.siteUrl ?? sites[0]?.siteUrl ?? null;
  }

  private async resolveSiteUrl(): Promise<string> {
    if (this.siteUrl) return this.siteUrl;
    const url = await this.getSiteUrl();
    if (!url) throw new Error('No verified Search Console site found for this account.');
    return url;
  }

  async getKeywordData(keywords: string[]): Promise<KeywordData[]> {
    const siteUrl = await this.resolveSiteUrl();
    const auth = makeAuth(this.accessToken);
    const sc = google.webmasters({ version: 'v3', auth });

    const body: Record<string, unknown> = {
      startDate: daysAgoISO(28),
      endDate: TODAY(),
      dimensions: ['query'],
      rowLimit: keywords.length > 0 ? Math.min(keywords.length, 1000) : 1000,
    };
    if (keywords.length > 0) {
      body.dimensionFilterGroups = [
        {
          filters: [
            {
              dimension: 'query',
              operator: 'includingRegex',
              expression: keywords.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'),
            },
          ],
        },
      ];
    }

    const res = await sc.searchanalytics.query({ siteUrl, requestBody: body });
    const rows = res.data.rows ?? [];

    const result: KeywordData[] = rows.map((row) => {
      const keyword = (row.keys ?? [])[0] ?? '';
      return {
        keyword,
        intent: classifyIntent(keyword),
        monthlyVolume: row.impressions != null ? Math.round(row.impressions) : null,
        difficulty: null,
        confidence: 'high' as const,
        source: this.name,
      };
    });

    if (keywords.length > 0) {
      const found = new Set(result.map((r) => r.keyword.toLowerCase()));
      for (const kw of keywords) {
        if (!found.has(kw.toLowerCase())) {
          result.push({ keyword: kw, intent: classifyIntent(kw), monthlyVolume: null, difficulty: null, confidence: 'high', source: this.name });
        }
      }
    }

    return result;
  }

  async getCompetitorKeywords(_domain: string, _limit?: number): Promise<KeywordData[]> {
    // GSC only reports data for verified-owner sites, never third-party
    // domains — no competitor data is available through this provider.
    return [];
  }

  async getRankings(domain: string, keywords: string[]): Promise<RankingData[]> {
    const siteUrl = await this.resolveSiteUrl();
    const auth = makeAuth(this.accessToken);
    const sc = google.webmasters({ version: 'v3', auth });

    const body: Record<string, unknown> = {
      startDate: daysAgoISO(28),
      endDate: TODAY(),
      dimensions: ['query', 'page'],
      rowLimit: 1000,
    };
    if (keywords.length > 0) {
      body.dimensionFilterGroups = [
        {
          filters: [
            {
              dimension: 'query',
              operator: 'includingRegex',
              expression: keywords.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'),
            },
          ],
        },
      ];
    }

    const res = await sc.searchanalytics.query({ siteUrl, requestBody: body });
    const rows = res.data.rows ?? [];

    const bestByKeyword = new Map<string, { position: number; url: string }>();
    for (const row of rows) {
      const kw = (row.keys ?? [])[0] ?? '';
      const page = (row.keys ?? [])[1] ?? `https://${domain}/`;
      const pos = row.position ?? null;
      if (pos !== null) {
        const existing = bestByKeyword.get(kw);
        if (!existing || pos < existing.position) {
          bestByKeyword.set(kw, { position: pos, url: page });
        }
      }
    }

    return keywords.map((keyword) => {
      const match = bestByKeyword.get(keyword) ?? bestByKeyword.get(keyword.toLowerCase());
      return {
        keyword,
        position: match ? Math.round(match.position) : null,
        url: match ? match.url : null,
      };
    });
  }
}
