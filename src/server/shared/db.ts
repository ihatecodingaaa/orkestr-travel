import "server-only";
import { Pool } from "pg";
import type { PoolClient, QueryResultRow } from "pg";
import { DATABASE_URL_VAR } from "./mode";
import { tlsForUrl } from "./tls";

/**
 * The database connection.
 *
 * STANDARD POSTGRESQL, STANDARD DRIVER. `pg` takes a connection string and
 * speaks the wire protocol; it knows nothing about who is hosting. That is the
 * entire coupling to infrastructure, and it is what makes the hosting decision
 * reversible: a managed Postgres from any provider is the same URL in the same
 * variable.
 *
 * There is no provider SDK anywhere in this file, and there should never be
 * one. The moment persistence imports a vendor's client, moving costs a rewrite
 * rather than an environment variable.
 *
 * ONE POOL PER PROCESS. Serverless runtimes reuse a warm process across
 * invocations, so a pool created per request leaks connections until the
 * database refuses new ones -- a failure that only appears under load, which is
 * the worst time to discover it.
 */

let pool: Pool | undefined;

/**
 * Never throws for a missing URL.
 *
 * Shared mode is optional. Callers ask `sharedModeStatus()` first; this returns
 * undefined so that a misconfigured environment degrades to the local product
 * rather than crashing a page render.
 */
export function getPool(): Pool | undefined {
  const url = process.env[DATABASE_URL_VAR];
  if (url === undefined || url.trim() === "") return undefined;

  pool ??= new Pool({
    connectionString: url,
    max: 5,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 8_000,
    /**
     * Decided in one place, and production always verifies.
     *
     * There is no flag that turns verification off in production -- see
     * `tls.ts`. A switch for "trust anything" is a switch that ends up set.
     */
    ssl: tlsForUrl(url).ssl,
  });

  return pool;
}

/** For tests and for shutdown. Safe to call when nothing was opened. */
export async function closePool(): Promise<void> {
  const existing = pool;
  pool = undefined;
  if (existing !== undefined) await existing.end();
}

export async function query<T extends QueryResultRow>(
  text: string,
  params: readonly unknown[] = [],
): Promise<readonly T[]> {
  const active = getPool();
  if (active === undefined) throw new Error("Shared mode is not configured.");
  const result = await active.query<T>(text, [...params]);
  return result.rows;
}

/**
 * Run a unit of work in one transaction.
 *
 * Every multi-step shared write goes through here. Redeeming an invitation
 * touches three tables, and doing it in three statements outside a transaction
 * means a crash between them leaves an invitation marked used by somebody who
 * never got access.
 */
export async function transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const active = getPool();
  if (active === undefined) throw new Error("Shared mode is not configured.");

  const client = await active.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Can we reach the database?
 *
 * RETURNS NOTHING SENSITIVE. Not the URL, not the host, not the user. A setup
 * page prints this, and the whole point is that its output is safe to paste
 * into a chat window while asking for help.
 */
export async function checkConnection(): Promise<
  | { readonly ok: true; readonly serverVersion: string; readonly tls: string }
  | { readonly ok: false; readonly error: string }
> {
  try {
    const rows = await query<{ version: string }>("SELECT version() AS version");
    const raw = rows[0]?.version ?? "unknown";
    // "PostgreSQL 16.3 on x86_64-pc-linux-gnu…" -> "PostgreSQL 16.3"
    const short = /^(PostgreSQL\s+[\d.]+)/.exec(raw)?.[1] ?? "PostgreSQL";
    const url = process.env[DATABASE_URL_VAR] ?? "";
    return { ok: true, serverVersion: short, tls: tlsForUrl(url).description };
  } catch (error) {
    /**
     * Driver errors can carry the connection string in `message`. Only the
     * error's class name is surfaced, never its text.
     */
    const name = error instanceof Error ? error.constructor.name : "Error";
    return { ok: false, error: `Could not connect (${name}).` };
  }
}
