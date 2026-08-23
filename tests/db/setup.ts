import { loadEnvLocal } from "../../scripts/loadEnv.mjs";

/**
 * Load `.env.local` so the database suite sees `DATABASE_URL`.
 *
 * Next.js does this for the application; plain vitest does not. Nothing here
 * prints a name or a value -- the loader is deliberately silent.
 */
loadEnvLocal();

/**
 * Trust the certificate if there is one.
 *
 * With `PGSSLROOTCERT` set these tests run the PRODUCTION trust path -- full
 * certificate and hostname verification -- which is the point: the suite should
 * exercise what a deployment will do, not a weaker variant of it.
 *
 * The relaxed fallback exists only for a developer pointing at a self-signed
 * local Postgres with no certificate to hand. It cannot weaken production:
 * `decideTls` ignores the flag when NODE_ENV is production, and
 * `tests/tls.test.ts` asserts that for every input.
 */
const hasRootCert =
  process.env.PGSSLROOTCERT !== undefined && process.env.PGSSLROOTCERT.trim() !== "";
if (!hasRootCert) process.env.PGSSL_ALLOW_UNVERIFIED ??= "true";
