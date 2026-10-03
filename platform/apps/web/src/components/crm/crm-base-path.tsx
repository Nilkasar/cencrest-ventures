"use client";

import { createContext, useContext } from "react";

/**
 * Where the CRM screens live. The same components render in two places:
 * the internal org's Organization view (`/crm/*`, the default) and the
 * Platform view's Growth area (`/platform/growth/*`, Epic 22). Every
 * in-CRM link is built from this base so navigation never jumps from one
 * view into the other.
 */
const CrmBasePathContext = createContext("/crm");

export function CrmBasePathProvider({ base, children }: { base: string; children: React.ReactNode }) {
  return <CrmBasePathContext.Provider value={base}>{children}</CrmBasePathContext.Provider>;
}

export function useCrmBasePath(): string {
  return useContext(CrmBasePathContext);
}
