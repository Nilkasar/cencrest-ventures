import type { BrandProfile, CurrentUser, Organization } from "./types";

/**
 * Fixture data — shape-only, never persisted, never fetched. Stands in for
 * `apiClient` responses until the real endpoints exist (Epic 0 backend,
 * then Epic 1+). Every screen that reads from here is a placeholder by
 * design; see platform/docs/epics/00-platform-foundation-frontend.md.
 */

export const currentUser: CurrentUser = {
  id: "usr_fixture_1",
  name: "Jordan Ellis",
  email: "jordan@northwind.example",
  role: "owner",
};

export const organizations: Organization[] = [
  { id: "org_fixture_1", name: "Northwind Logistics", slug: "northwind", plan: "growth" },
  { id: "org_fixture_2", name: "Cascade Fintech", slug: "cascade", plan: "pro" },
];

export const currentOrganization: Organization = organizations[0]!;

/**
 * Seed for `src/lib/onboarding-client.ts`'s localStorage-backed mock store —
 * written once, the first time `getBrandProfile()` is called for an
 * organization with nothing saved yet, then never referenced again (the
 * store owns the row from there). Deliberately left `in_progress` (brand
 * basics + competitors done, industry/use cases/claims not) rather than
 * either empty or fully complete, so both the wizard's "resume where you
 * left off" behavior and Settings > Brand profile's "profile in progress"
 * state are visible on first run without any manual setup.
 */
export function buildBrandProfileSeed(organizationId: string): BrandProfile {
  const now = new Date().toISOString();
  return {
    organizationId,
    status: "in_progress",
    completedSteps: {
      "brand-basics": true,
      competitors: true,
      industry: false,
      "use-cases": false,
      claims: false,
    },
    brand: {
      id: "brand_fixture_1",
      organizationId,
      name: "Northwind Logistics",
      websiteUrl: "https://northwindlogistics.example",
      description:
        "Northwind Logistics runs mid-market freight and warehousing operations across North America, with a focus on real-time shipment visibility for manufacturers.",
      industries: [],
      categories: [],
      markets: [],
      aliases: ["Northwind", "Northwind Freight"],
      positioning: "The freight partner that tells you where your shipment is before you have to ask.",
      differentiators: ["Real-time GPS tracking on 100% of loads", "48-state warehousing network"],
      createdAt: now,
      updatedAt: now,
    },
    competitors: [
      {
        id: "comp_fixture_1",
        brandId: "brand_fixture_1",
        name: "Meridian Freight Co.",
        websiteUrl: "https://meridianfreight.example",
        priority: 1,
        aliases: ["Meridian"],
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "comp_fixture_2",
        brandId: "brand_fixture_1",
        name: "Cascadia Shipping",
        websiteUrl: "https://cascadiashipping.example",
        priority: 2,
        aliases: [],
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "comp_fixture_3",
        brandId: "brand_fixture_1",
        name: "Ironclad Logistics",
        websiteUrl: "https://ironcladlogistics.example",
        priority: 3,
        aliases: [],
        createdAt: now,
        updatedAt: now,
      },
    ],
    useCases: [],
    brandClaims: [],
  };
}
