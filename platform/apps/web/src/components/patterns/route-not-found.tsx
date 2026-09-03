import Link from "next/link";
import { Compass } from "lucide-react";
import { Button } from "@bebest/ui";

/**
 * Shared 404 body — an explicit "you're not lost, here's the way back"
 * screen instead of Next.js's bare default, for every `not-found.tsx` in
 * this app (Epic 19, UI item 1).
 */
export function RouteNotFound({
  title = "Page not found",
  description = "That page doesn't exist, or you don't have access to it.",
  homeHref,
  homeLabel = "Go back",
}: {
  title?: string;
  description?: string;
  homeHref: string;
  homeLabel?: string;
}) {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-5 px-6 py-16 text-center">
      <div
        className="flex size-12 items-center justify-center rounded-full border border-border bg-surface text-muted-foreground"
        aria-hidden="true"
      >
        <Compass size={20} />
      </div>
      <div className="flex flex-col gap-1.5">
        <h1 className="font-display text-[19px] font-semibold text-foreground">{title}</h1>
        <p className="max-w-[420px] text-[13.5px] leading-relaxed text-muted-foreground">{description}</p>
      </div>
      <Button asChild variant="primary" size="sm">
        <Link href={homeHref}>{homeLabel}</Link>
      </Button>
    </div>
  );
}
