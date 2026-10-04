"use client";

import type { ReactNode } from "react";
import { Label, cn } from "@bebest/ui";
import { Section } from "./section";

/**
 * Settings-style forms: a `FormSection` card per topic, holding
 * `FormRow`s — label + description on the left, control on the right
 * (stacked on mobile) — with the save action in the card's footer.
 */
export function FormSection({
  title,
  description,
  actions,
  footer,
  children,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /** Save/Cancel — primary rightmost. */
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Section title={title} description={description} actions={actions} footer={footer} flush className={className}>
      <div className="divide-y divide-border px-5">{children}</div>
    </Section>
  );
}

export function FormRow({
  label,
  htmlFor,
  description,
  error,
  required = false,
  children,
  className,
}: {
  label: string;
  /** The control's id, so the label is a real `<label for>`. */
  htmlFor?: string;
  description?: ReactNode;
  /** Validation message — announced, and shown under the control. */
  error?: string;
  required?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("grid grid-cols-1 gap-2.5 py-4 sm:grid-cols-[minmax(0,240px)_minmax(0,1fr)] sm:gap-8", className)}>
      <div className="flex flex-col gap-1 sm:pt-2">
        <Label htmlFor={htmlFor}>
          {label}
          {required && (
            <span className="ml-0.5 text-danger" aria-hidden="true">
              *
            </span>
          )}
        </Label>
        {description && <p className="text-[12px] leading-relaxed text-muted-foreground">{description}</p>}
      </div>
      <div className="flex min-w-0 max-w-[480px] flex-col gap-1.5">
        {children}
        {error && (
          <p role="alert" className="text-[12px] text-danger">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
