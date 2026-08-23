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

const url = process.env.DATABASE_URL;
if (url === undefined || url.trim() === "") {
  console.error("DATABASE_URL is not set. Shared trips are optional; nothing to do.");
  process.exit(1);
}

const statusOnly = process.argv.includes("--status");

const files = readdirSync(DIR)
  .filter((name) => name.endsWith(".sql"))
  .sort();

const client = new pg.Client({
  connectionString: url,
  ssl:
    url.includes("localhost") || url.includes("127.0.0.1")
      ? false
      : { rejectUnauthorized: false },
});

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
