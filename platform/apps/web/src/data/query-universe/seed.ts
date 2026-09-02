/**
 * The brand-profile inputs the template generator runs against — per the
 * epic spec, generation is seeded from Epic 2's `categories`, `use_cases`,
 * and `competitors`. This is a self-contained fixture (themed to match
 * `currentOrganization` — "Northwind Logistics" — from `data/fixtures.ts`,
 * and deliberately the same "freight visibility software" category
 * `docs/10-seo/SEO_ENGINE.md`'s own Intent Graph example uses) rather than
 * a live read of Epic 2's brand profile: this epic's hard constraint is "no
 * live backend," and Epic 2's `onboarding-client.ts` now calls the real
 * `apiClient` — depending on it here would make this screen's fixtures only
 * as good as another epic's backend being up. `client.ts` documents the
 * one-line swap to a real `GET /brands/:id` + `POST /brands/:id/query-sets/
 * generate` once Epic 5's backend exists.
 */

export interface SeedUseCase {
  id: string;
  industry: string;
  companySize: string;
  /** The pain point a "Problem" query is framed around. */
  painPoint: string;
  /** The specific job-to-be-done an "Intent" query is framed around —
   *  deliberately distinct from `painPoint`: GEO_ENGINE.md lists Problem and
   *  Intent as separate categories (a generic pain vs. a specific task). */
  jobToBeDone: string;
}

export interface GenerationSeed {
  brandName: string;
  /** A brand can span more than one category — every category-scoped
   *  template runs once per entry. */
  categories: string[];
  competitors: string[];
  features: string[];
  geographies: string[];
  useCases: SeedUseCase[];
}

export const NORTHWIND_GENERATION_SEED: GenerationSeed = {
  brandName: "Northwind Logistics",
  categories: ["freight visibility software", "supply chain visibility platform"],
  competitors: ["Acme TMS", "FreightIQ", "Convoy Metrics", "ShipSight"],
  features: [
    "real-time GPS tracking",
    "predictive ETA",
    "carrier scorecards",
    "automated exception alerts",
    "temperature monitoring",
    "EDI/API integrations",
  ],
  geographies: ["North America", "Europe", "APAC"],
  useCases: [
    {
      id: "uc_retail",
      industry: "Retail & E-commerce",
      companySize: "mid-market",
      painPoint: "inconsistent carrier ETAs during peak season",
      jobToBeDone: "track shipments in real time across every carrier",
    },
    {
      id: "uc_manufacturing",
      industry: "Manufacturing",
      companySize: "enterprise",
      painPoint: "long dock-to-stock cycle times",
      jobToBeDone: "reduce dock-to-stock cycle time",
    },
    {
      id: "uc_food",
      industry: "Food & Beverage",
      companySize: "smb",
      painPoint: "temperature excursions on cold-chain freight",
      jobToBeDone: "prevent temperature-sensitive spoilage in transit",
    },
    {
      id: "uc_3pl",
      industry: "Third-Party Logistics",
      companySize: "mid-market",
      painPoint: "customers asking \"where's my shipment\" by phone",
      jobToBeDone: "give customers self-serve shipment visibility",
    },
  ],
};
