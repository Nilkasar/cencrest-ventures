/**
 * Epic 17 (Free AI + SEO Growth Snapshot) — the public route group.
 * Unauthenticated, unlike every other segment in this app, so it never uses
 * the authenticated app shell (`components/shell`).
 *
 * Deliberately chrome-free: the two pages here need different frames. The
 * intake screen (`/snapshot`) is a full-viewport split hero
 * (`SnapshotIntakeView`); the report (`/snapshot/:token`) is a wide,
 * scrolling document (`SnapshotReportPageView`). A shared frame here would
 * force one page's layout onto the other.
 */
export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return children;
}
