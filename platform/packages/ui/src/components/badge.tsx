import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full border font-sans font-medium leading-none whitespace-nowrap",
  {
    variants: {
      variant: {
        neutral: "bg-surface text-muted-foreground border-border",
        accent: "bg-accent-muted text-accent border-transparent",
        success: "bg-success-muted text-success border-transparent",
        warning: "bg-warning-muted text-warning border-transparent",
        danger: "bg-danger-muted text-danger border-transparent",
        outline: "bg-transparent text-foreground border-border-strong",
      },
      size: {
        sm: "h-5 px-2 text-[10.5px] tracking-[0.01em]",
        md: "h-6 px-2.5 text-[11.5px] tracking-[0.01em]",
      },
    },
    defaultVariants: { variant: "neutral", size: "md" },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {
  dot?: boolean;
}

export function Badge({ className, variant, size, dot = false, children, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant, size, className }))} {...props}>
      {dot && <span aria-hidden className="size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}
