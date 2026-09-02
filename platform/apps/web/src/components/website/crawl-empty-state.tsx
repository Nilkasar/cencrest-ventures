import { Globe } from "lucide-react";
import { Button, EmptyState } from "@bebest/ui";

/**
 * Before the first crawl. Per the epic's UI surface note: "explain what
 * will happen and let the user trigger it manually (don't force a wait for
 * a scheduled trigger)" — so this names the real limits (depth, page cap,
 * robots.txt, rate limit) rather than a vague "we'll analyze your site,"
 * and the button is a real trigger, not a "join the waitlist" stub.
 */
export function CrawlEmptyState({ websiteUrl, starting, onStart }: { websiteUrl: string; starting: boolean; onStart: () => void }) {
  return (
    <EmptyState
      icon={<Globe size={20} />}
      eyebrow="Website Intelligence"
      title="No crawl has run yet"
      description={`We'll crawl ${websiteUrl} — up to 3 levels deep and 500 pages, respecting robots.txt and rate-limited to 2 requests/second. It runs in the background and can take several minutes; you're free to leave this page and come back once it's done.`}
      action={
        <Button variant="primary" size="sm" loading={starting} onClick={onStart}>
          Start a crawl
        </Button>
      }
    />
  );
}
