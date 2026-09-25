export type ConnectorProvider = "google_search_console" | "google_analytics_4";

export interface ConnectorInfo {
  slug: ConnectorProvider;
  label: string;
  description: string;
  category: "seo" | "analytics";
  scopes: string[];
}

export const CONNECTORS: ConnectorInfo[] = [
  {
    slug: "google_search_console",
    label: "Google Search Console",
    description: "Search performance: impressions, clicks, CTR, and average position across your site's queries and pages.",
    category: "seo",
    scopes: ["View search analytics data", "View your site's URL inspection data"],
  },
  {
    slug: "google_analytics_4",
    label: "Google Analytics 4",
    description: "Traffic intelligence: sessions, users, engagement rate, bounce rate, and channel breakdown.",
    category: "analytics",
    scopes: ["View your Google Analytics data"],
  },
];

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
