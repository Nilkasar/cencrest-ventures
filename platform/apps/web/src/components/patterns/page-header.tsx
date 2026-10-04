import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { cn } from "@bebest/ui";
import { typography } from "./typography";

/**
 * The compact header every non-dashboard page opens with. The topbar
 * breadcrumb already names the page's group, so this carries only what the
 * breadcrumb can't: the title as the page's `<h1>`, one line on what the
 * page answers, and the page-level actions. See README.md "Page header".
 *
 * Server-compatible (no hooks) so a `page.tsx` can render it directly.
 */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  meta,
  tabs,
  className,
}: {
  /** @deprecated The breadcrumb names the group — don't pass this on new
   *  pages. Still rendered when given, for existing callers. */
  eyebrow?: string;
  title: string;
  /** One sentence: the question this page answers. */
  description?: ReactNode;
  /** Page-level actions, right-aligned. Primary last (rightmost). */
  actions?: ReactNode;
  /** A row of small facts under the description (last updated, counts). */
  meta?: ReactNode;
  /** Page-level tabs (`<TabsList variant="underline">` or `<LinkTabs>`). */
  tabs?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-6 flex flex-col gap-5", className)}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
        <div className="flex min-w-0 flex-col gap-1">
          {eyebrow && <p className={typography.eyebrow}>{eyebrow}</p>}
          <h1 className={typography.pageTitle}>{title}</h1>
          {description && <p className={cn(typography.secondary, "max-w-[72ch]")}>{description}</p>}
          {meta && <div className={cn(typography.meta, "mt-1 flex flex-wrap items-center gap-x-4 gap-y-1")}>{meta}</div>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2 sm:pt-0.5">{actions}</div>}
      </div>
      {tabs}
    </div>
  );
}

export interface DetailMetaItem {
  label: string;
  value: ReactNode;
  icon?: ReactNode;
}

/**
 * Header for a single entity (a lead, a deal, a report, an agent run).
 * Back link → entity title + status badges → subtitle → key facts → actions.
 * Pair with `DetailLayout` below it. See README.md "Detail page".
 */
export function DetailHeader({
  backHref,
  backLabel,
  leading,
  title,
  badges,
  subtitle,
  meta,
  actions,
  tabs,
  className,
}: {
  /** The list this entity belongs to. Omit only when there is no list. */
  backHref?: string;
  /** The list's name, e.g. "Leads". Rendered as "← Leads". */
  backLabel?: string;
  /** Avatar or icon tile left of the title (40–48px). */
  leading?: ReactNode;
  title: ReactNode;
  /** Status badges shown inline after the title. */
  badges?: ReactNode;
  /** One line under the title: company · email, type · date. */
  subtitle?: ReactNode;
  /** 2–5 key facts (owner, value, created, close date). */
  meta?: DetailMetaItem[];
  actions?: ReactNode;
  tabs?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-6 flex flex-col gap-4", className)}>
      {backHref && (
        <Link
          href={backHref}
          data-print-hide
          className="-ml-1.5 inline-flex h-7 w-fit items-center gap-1.5 rounded-md px-1.5 text-[12.5px] font-medium text-muted-foreground transition-colors hover:bg-surface hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeft size={14} aria-hidden="true" />
          {backLabel ?? "Back"}
        </Link>
      )}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
        <div className="flex min-w-0 items-start gap-3.5">
          {leading && <div className="shrink-0">{leading}</div>}
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
              <h1 className={cn(typography.pageTitle, "min-w-0 break-words")}>{title}</h1>
              {badges && <div className="flex flex-wrap items-center gap-1.5">{badges}</div>}
            </div>
            {subtitle && <p className={cn(typography.secondary, "break-words")}>{subtitle}</p>}
          </div>
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2" data-print-hide>{actions}</div>}
      </div>
      {meta && meta.length > 0 && (
        <dl className="flex flex-wrap gap-x-8 gap-y-3 border-y border-border py-3">
          {meta.map((item) => (
            <div key={item.label} className="flex min-w-0 flex-col gap-1">
              <dt className={typography.eyebrow}>{item.label}</dt>
              <dd className="flex min-w-0 items-center gap-1.5 text-[13px] font-medium text-foreground">
                {item.icon && (
                  <span className="shrink-0 text-subtle-foreground" aria-hidden="true">
                    {item.icon}
                  </span>
                )}
                <span className="truncate">{item.value}</span>
              </dd>
            </div>
          ))}
        </dl>
      )}
      {tabs}
    </div>
  );
}
