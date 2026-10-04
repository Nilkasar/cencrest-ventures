"use client";

import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cn } from "../lib/utils";

export const Tabs = TabsPrimitive.Root;

export interface TabsListProps extends React.ComponentPropsWithoutRef<typeof TabsPrimitive.List> {
  /** `segmented` (default): a pill switch for toggling views inside a
   *  panel. `underline`: page-level section tabs — a full-width rule with
   *  the active tab underlined in accent (Linear/Stripe style). */
  variant?: "segmented" | "underline";
}

export const TabsList = React.forwardRef<React.ElementRef<typeof TabsPrimitive.List>, TabsListProps>(function TabsList(
  { className, variant = "segmented", ...props },
  ref,
) {
  return (
    <TabsPrimitive.List
      ref={ref}
      data-variant={variant}
      className={cn(
        "group/tabs",
        variant === "segmented" && "inline-flex items-center gap-1 rounded-lg bg-surface p-1 shadow-xs",
        variant === "underline" &&
          "flex items-end gap-5 overflow-x-auto border-b border-border [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        className,
      )}
      {...props}
    />
  );
});

export const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(function TabsTrigger({ className, ...props }, ref) {
  return (
    <TabsPrimitive.Trigger
      ref={ref}
      className={cn(
        "inline-flex items-center justify-center rounded-md px-3 h-7 text-[12.5px] font-medium text-muted-foreground whitespace-nowrap",
        "transition-colors duration-150",
        "hover:text-foreground",
        "group-data-[variant=segmented]/tabs:data-[state=active]:bg-surface-raised group-data-[variant=segmented]/tabs:data-[state=active]:text-foreground group-data-[variant=segmented]/tabs:data-[state=active]:shadow-sm group-data-[variant=segmented]/tabs:data-[state=active]:border group-data-[variant=segmented]/tabs:data-[state=active]:border-border",
        // Underline: 40px row (44px hit area with the rule), accent bar on the active tab.
        "group-data-[variant=underline]/tabs:relative group-data-[variant=underline]/tabs:h-10 group-data-[variant=underline]/tabs:rounded-none group-data-[variant=underline]/tabs:px-0.5 group-data-[variant=underline]/tabs:text-[13px] group-data-[variant=underline]/tabs:focus-visible:ring-inset",
        "group-data-[variant=underline]/tabs:after:absolute group-data-[variant=underline]/tabs:after:inset-x-0 group-data-[variant=underline]/tabs:after:-bottom-px group-data-[variant=underline]/tabs:after:h-0.5 group-data-[variant=underline]/tabs:after:rounded-full group-data-[variant=underline]/tabs:after:bg-transparent group-data-[variant=underline]/tabs:after:transition-colors",
        "group-data-[variant=underline]/tabs:data-[state=active]:text-foreground group-data-[variant=underline]/tabs:data-[state=active]:after:bg-accent",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "disabled:opacity-40 disabled:pointer-events-none",
        className,
      )}
      {...props}
    />
  );
});

export const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(function TabsContent({ className, ...props }, ref) {
  return (
    <TabsPrimitive.Content
      ref={ref}
      className={cn("mt-4 focus-visible:outline-none", className)}
      {...props}
    />
  );
});
