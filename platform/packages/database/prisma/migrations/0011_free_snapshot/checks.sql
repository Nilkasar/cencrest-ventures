-- BeBest platform — CHECK constraints for Epic 17 (Free AI + SEO Growth
-- Snapshot).
--
-- `snapshot_requests.token_hash` is the public lookup key for
-- `GET /snapshot/:token` (see docs/epics/17-free-snapshot-backend.md) — a
-- SHA-256 hex digest of the opaque token handed to the requester once, same
-- shape as `magic_link_tokens.token_hash`/`refresh_tokens.token_hash`.
-- `@unique` in schema.prisma already gets Prisma to emit the UNIQUE index;
-- this CHECK is the one piece Prisma's schema language cannot express
-- itself (a regex shape constraint) — belt-and-suspenders against a bug
-- that ever stored something other than a real digest (e.g. the raw token,
-- or an empty string) here.
--
-- Not applied automatically — same caveat as every other migration folder
-- in this package: `prisma validate`/`generate` only, no live database.

BEGIN;

ALTER TABLE snapshot_requests ADD CONSTRAINT chk_snapshot_requests_token_hash
  CHECK (token_hash ~ '^[0-9a-f]{64}$');

COMMIT;
