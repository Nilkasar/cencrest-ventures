"use client";

import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { Search, X } from "lucide-react";
import {
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  cn,
} from "@bebest/ui";
import { Reveal } from "./motion";

/**
 * The bar above a list/board: search, then filters, then (pushed right)
 * the result count, a view toggle and the list's "New …" action.
 * Every control is 36px tall so the row reads as one line.
 */
export function Toolbar({ children, end, className }: { children?: ReactNode; end?: ReactNode; className?: string }) {
  return (
    <Reveal>
      <div className={cn("flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center", className)}>
        {children}
        {end && <div className="flex flex-wrap items-center gap-2 sm:ml-auto">{end}</div>}
      </div>
    </Reveal>
  );
}

export function ToolbarSearch({
  value,
  onChange,
  placeholder = "Search",
  label,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Accessible name, e.g. "Search leads". */
  label: string;
  className?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className={cn("relative w-full sm:w-64", className)}>
      <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-subtle-foreground" aria-hidden="true" />
      <Input
        ref={ref}
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && value) {
            event.preventDefault();
            onChange("");
          }
        }}
        placeholder={placeholder}
        aria-label={label}
        className="pl-8 pr-8 [&::-webkit-search-cancel-button]:hidden"
      />
      {value && (
        <button
          type="button"
          onClick={() => {
            onChange("");
            ref.current?.focus();
          }}
          className="absolute right-1.5 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded text-subtle-foreground transition-colors hover:bg-surface hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Clear search"
        >
          <X size={13} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

export interface FilterOption<T extends string> {
  value: T;
  label: string;
}

/** A single-choice filter. The first option should be the "All …" reset. */
export function FilterSelect<T extends string>({
  value,
  onValueChange,
  options,
  label,
  className,
}: {
  value: T;
  onValueChange: (value: T) => void;
  options: FilterOption<T>[];
  /** Accessible name, e.g. "Filter by status". */
  label: string;
  className?: string;
}) {
  return (
    <Select value={value} onValueChange={(next) => onValueChange(next as T)}>
      <SelectTrigger className={cn("w-full sm:w-40", className)} aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((opt) => (
          <SelectItem key={opt.value} value={opt.value}>
            {opt.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Shown only while a filter or search is active. */
export function ClearFiltersButton({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="ghost" size="sm" onClick={onClick} className="h-9">
      <X size={14} aria-hidden="true" /> Clear
    </Button>
  );
}

/** "48 leads" — the server's total, announced politely as filters change. */
export function ResultCount({ count, noun, pluralNoun }: { count: number; noun: string; pluralNoun?: string }) {
  return (
    <p className="text-[12.5px] tabular-nums text-muted-foreground" aria-live="polite">
      <span className="font-medium text-foreground">{count.toLocaleString("en-US")}</span>{" "}
      {count === 1 ? noun : (pluralNoun ?? `${noun}s`)}
    </p>
  );
}

export interface ViewOption<T extends string> {
  value: T;
  label: string;
  icon: ReactNode;
}

/**
 * Icon segmented control for switching how the same data is shown (table /
 * board / cards). A real radio group: arrow keys move the selection.
 */
export function ViewToggle<T extends string>({
  value,
  onChange,
  options,
  label = "View",
}: {
  value: T;
  onChange: (value: T) => void;
  options: ViewOption<T>[];
  label?: string;
}) {
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    const index = options.findIndex((o) => o.value === value);
    const step = event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1;
    const next = options[(index + step + options.length) % options.length]!;
    onChange(next.value);
    const buttons = event.currentTarget.querySelectorAll<HTMLButtonElement>("[role=radio]");
    buttons[(index + step + options.length) % options.length]?.focus();
  }

  return (
    <div role="radiogroup" aria-label={label} onKeyDown={onKeyDown} className="inline-flex h-9 items-center gap-0.5 rounded-lg bg-surface p-1 shadow-xs">
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            title={opt.label}
            onClick={() => onChange(opt.value)}
            className={cn(
              "flex h-7 items-center gap-1.5 rounded-md px-2 text-[12.5px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              active ? "border border-border bg-surface-raised text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <span aria-hidden="true">{opt.icon}</span>
            <span className="sr-only sm:not-sr-only">{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}
