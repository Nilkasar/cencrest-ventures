"use client";

import { Label, cn } from "@bebest/ui";

interface PillOption {
  value: string;
  label: string;
}

interface PillMultiSelectProps {
  label: string;
  description?: string;
  options: readonly PillOption[];
  value: string[];
  onChange: (next: string[]) => void;
  error?: string;
}

/** Toggleable pill group for small, fixed option sets (company sizes,
 *  and similar) — @bebest/ui has no checkbox-group primitive yet, and a
 *  handful of mutually-independent toggles reads better as pills than as
 *  a list of checkboxes in a form this compact. */
export function PillMultiSelect({ label, description, options, value, onChange, error }: PillMultiSelectProps) {
  function toggle(optionValue: string) {
    onChange(value.includes(optionValue) ? value.filter((v) => v !== optionValue) : [...value, optionValue]);
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      <div className="flex flex-wrap gap-2" role="group" aria-label={label}>
        {options.map((option) => {
          const selected = value.includes(option.value);
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={selected}
              onClick={() => toggle(option.value)}
              className={cn(
                "rounded-full border px-3 py-1.5 text-[12.5px] font-medium transition-colors duration-150",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                selected
                  ? "border-accent bg-accent-muted text-accent"
                  : "border-border bg-surface-raised text-muted-foreground hover:border-border-strong hover:text-foreground",
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>
      {description && !error && <p className="text-[12px] text-muted-foreground">{description}</p>}
      {error && (
        <p role="alert" className="text-[12px] text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
