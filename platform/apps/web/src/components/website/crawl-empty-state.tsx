import { Globe } from "lucide-react";
import { Button, EmptyState } from "@bebest/ui";

/**
 * Before the first crawl. Names the real limits (depth, page cap,
 * robots.txt, rate limit) rather than a vague "we'll analyze your site,"
 * and the button is a real trigger — the user never waits on a schedule.
 */
export function CrawlEmptyState({ websiteUrl, starting, onStart }: { websiteUrl: string; starting: boolean; onStart: () => void }) {
  return (
    <EmptyState
      icon={<Globe size={20} />}
      title="Your site hasn't been crawled yet"
      description={`We'll read ${websiteUrl} the way search and AI crawlers do — up to 3 levels deep and 500 pages, respecting robots.txt at 2 requests a second. It runs in the background for several minutes, so you can leave and come back.`}
      action={
        <Button variant="primary" size="sm" loading={starting} onClick={onStart}>
          <Globe size={14} aria-hidden="true" /> Start a crawl
        </Button>
      }
    />
  );
}
