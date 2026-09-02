import type { ReactNode } from "react";
import { cn } from "@bebest/ui";

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  className,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-4 pb-6 mb-6 border-b border-border sm:flex-row sm:items-end sm:justify-between", className)}>
      <div className="flex flex-col gap-1.5">
        {eyebrow && (
          <p className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-subtle-foreground">
            {eyebrow}
          </p>
        )}
        <h1 className="font-display text-[26px] font-semibold text-foreground tracking-[-0.015em]">{title}</h1>
        {description && <p className="text-[13.5px] text-muted-foreground max-w-[60ch] leading-relaxed">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}
