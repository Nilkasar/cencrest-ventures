import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Card, Skeleton, cn } from "@bebest/ui";

/**
 * The Overview screen's one visual primitive — every tile (AI Visibility,
 * SEO Health, Opportunities, Next Action) is `<StatTile>` wrapping its own
 * content. Composes the real `Card` from `@bebest/ui` rather than
 * hand-rolling a new bordered box (per this codebase's "consistent design
 * system over one-off styling" rule) and reuses the exact hover/focus
 * treatment `score-panel.tsx`'s clickable component cards already
 * establish (`hover:border-accent` + a visible focus ring), so a tile reads
 * as "this whole card is one interactive destination" the same way that
 * screen's drill-down cards do.
 *
 * The entire tile is the link — not a small "View" affix — so the click
 * target comfortably clears the 44px hit-area minimum on every breakpoint,
 * and keyboard/focus-visible users get the same ring every other
 * interactive element in this app uses (`focus-visible:ring-ring`).
 */
export function StatTile({
  href,
  eyebrow,
  icon,
  children,
  className,
}: {
  href: string;
  eyebrow: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className="group block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      <Card
        className={cn(
          "h-full min-h-[164px] p-5 flex flex-col gap-3 transition-colors duration-150 group-hover:border-accent group-hover:bg-accent-muted/15",
          className,
        )}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            {icon && (
              <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-surface text-muted-foreground group-hover:text-accent transition-colors">
                {icon}
              </span>
            )}
            <p className="font-mono text-[10.5px] font-medium uppercase tracking-[0.1em] text-subtle-foreground truncate">
              {eyebrow}
            </p>
          </div>
          <ChevronRight
            size={14}
            className="text-subtle-foreground group-hover:text-accent group-hover:translate-x-0.5 transition-all shrink-0"
            aria-hidden="true"
          />
        </div>
        <div className="flex-1 flex flex-col justify-center">{children}</div>
      </Card>
    </Link>
  );
}

/** Loading placeholder matching `StatTile`'s own footprint, so the grid
 *  doesn't reflow once real content lands. */
export function StatTileSkeleton() {
  return (
    <Card className="h-full min-h-[164px] p-5 flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Skeleton className="size-6 rounded-md" />
        <Skeleton className="h-2.5 w-20" />
      </div>
      <Skeleton className="h-9 w-24" />
      <Skeleton className="h-3 w-32" />
    </Card>
  );
}
