"use client";

import { useId, useState } from "react";
import { X } from "lucide-react";
import { Badge, Label, cn } from "@bebest/ui";

interface TagInputProps {
  label: string;
  description?: string;
  placeholder?: string;
  value: string[];
  onChange: (next: string[]) => void;
  error?: string;
  maxItems?: number;
  disabled?: boolean;
}

/**
 * Multi-value chip input — @bebest/ui has no primitive for this yet, so
 * it's composed from `Input`'s styling contract (same border/focus/error
 * treatment) plus `Badge` for committed values. Used for every array field
 * the Epic 2 wizard collects (aliases, differentiators, categories,
 * markets, industries-per-use-case, pain points).
 *
 * Enter or comma commits the current text as a tag; Backspace on an empty
 * field removes the most recent tag (standard chip-input keyboard model).
 */
export function TagInput({ label, description, placeholder, value, onChange, error, maxItems, disabled }: TagInputProps) {
  const [draft, setDraft] = useState("");
  const inputId = useId();
  const descriptionId = description ? `${inputId}-description` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;
  const atLimit = typeof maxItems === "number" && value.length >= maxItems;

  function commit(raw: string) {
    const next = raw.trim();
    if (!next) return;
    if (atLimit) return;
    if (value.some((v) => v.toLowerCase() === next.toLowerCase())) {
      setDraft("");
      return;
    }
    onChange([...value, next]);
    setDraft("");
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      commit(draft);
      return;
    }
    if (event.key === "Backspace" && draft === "" && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  }

  function remove(index: number) {
    onChange(value.filter((_, i) => i !== index));
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <Label htmlFor={inputId}>{label}</Label>
        {typeof maxItems === "number" && (
          <span className="font-mono text-[11px] text-subtle-foreground">
            {value.length}/{maxItems}
          </span>
        )}
      </div>
      <div
        className={cn(
          "flex min-h-9 w-full flex-wrap items-center gap-1.5 rounded-md border border-border bg-surface-raised px-2.5 py-1.5",
          "transition-colors duration-150",
          "focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background focus-within:border-transparent",
          error && "border-danger focus-within:ring-danger",
          disabled && "opacity-50",
        )}
      >
        {value.map((tag, index) => (
          <Badge key={tag} variant="neutral" size="sm" className="gap-1 pr-1">
            {tag}
            {!disabled && (
              <button
                type="button"
                onClick={() => remove(index)}
                className="rounded-full p-0.5 text-subtle-foreground hover:bg-surface hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={`Remove ${tag}`}
              >
                <X size={10} />
              </button>
            )}
          </Badge>
        ))}
        <input
          id={inputId}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => commit(draft)}
          placeholder={value.length === 0 ? placeholder : undefined}
          disabled={disabled || atLimit}
          aria-describedby={[descriptionId, errorId].filter(Boolean).join(" ") || undefined}
          aria-invalid={!!error || undefined}
          className="min-w-[8ch] flex-1 bg-transparent text-[13.5px] text-foreground placeholder:text-subtle-foreground focus:outline-none disabled:cursor-not-allowed"
        />
      </div>
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
}
