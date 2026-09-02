"use client";

import { createContext, useContext, useMemo } from "react";
import type { BrandProfile } from "@/data/types";
import { useBrandProfile } from "@/hooks/use-brand-profile";
import { currentOrganization } from "@/data/fixtures";

interface OnboardingContextValue {
  organizationId: string;
  profile: BrandProfile | undefined;
  loading: boolean;
  error: string | undefined;
  reload: () => void;
  setProfile: (profile: BrandProfile) => void;
}

const OnboardingContext = createContext<OnboardingContextValue | null>(null);

export function OnboardingProvider({ children }: { children: React.ReactNode }) {
  const organizationId = currentOrganization.id;
  const { profile, loading, error, reload, setProfile } = useBrandProfile(organizationId);

  const value = useMemo(
    () => ({ organizationId, profile, loading, error, reload, setProfile }),
    [organizationId, profile, loading, error, reload, setProfile],
  );

  return <OnboardingContext.Provider value={value}>{children}</OnboardingContext.Provider>;
}

export function useOnboarding(): OnboardingContextValue {
  const context = useContext(OnboardingContext);
  if (!context) {
    throw new Error("useOnboarding must be used within an <OnboardingProvider>");
  }
  return context;
}
