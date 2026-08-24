#!/usr/bin/env node
/**
 * Remove synthetic acceptance data from a shared-trips database.
 *
 * PRODUCTION ACCEPTANCE CREATES REAL ROWS. Proving that Lucas and Zen can share
 * a trip on the deployed product means writing a trip, members, an invitation,
 * sessions and an event history into the production database. Those rows are
 * fictional, but they are indistinguishable from real ones to every screen in
 * the product, so leaving them behind means the first genuine visitor arrives
 * to a database that already contains somebody else's holiday.
 *
 * DRY RUN BY DEFAULT. It prints what it would delete and exits. Deleting
 * requires `--commit`, typed deliberately.
 *
 * IT CANNOT REACH REAL DATA BY ACCIDENT. Only trips whose id matches the
 * synthetic prefix are eligible, and the prefix is the one the acceptance
 * scripts generate. A trip created by a person does not carry it.
 *
 * `schema_migration` IS NEVER TOUCHED. Deleting a migration record would make
 * the next deploy try to reapply a migration that has already run. There is no
 * code path here that names that table.
 *
 * PRINTS NOTHING SENSITIVE -- no URL, no host, no credentials. Driver errors
 * are reported as class names, because `pg` puts the connection string into the
 * message of several of them.
 */
import { readFileSync } from "node:fs";
import pg from "pg";
import { loadEnvLocal } from "./loadEnv.mjs";

/** The prefix the acceptance scripts use. Nothing else is eligible. */
const SYNTHETIC_PREFIX = "prod-";

const COUNTED_TABLES = [
  "shared_trip",
  "trip_member",
  "member_private_data",
  "trip_invitation",
  "browser_session",
  "session_membership",
  "trip_event",
];

const commit = process.argv.includes("--commit");

loadEnvLocal();
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set. Nothing to clean.");
  process.exit(1);
}

/**
 * The same certificate boundary the application uses.
 *
 * A cleanup script that quietly disabled verification would be a second, weaker
 * way into the same database.
 */
function certificate() {
  const b64 = process.env.PGSSLROOTCERT_B64;
  if (b64 !== undefined && b64.trim() !== "") {
    return Buffer.from(b64, "base64").toString("utf8");
  }
  const path = process.env.PGSSLROOTCERT;
  if (path !== undefined && path.trim() !== "") return readFileSync(path, "utf8");
  return undefined;
}

const ca = certificate();
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ...(ca === undefined ? {} : { ssl: { ca } }),
  max: 2,
});

const count = async (table) => {
  const { rows } = await pool.query(`SELECT COUNT(*)::int AS c FROM ${table}`);
  return rows[0].c;
};

try {
  const { rows: doomed } = await pool.query(
    "SELECT id, version FROM shared_trip WHERE id LIKE $1 ORDER BY created_at",
    [`${SYNTHETIC_PREFIX}%`],
  );
  const { rows: orphanRows } = await pool.query(
    `SELECT COUNT(*)::int AS c FROM browser_session bs
      WHERE NOT EXISTS (SELECT 1 FROM session_membership sm WHERE sm.session_id = bs.id)`,
  );

  console.log("synthetic trips eligible :", doomed.length);
  for (const trip of doomed) console.log(`  ${trip.id}  v${trip.version}`);
  console.log("orphan browser sessions  :", orphanRows[0].c);

  if (doomed.length === 0 && orphanRows[0].c === 0) {
    console.log("\nNothing to do.");
    process.exit(0);
  }

  if (!commit) {
    console.log("\nDRY RUN. Re-run with --commit to delete.");
    process.exit(0);
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    /**
     * One statement, because every dependent table is ON DELETE CASCADE from
     * `shared_trip`. Deleting the children by hand would be a second definition
     * of the schema's shape, kept in step by memory.
     */
    const removed = await client.query(
      "DELETE FROM shared_trip WHERE id LIKE $1 RETURNING id",
      [`${SYNTHETIC_PREFIX}%`],
    );
    /**
     * `browser_session` is deliberately NOT cascaded -- a browser outlives any
     * one trip -- so a session whose only membership was synthetic is left
     * behind pointing at nothing. It is cleaned by having no memberships, not
     * by its age, so a real session that still has access is never eligible.
     */
    const sessions = await client.query(
      `DELETE FROM browser_session bs
        WHERE NOT EXISTS (SELECT 1 FROM session_membership sm WHERE sm.session_id = bs.id)
        RETURNING id`,
    );
    await client.query("COMMIT");
    console.log(`\ndeleted trips    : ${removed.rowCount}`);
    console.log(`deleted sessions : ${sessions.rowCount}`);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  console.log("\nremaining rows");
  for (const table of COUNTED_TABLES) {
    console.log(`  ${table.padEnd(22)} ${await count(table)}`);
  }
  const { rows: migrations } = await pool.query("SELECT name FROM schema_migration ORDER BY name");
  console.log("  schema_migration intact:", migrations.map((row) => row.name).join(", "));
} catch (error) {
  console.error("failed:", error.constructor.name, error.code ?? "");
  process.exitCode = 1;
} finally {
  await pool.end();
}
