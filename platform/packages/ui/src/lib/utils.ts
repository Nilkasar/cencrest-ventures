import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merge Tailwind class lists, resolving conflicts left-to-right. The one
 *  utility every component in this package builds on. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** "Anurag Singh" -> "AS", "anurag.singh@bebest.com" -> "AS" (best effort). */
export function getInitials(name: string): string {
  const cleaned = name.trim();
  if (!cleaned) return "?";
  const namePart = cleaned.includes("@") ? cleaned.split("@")[0] : cleaned;
  const parts = (namePart ?? "").split(/[\s._-]+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0]}${parts[parts.length - 1]![0]}`.toUpperCase();
}
