import type { CurrentUser, Organization } from "./types";

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
