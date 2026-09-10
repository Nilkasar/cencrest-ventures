-- 0022 — `agency_clients` becomes visible to BOTH parties of the link.
--
-- THE BUG
--
-- The policy named only the agency side (`agency_org_id = app.current_org`).
-- The client side of every flow — seeing an incoming invitation, accepting
-- it, revoking an agency's access — was implemented against the un-scoped
-- client with an explicit `client_org_id = ...` WHERE, and documented as
-- deliberate: "RLS on this table scopes visibility to the agency side ONLY
-- ... the row's own id IS the access control for this path", citing
-- `routes/orgs.ts`'s invitation-accept flow as precedent.
--
-- The precedent does not transfer. `invitations` has **no RLS at all**
-- (0000_init/rls.sql lists it as one of the deliberate exemptions), so a
-- plain query against it really is unfiltered. `agency_clients` HAS RLS,
-- and the un-scoped client is not exempt from it — it is simply a session
-- with no `app.current_org` set, which under the policy matches nothing.
--
-- So under a role that cannot bypass RLS (i.e. any correct deployment):
--   * GET  /agency/clients/incoming      -> always empty
--   * POST /agency/clients/:id/accept    -> always 404
--   * POST /agency/clients/:id/revoke    -> always 404 for the client side
--
-- The entire client half of Epic 18 — including the client's ability to
-- revoke an agency's access to its data, which that epic calls its critical
-- path — could never run. It worked only while the database role carried
-- BYPASSRLS, which is exactly the configuration `rls-check.ts` now refuses.
--
-- THE FIX
--
-- Recognise the client org as what it is: a party to its own agency
-- relationship. This is not relaxing RLS (the epic brief is explicit that it
-- must not be relaxed) — it is completing it. The previous policy left the
-- client side to an application-level WHERE with no database backing at
-- all; naming both parties means the database enforces what the code
-- intended, and the explicit `client_org_id === caller's org` checks in
-- `routes/agency.ts` remain as defense in depth rather than as the only
-- line of defence.
--
-- Both sides can still only ever reach rows they are named on: an org that
-- is neither the agency nor the client on a link sees nothing, exactly as
-- before.

BEGIN;

DROP POLICY IF EXISTS tenant_isolation ON agency_clients;

CREATE POLICY tenant_isolation ON agency_clients
  USING (
    agency_org_id = NULLIF(current_setting('app.current_org', TRUE), '')::uuid
    OR client_org_id = NULLIF(current_setting('app.current_org', TRUE), '')::uuid
  )
  WITH CHECK (
    agency_org_id = NULLIF(current_setting('app.current_org', TRUE), '')::uuid
    OR client_org_id = NULLIF(current_setting('app.current_org', TRUE), '')::uuid
  );

COMMIT;
