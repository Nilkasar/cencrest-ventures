-- BeBest platform — CHECK constraints for Epic 14 (Measurement & Learning
-- Loop).
--
-- Not applied automatically — same caveat as every prior migration folder:
-- this package never connects to a database. Run this (after every earlier
-- epic folder's, in numeric order, alongside the real `prisma migrate
-- deploy`) against your own database once you have a real DATABASE_URL.

BEGIN;

-- actions.before_score / .before_score_captured_at — set together or not
-- at all, same all-or-nothing discipline `chk_actions_approval_fields_
-- together` (0016) already establishes for approved_by/approved_at. This
-- is the DB-level mirror of `POST /actions/:id/approve`'s own guarantee:
-- there is no code path that writes one without the other (see
-- routes/action-details.ts).
ALTER TABLE actions ADD CONSTRAINT chk_actions_before_score_together
  CHECK ((before_score IS NULL) = (before_score_captured_at IS NULL));

COMMIT;
