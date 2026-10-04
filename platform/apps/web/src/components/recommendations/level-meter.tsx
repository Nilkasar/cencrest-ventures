import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@bebest/ui";
import type { RecommendationLevel } from "@/data/recommendations/types";
import { LEVEL_LABEL } from "@/data/recommendations/labels";

const FILLED: Record<RecommendationLevel, number> = { low: 1, medium: 2, high: 3 };

/**
 * A three-step low/medium/high readout ("Impact ▮▮▯ Medium"). Reads faster
 * than two colored badges side by side, and keeps status colors for
 * statuses: the bars are neutral ink, the word carries the meaning, so it
 * never relies on color alone.
 */
export function LevelMeter({ label, level }: { label: string; level: RecommendationLevel }) {
  const filled = FILLED[level];
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground">
      <span>{label}</span>
      <span className="inline-flex items-end gap-[2px]" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className={cn("w-[3px] rounded-full", i < filled ? "bg-foreground/70" : "bg-border-strong/60")}
            style={{ height: 6 + i * 3 }}
          />
        ))}
      </span>
      <span className="font-medium text-foreground">{LEVEL_LABEL[level]}</span>
    </span>
  );
}

/** Inline disclosure toggle ("Implementation brief ▾") used on the
 *  recommendation, brief and action rows — a real button with
 *  `aria-expanded`, 32px tall for touch. */
export function DisclosureButton({
  expanded,
  onClick,
  children,
  controls,
}: {
  expanded: boolean;
  onClick: () => void;
  children: ReactNode;
  controls?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={expanded}
      aria-controls={controls}
      className="-ml-1.5 inline-flex h-8 items-center gap-1 rounded-md px-1.5 text-[12.5px] font-medium text-muted-foreground transition-colors hover:bg-surface hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <ChevronDown
        size={14}
        aria-hidden="true"
        className={cn("transition-transform duration-200 motion-reduce:transition-none", expanded ? "rotate-0" : "-rotate-90")}
      />
      {children}
    </button>
  );
}

/** The dual SEO + GEO requirement every recommendation and brief carries,
 *  as two labelled columns. */
export function RequirementsGrid({ seo, geo }: { seo: string; geo: string }) {
  return (
    <div className="grid gap-4 rounded-lg border border-border bg-surface/60 p-4 sm:grid-cols-2">
      <div className="min-w-0">
        <p className="mb-1.5 font-mono text-[10.5px] font-medium uppercase tracking-[0.12em] text-subtle-foreground">SEO requirements</p>
        <p className="text-[13px] leading-relaxed text-foreground">{seo}</p>
      </div>
      <div className="min-w-0 sm:border-l sm:border-border sm:pl-4">
        <p className="mb-1.5 font-mono text-[10.5px] font-medium uppercase tracking-[0.12em] text-subtle-foreground">GEO requirements</p>
        <p className="text-[13px] leading-relaxed text-foreground">{geo}</p>
      </div>
    </div>
  );
}
