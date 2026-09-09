/**
 * Applies the whole database schema to `DATABASE_URL`.
 *
 *   pnpm --filter @bebest/database run db:apply
 *   pnpm --filter @bebest/database run db:apply -- --dry-run
 *
 * Why this exists rather than `prisma migrate deploy`: the migration
 * folders under `prisma/migrations/` contain hand-written `checks.sql` /
 * `indexes.sql` / `rls.sql` (and, from 0019, `ddl.sql`) — they contain no
 * `migration.sql`, which is the only file Prisma's own migrate command
 * looks at. `prisma migrate deploy` against this repo therefore creates
 * nothing at all: no tables, no policies. The documented go-live steps said
 * otherwise; this script is what actually works, and it is what
 * `GO_LIVE.md` now points at.
 *
 * What it does, in order:
 *   1. Renders the full CREATE TABLE/INDEX/FK DDL from `schema.prisma`
 *      using `prisma migrate diff --from-empty` (an offline operation — it
 *      does not connect to the database).
 *   2. Applies that DDL.
 *   3. Applies every migration folder's SQL in folder order, and within a
 *      folder in the order ddl → checks → indexes → rls, so a CHECK or
 *      policy never runs before the column it references exists.
 *
 * Each file runs in its own transaction: one bad file rolls back cleanly
 * and is reported, without leaving the previous files half-applied.
 *
 * Re-runnable. Every applied file is recorded in `_bebest_applied_sql` with
 * a checksum, so a second run applies only what is new — adding one
 * migration folder does not mean re-running (and failing on) all the
 * `CREATE POLICY`/`ADD CONSTRAINT` statements that already exist. A file
 * whose contents changed after being applied is reported as an error
 * rather than silently re-run: edit-in-place is not a migration.
 *
 *   --baseline   record every current file as applied WITHOUT running it.
 *                For a database that was set up before this ledger existed.
 *   --dry-run    list what would run, touch nothing.
 *
 * Connects with `pg` rather than Prisma's engine deliberately — node-postgres
 * falls back from IPv6 to IPv4 (Happy Eyeballs), which the Rust engine does
 * not, so this works on networks where `prisma` itself reports P1001. Same
 * reasoning as `src/client.ts`'s driver-adapter default.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const require = createRequire(import.meta.url);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(HERE, '..');
const MIGRATIONS_DIR = path.join(PACKAGE_ROOT, 'prisma', 'migrations');
const SCHEMA_PATH = path.join(PACKAGE_ROOT, 'prisma', 'schema.prisma');

// Within one folder: plain DDL first, then constraints, then indexes, then
// policies. Nothing later can reference something the earlier files create.
const FILE_ORDER = ['ddl.sql', 'checks.sql', 'indexes.sql', 'rls.sql'];

const DRY_RUN = process.argv.includes('--dry-run');
const BASELINE = process.argv.includes('--baseline');

const LEDGER_TABLE = '_bebest_applied_sql';

function checksum(sql) {
  return createHash('sha256').update(sql).digest('hex');
}

function renderSchemaDdl() {
  // Run Prisma's CLI entry point with this same Node binary rather than
  // shelling out to `npx`/`prisma` — no PATH assumptions, no shell quoting,
  // and it behaves identically on Windows and POSIX.
  const prismaCli = require.resolve('prisma/build/index.js');
  return execFileSync(
    process.execPath,
    [prismaCli, 'migrate', 'diff', '--from-empty', '--to-schema-datamodel', SCHEMA_PATH, '--script'],
    { cwd: PACKAGE_ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
}

function collectFiles() {
  const files = [];
  for (const dir of readdirSync(MIGRATIONS_DIR).sort()) {
    for (const name of FILE_ORDER) {
      const full = path.join(MIGRATIONS_DIR, dir, name);
      if (existsSync(full)) files.push({ label: `${dir}/${name}`, sql: readFileSync(full, 'utf8') });
    }
  }
  return files;
}

async function main() {
  // A real environment variable always wins; this only fills in from
  // `packages/database/.env` when one isn't already exported, the same way
  // `apps/api/src/load-env.ts` does for the server.
  const envFile = path.join(PACKAGE_ROOT, '.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL is not set (export it, or put it in packages/database/.env).');
    process.exit(1);
  }

  console.log('rendering schema DDL from schema.prisma…');
  const steps = [{ label: 'schema.prisma (generated DDL)', sql: renderSchemaDdl() }, ...collectFiles()];

  const client = new pg.Client({
    connectionString,
    ssl: connectionString.includes('sslmode=disable') ? false : { rejectUnauthorized: false },
    statement_timeout: 0,
  });
  await client.connect();

  await client.query(
    `create table if not exists ${LEDGER_TABLE} (
       filename   text primary key,
       checksum   text        not null,
       applied_at timestamptz not null default now()
     )`,
  );
  const applied = new Map(
    (await client.query(`select filename, checksum from ${LEDGER_TABLE}`)).rows.map((row) => [
      row.filename,
      row.checksum,
    ]),
  );

  const pending = [];
  const changed = [];
  for (const step of steps) {
    const sum = checksum(step.sql);
    const previous = applied.get(step.label);
    if (previous === undefined) pending.push({ ...step, sum });
    else if (previous !== sum) changed.push(step.label);
  }

  for (const label of changed) {
    console.log(`EDITED ${label} — already applied with different contents; add a new migration instead`);
  }

  if (DRY_RUN) {
    for (const step of pending) console.log(`would apply  ${step.label}`);
    console.log(`\n${pending.length} pending, ${applied.size} already applied (--dry-run).`);
    await client.end();
    if (changed.length > 0) process.exit(1);
    return;
  }

  if (BASELINE) {
    for (const step of pending) {
      await client.query(`insert into ${LEDGER_TABLE} (filename, checksum) values ($1, $2)`, [
        step.label,
        step.sum,
      ]);
      console.log(`BASELINED ${step.label}`);
    }
    console.log(`\n${pending.length} files recorded as applied without running them.`);
    await client.end();
    return;
  }

  let failures = 0;
  for (const step of pending) {
    try {
      await client.query('BEGIN');
      await client.query(step.sql);
      await client.query(`insert into ${LEDGER_TABLE} (filename, checksum) values ($1, $2)`, [
        step.label,
        step.sum,
      ]);
      await client.query('COMMIT');
      console.log(`OK    ${step.label}`);
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      failures += 1;
      console.log(`FAIL  ${step.label}\n      ${String(err.message).split('\n')[0]}`);
    }
  }

  const { rows } = await client.query(
    "select count(*)::int as n from information_schema.tables where table_schema = 'public'",
  );
  await client.end();

  const skipped = steps.length - pending.length;
  console.log(
    `\ntables=${rows[0].n} applied=${pending.length - failures} skipped=${skipped} failures=${failures}`,
  );
  if (failures > 0 || changed.length > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
