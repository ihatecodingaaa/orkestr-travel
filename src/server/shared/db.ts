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
 * entire coupling to infrastructure, and it is what keeps the hosting decision
 * reversible: a managed Postgres from any provider is the same URL in the same
 * variable.
 *
 * There is no provider SDK anywhere in this file, and there should never be
 * one. The moment persistence imports a vendor's client, moving costs a rewrite
 * rather than an environment variable.
 *
 * BUILT FOR A TRANSACTION POOLER. Every statement this application sends is
 * either a single parameterised query or a `BEGIN … COMMIT` block that opens
 * and closes inside one function call. Nothing holds session state between
 * statements: no named prepared statements, no `SET SESSION`, no advisory
 * locks, no `LISTEN`, no temporary tables, no cursors. `FOR UPDATE` is used,
 * and it is transaction-scoped, which is exactly what a transaction pooler
 * supports.
 *
 * That is not an accident of style — it is what makes serverless deployment
 * safe, and it is worth keeping true. See `docs/PRODUCTION_DEPLOYMENT.md`.
 */

let pool: Pool | undefined;

/**
 * How many connections one instance may open.
 *
 * SMALL ON PURPOSE. A serverless platform runs many instances of the same
 * function, and each one gets its own pool. A generous `max` multiplied by
 * however many instances a traffic spike creates is how a database hits its
 * connection limit and starts refusing everybody — including the instances that
 * were working fine.
 *
 * Two is enough for this workload: a request performs one query, or one short
 * transaction. Anything queued behind that is better queued than counted
 * against a shared limit.
 */
const MAX_CONNECTIONS = process.env.NODE_ENV === "production" ? 2 : 5;

/**
 * Never throws for a missing URL.
 *
 * Shared mode is optional. Callers ask `sharedModeStatus()` first; this returns
 * undefined so a misconfigured environment degrades to the local product rather
 * than crashing a page render.
 */
export function getPool(): Pool | undefined {
  const url = process.env[DATABASE_URL_VAR];
  if (url === undefined || url.trim() === "") return undefined;

  pool ??= new Pool({
    connectionString: url,
    max: MAX_CONNECTIONS,

    /**
     * Decided in one place, and production always verifies. There is no flag
     * that turns verification off in production — see `tls.ts`.
     */
    ssl: tlsForUrl(url).ssl,

    /**
     * Idle connections are returned quickly. A warm serverless instance can sit
     * unused for minutes; holding a connection through that is holding a slot
     * somebody else needs.
     */
    idleTimeoutMillis: 10_000,

    /**
     * Bounded waits, so a request fails rather than hanging.
     *
     * A serverless function that waits indefinitely for a connection burns its
     * whole execution budget and then fails anyway — having also held the
     * caller for the entire time.
     */
    connectionTimeoutMillis: 8_000,

    /**
     * A ceiling on any single statement, enforced by the SERVER.
     *
     * `statement_timeout` makes Postgres itself abort a query that overruns,
     * which is the only version of this that works when the client has already
     * gone away. Ten seconds is far above anything this application issues.
     */
    statement_timeout: 10_000,

    /**
     * And a ceiling on how long a transaction may sit idle holding locks. A
     * pooled connection abandoned mid-transaction would otherwise keep a row
     * locked until something times out much later.
     */
    idle_in_transaction_session_timeout: 15_000,

    // Identifies this application in the database's own connection views.
    application_name: "orkestr",
  });

  /**
   * A pool that emits an unhandled `error` takes the process down. Idle
   * connections are dropped by poolers and load balancers as a matter of
   * routine, so this is an expected event, not an exceptional one: `pg`
   * discards the dead client and the next request gets a fresh one.
   *
   * NOTHING IS LOGGED HERE. Driver errors can carry the connection string.
   */
  pool.on("error", () => undefined);

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
 *
 * NO RETRIES. A failed transaction is reported, not repeated: these writes are
 * not idempotent, and a retry that succeeds after a timeout the caller already
 * gave up on is how one invitation becomes two joins. Optimistic versioning
 * makes a genuine race safe to *refuse*, not safe to replay.
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
    // Best-effort: the connection may already be gone, which is why this
    // cannot be allowed to mask the original failure.
    await client.query("ROLLBACK").catch(() => undefined);
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
  | {
      readonly ok: true;
      readonly serverVersion: string;
      readonly tls: string;
      readonly caSource: string;
    }
  | { readonly ok: false; readonly error: string }
> {
  try {
    const rows = await query<{ version: string }>("SELECT version() AS version");
    const raw = rows[0]?.version ?? "unknown";
    // "PostgreSQL 16.3 on x86_64-pc-linux-gnu…" -> "PostgreSQL 16.3"
    const short = /^(PostgreSQL\s+[\d.]+)/.exec(raw)?.[1] ?? "PostgreSQL";
    const decision = tlsForUrl(process.env[DATABASE_URL_VAR] ?? "");
    return {
      ok: true,
      serverVersion: short,
      tls: decision.description,
      caSource: decision.caSource,
    };
  } catch (error) {
    /**
     * Driver errors can carry the connection string in `message`. Only the
     * error's class name is surfaced, never its text.
     */
    const name = error instanceof Error ? error.constructor.name : "Error";
    return { ok: false, error: `Could not connect (${name}).` };
  }
}
