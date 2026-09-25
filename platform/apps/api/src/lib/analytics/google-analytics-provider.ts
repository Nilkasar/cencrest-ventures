/**
 * Real Google Analytics 4 data provider. Calls the GA4 Data API
 * (`analyticsdata.properties.runReport`) to retrieve traffic stats for the
 * connected property, and `analyticsadmin.properties.list` to enumerate
 * properties the token owner can access (used during the OAuth callback to
 * auto-select a property).
 */
import { google } from 'googleapis';

export interface GA4Stats {
  summary: {
    sessions: number;
    users: number;
    newUsers: number;
    engagementRate: number;
    avgSessionDurationSecs: number;
    bounceRate: number;
    pageViews: number;
  };
  topPages: { page: string; pageViews: number; sessions: number; engagementRate: number }[];
  topChannels: { channel: string; sessions: number; users: number }[];
  trend: { date: string; sessions: number; users: number; pageViews: number }[];
}

function makeAuth(accessToken: string) {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  return auth;
}

function n(value: string | null | undefined): number {
  if (value == null) return 0;
  const parsed = parseFloat(value);
  return isNaN(parsed) ? 0 : parsed;
}

function metricValue(row: { metricValues?: { value?: string | null }[] | null }, index: number): number {
  return n(row.metricValues?.[index]?.value);
}

function dimValue(row: { dimensionValues?: { value?: string | null }[] | null }, index: number): string {
  return row.dimensionValues?.[index]?.value ?? '';
}

export class GoogleAnalyticsProvider {
  private readonly accessToken: string;
  private readonly propertyId: string;

  constructor(accessToken: string, propertyId: string) {
    this.accessToken = accessToken;
    this.propertyId = propertyId;
  }

  async getStats(days: number): Promise<GA4Stats> {
    const auth = makeAuth(this.accessToken);
    const analyticsData = google.analyticsdata({ version: 'v1beta', auth });
    const property = `properties/${this.propertyId}`;
    const dateRange = { startDate: `${days}daysAgo`, endDate: 'today' };

    const [summaryRes, topPagesRes, topChannelsRes, trendRes] = await Promise.all([
      analyticsData.properties.runReport({
        property,
        requestBody: {
          dateRanges: [dateRange],
          metrics: [
            { name: 'sessions' },
            { name: 'totalUsers' },
            { name: 'newUsers' },
            { name: 'engagementRate' },
            { name: 'averageSessionDuration' },
            { name: 'bounceRate' },
            { name: 'screenPageViews' },
          ],
        },
      }),
      analyticsData.properties.runReport({
        property,
        requestBody: {
          dateRanges: [dateRange],
          dimensions: [{ name: 'pagePath' }],
          metrics: [{ name: 'screenPageViews' }, { name: 'sessions' }, { name: 'engagementRate' }],
          orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
          limit: '25',
        },
      }),
      analyticsData.properties.runReport({
        property,
        requestBody: {
          dateRanges: [dateRange],
          dimensions: [{ name: 'sessionDefaultChannelGrouping' }],
          metrics: [{ name: 'sessions' }, { name: 'totalUsers' }],
          orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
          limit: '10',
        },
      }),
      analyticsData.properties.runReport({
        property,
        requestBody: {
          dateRanges: [dateRange],
          dimensions: [{ name: 'date' }],
          metrics: [{ name: 'sessions' }, { name: 'totalUsers' }, { name: 'screenPageViews' }],
          orderBys: [{ dimension: { dimensionName: 'date' } }],
        },
      }),
    ]);

    const summaryRow = summaryRes.data.rows?.[0];
    const summary = summaryRow
      ? {
          sessions: Math.round(metricValue(summaryRow, 0)),
          users: Math.round(metricValue(summaryRow, 1)),
          newUsers: Math.round(metricValue(summaryRow, 2)),
          engagementRate: metricValue(summaryRow, 3),
          avgSessionDurationSecs: metricValue(summaryRow, 4),
          bounceRate: metricValue(summaryRow, 5),
          pageViews: Math.round(metricValue(summaryRow, 6)),
        }
      : { sessions: 0, users: 0, newUsers: 0, engagementRate: 0, avgSessionDurationSecs: 0, bounceRate: 0, pageViews: 0 };

    const topPages = (topPagesRes.data.rows ?? []).map((row) => ({
      page: dimValue(row, 0),
      pageViews: Math.round(metricValue(row, 0)),
      sessions: Math.round(metricValue(row, 1)),
      engagementRate: metricValue(row, 2),
    }));

    const topChannels = (topChannelsRes.data.rows ?? []).map((row) => ({
      channel: dimValue(row, 0),
      sessions: Math.round(metricValue(row, 0)),
      users: Math.round(metricValue(row, 1)),
    }));

    const trend = (trendRes.data.rows ?? []).map((row) => {
      const raw = dimValue(row, 0);
      const date = raw.length === 8 ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}` : raw;
      return {
        date,
        sessions: Math.round(metricValue(row, 0)),
        users: Math.round(metricValue(row, 1)),
        pageViews: Math.round(metricValue(row, 2)),
      };
    });

    return { summary, topPages, topChannels, trend };
  }
}

export async function listGA4Properties(
  accessToken: string,
): Promise<{ propertyId: string; displayName: string }[]> {
  const auth = makeAuth(accessToken);
  const admin = google.analyticsadmin({ version: 'v1beta', auth });
  const res = await admin.properties.list({ filter: 'parent:accounts/-' });
  return (res.data.properties ?? []).map((p) => ({
    propertyId: (p.name ?? '').replace('properties/', ''),
    displayName: p.displayName ?? '',
  }));
}
