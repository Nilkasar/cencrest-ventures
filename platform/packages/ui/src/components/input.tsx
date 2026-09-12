import * as React from "react";
import { cn } from "../lib/utils";
import { Label } from "./label";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  description?: string;
  error?: string;
  containerClassName?: string;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, containerClassName, label, description, error, id, ...props },
  ref,
) {
  const generatedId = React.useId();
  const inputId = id ?? generatedId;
  const descriptionId = description ? `${inputId}-description` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;

  return (
    <div className={cn("flex flex-col gap-1.5", containerClassName)}>
      {label && <Label htmlFor={inputId}>{label}</Label>}
      <input
        ref={ref}
        id={inputId}
        className={cn(
          "h-9 w-full rounded-md border border-border bg-surface-raised px-3 text-[13.5px] text-foreground",
          "placeholder:text-subtle-foreground",
          "transition-colors duration-150",
          "hover:border-border-strong",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:border-transparent",
          "disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-surface",
          error && "border-danger focus-visible:ring-danger",
          className,
        )}
        aria-invalid={!!error || undefined}
        aria-describedby={cn(descriptionId, errorId) || undefined}
        {...props}
      />
      {description && !error && (
        <p id={descriptionId} className="text-[12px] text-muted-foreground">
          {description}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-[12px] text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
});
