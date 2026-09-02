"use client";

import { useToast, Button, type ButtonProps } from "@bebest/ui";

/**
 * A call-to-action that is honest about being unwired: it fires the real
 * Toast primitive with a real explanation instead of silently doing
 * nothing or navigating somewhere fake. Used across the Epic 0 placeholder
 * screens wherever CUSTOMER_JOURNEY.md's empty-state contract calls for an
 * action to be "reachable" even though there's nothing behind it yet.
 */
export function StubActionButton({
  label,
  message,
  variant = "secondary",
  size = "sm",
}: {
  label: string;
  message: string;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
}) {
  const { toast } = useToast();
  return (
    <Button
      variant={variant}
      size={size}
      onClick={() => toast({ title: "Not wired up yet", description: message, variant: "default" })}
    >
      {label}
    </Button>
  );
}
