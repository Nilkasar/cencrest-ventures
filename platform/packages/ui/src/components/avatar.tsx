"use client";

import * as React from "react";
import * as AvatarPrimitive from "@radix-ui/react-avatar";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/utils";

const avatarVariants = cva(
  "relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-accent-muted text-accent border border-border select-none",
  {
    variants: {
      size: {
        sm: "size-7 text-[11px]",
        md: "size-9 text-[12.5px]",
        lg: "size-12 text-[15px]",
      },
    },
    defaultVariants: { size: "md" },
  },
);

export interface AvatarProps extends VariantProps<typeof avatarVariants> {
  src?: string;
  alt?: string;
  /** Initials or short label shown when there's no image. */
  fallback: string;
  className?: string;
}

export function Avatar({ src, alt, fallback, size, className }: AvatarProps) {
  return (
    <AvatarPrimitive.Root className={cn(avatarVariants({ size, className }))}>
      {src && <AvatarPrimitive.Image src={src} alt={alt ?? ""} className="size-full object-cover" />}
      <AvatarPrimitive.Fallback delayMs={src ? 400 : 0} className="font-sans font-semibold leading-none">
        {fallback}
      </AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  );
}
