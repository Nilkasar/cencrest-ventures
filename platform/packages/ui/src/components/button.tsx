"use client";

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { motion } from "framer-motion";
import { cn } from "../lib/utils";

const buttonVariants = cva(
  [
    "inline-flex items-center justify-center gap-2 whitespace-nowrap select-none",
    "font-sans font-medium tracking-[-0.01em]",
    "transition-[colors,box-shadow] duration-150 ease-out",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
    "disabled:pointer-events-none disabled:opacity-40",
  ].join(" "),
  {
    variants: {
      variant: {
        primary: cn(
          "bg-accent text-accent-foreground shadow-xs",
          "hover:bg-accent-hover hover:shadow-sm active:bg-accent-active active:shadow-xs",
        ),
        secondary: cn(
          "bg-surface-raised text-foreground border border-border shadow-xs",
          "hover:border-border-strong hover:bg-surface hover:shadow-sm",
        ),
        outline: cn(
          "bg-transparent text-foreground border border-border",
          "hover:bg-surface hover:border-border-strong",
        ),
        ghost: "bg-transparent text-muted-foreground hover:text-foreground hover:bg-surface",
        danger: "bg-danger text-ink-0 shadow-xs hover:brightness-95 active:brightness-90",
        link: "bg-transparent text-accent underline-offset-4 hover:underline p-0 h-auto",
      },
      size: {
        sm: "h-8 px-3 text-[13px] rounded-md",
        md: "h-9 px-4 text-[13px] rounded-md",
        lg: "h-11 px-5 text-[14px] rounded-lg",
        icon: "h-9 w-9 rounded-md p-0",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
  },
);

export interface ButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "children">,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
  children?: React.ReactNode;
}

function Spinner({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className={cn("size-[1em] animate-[spin_0.7s_linear_infinite]", className)}
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

const MotionButton = motion.create("button");

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, asChild = false, loading = false, disabled, children, ...props },
  ref,
) {
  if (asChild) {
    return (
      <Slot ref={ref} className={cn(buttonVariants({ variant, size, className }))} {...props}>
        {children}
      </Slot>
    );
  }

  return (
    <MotionButton
      ref={ref}
      whileTap={{ scale: 0.975 }}
      transition={{ duration: 0.12, ease: [0.4, 0, 0.2, 1] }}
      className={cn(buttonVariants({ variant, size, className }))}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...(props as React.ComponentPropsWithoutRef<typeof MotionButton>)}
    >
      {loading && <Spinner />}
      {children}
    </MotionButton>
  );
});
