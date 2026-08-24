#!/usr/bin/env node
/**
 * Apply, or report on, the SQL migrations in `migrations/`.
 *
 *   node scripts/migrate.mjs           apply anything not yet recorded
 *   node scripts/migrate.mjs --status  say what has run, change nothing
 *
 * NEVER RUNS ON ITS OWN. Not on boot, not on a deploy hook, not when a page is
 * rendered. A schema change should happen because a person decided it should.
 *
 * NEVER PRINTS THE CONNECTION STRING. Not on success, not in an error. The
 * driver's own errors sometimes embed it, so only error class names are shown.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIR = join(ROOT, "migrations");

/**
 * Migrations use their own connection when one is configured.
 *
 * Runtime traffic goes through a transaction pooler, which is right for many
 * short-lived serverless instances and wrong for schema changes: a migration is
 * one long session doing DDL, run deliberately from a terminal. Providers that
 * offer both hand out two URLs, and they are not interchangeable.
 *
 * With MIGRATION_DATABASE_URL unset this falls back to DATABASE_URL, which is
 * correct for a local database where there is only one.
 */
const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
if (url === undefined || url.trim() === "") {
  console.error(
    "Neither MIGRATION_DATABASE_URL nor DATABASE_URL is set. Shared trips are optional; nothing to do.",
  );
  process.exit(1);
}
console.log(
  "connection            :",
  process.env.MIGRATION_DATABASE_URL ? "MIGRATION_DATABASE_URL" : "DATABASE_URL (no migration URL set)",
);

const statusOnly = process.argv.includes("--status");

const files = readdirSync(DIR)
  .filter((name) => name.endsWith(".sql"))
  .sort();


/**
 * Is this connection to this machine?
 *
 * Parsed, not substring-matched. `url.includes("localhost")` was the earlier
 * test, and `postgresql://u:p@localhost.evil.example.com/db` would have
 * satisfied it -- disabling TLS for a remote host whose name merely starts
 * with the word.
 */
function isLoopback(url) {
  try {
    const { hostname } = new URL(url);
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  } catch {
    return false;
  }
}

/**
 * How to trust the connection, mirroring src/server/shared/tls.ts.
 *
 * These scripts are developer tools run by a person at a terminal, so the
 * relaxed path is available here when asked for -- but it is asked for, and it
 * is reported in the output rather than assumed.
 */
function sslFor(url) {
  if (isLoopback(url)) return false;
  const rootCert = process.env.PGSSLROOTCERT;
  if (rootCert !== undefined && rootCert.trim() !== "") {
    return { rejectUnauthorized: true, ca: readFileSync(rootCert.trim(), "utf8") };
  }
  if ((process.env.PGSSL_ALLOW_UNVERIFIED ?? "").toLowerCase() === "true") {
    return { rejectUnauthorized: false };
  }
  return { rejectUnauthorized: true };
}

const client = new pg.Client({ connectionString: url, ssl: sslFor(url) });

function fail(context, error) {
  const name = error instanceof Error ? error.constructor.name : "Error";
  // Deliberately not error.message: pg embeds the connection string in some.
  console.error(`${context} failed (${name}).`);
  process.exit(1);
}

try {
  await client.connect();
} catch (error) {
  fail("Connection", error);
}

try {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migration (
      name       TEXT        PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const { rows } = await client.query("SELECT name FROM schema_migration");
  const applied = new Set(rows.map((row) => row.name));

  const pending = files.filter((name) => !applied.has(name));

  console.log(`migrations directory : ${files.length} file(s)`);
  console.log(`already applied      : ${applied.size}`);
  console.log(`pending              : ${pending.length}`);

  for (const name of files) {
    console.log(`  ${applied.has(name) ? "applied" : "PENDING"}  ${name}`);
  }

  if (statusOnly) {
    console.log("\n--status: nothing was changed.");
  } else if (pending.length === 0) {
    console.log("\nNothing to apply.");
  } else {
    for (const name of pending) {
      const sql = readFileSync(join(DIR, name), "utf8");
      console.log(`\napplying ${name} …`);
      /**
       * Each file wraps itself in BEGIN/COMMIT, so a failure part-way leaves
       * the database on the previous migration rather than half on this one.
       */
      await client.query(sql);
      await client.query("INSERT INTO schema_migration (name) VALUES ($1)", [name]);
      console.log(`applied  ${name}`);
    }
    console.log(`\nDone. ${pending.length} migration(s) applied.`);
  }
} catch (error) {
  fail("Migration", error);
} finally {
  await client.end();
}
