/**
 * Standalone GSC stats fetcher — called by `GET /integrations/gsc/stats` in
 * `routes/integrations.ts`. Separate from `GoogleSearchConsoleProvider`
 * (which implements `SEODataProvider`) because the stats shape here is
 * purpose-built for the Connectors dashboard UI, not the keyword-research
 * pipeline the `SEODataProvider` interface serves.
 */
import { google } from 'googleapis';

export interface GSCStats {
  summary: {
    totalClicks: number;
    totalImpressions: number;
    avgCtr: number;
    avgPosition: number;
  };
  topPages: { page: string; clicks: number; impressions: number; ctr: number; position: number }[];
  topQueries: { query: string; clicks: number; impressions: number; ctr: number; position: number }[];
  trend: { date: string; clicks: number; impressions: number }[];
}

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

export async function getGSCStats(
  accessToken: string,
  siteUrl: string,
  days: number,
): Promise<GSCStats> {
  const auth = makeAuth(accessToken);
  const sc = google.webmasters({ version: 'v3', auth });
  const dateRange = { startDate: daysAgoISO(days), endDate: TODAY() };

  const [summaryRes, topPagesRes, topQueriesRes, trendRes] = await Promise.all([
    sc.searchanalytics.query({
      siteUrl,
      requestBody: { ...dateRange, dimensions: [] as string[], rowLimit: 1 },
    }),
    sc.searchanalytics.query({
      siteUrl,
      requestBody: { ...dateRange, dimensions: ['page'], rowLimit: 25 },
    }),
    sc.searchanalytics.query({
      siteUrl,
      requestBody: { ...dateRange, dimensions: ['query'], rowLimit: 25 },
    }),
    sc.searchanalytics.query({
      siteUrl,
      requestBody: { ...dateRange, dimensions: ['date'], rowLimit: 90 },
    }),
  ]);

  const summaryRow = summaryRes.data.rows?.[0];
  const summary = {
    totalClicks: summaryRow?.clicks ?? 0,
    totalImpressions: summaryRow?.impressions ?? 0,
    avgCtr: summaryRow?.ctr ?? 0,
    avgPosition: summaryRow?.position ?? 0,
  };

  const topPages = (topPagesRes.data.rows ?? []).map((row) => ({
    page: (row.keys ?? [])[0] ?? '',
    clicks: row.clicks ?? 0,
    impressions: row.impressions ?? 0,
    ctr: row.ctr ?? 0,
    position: row.position ?? 0,
  }));

  const topQueries = (topQueriesRes.data.rows ?? []).map((row) => ({
    query: (row.keys ?? [])[0] ?? '',
    clicks: row.clicks ?? 0,
    impressions: row.impressions ?? 0,
    ctr: row.ctr ?? 0,
    position: row.position ?? 0,
  }));

  const trend = (trendRes.data.rows ?? []).map((row) => ({
    date: (row.keys ?? [])[0] ?? '',
    clicks: row.clicks ?? 0,
    impressions: row.impressions ?? 0,
  }));

  return { summary, topPages, topQueries, trend };
}
