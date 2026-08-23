import { loadEnvLocal } from "../../scripts/loadEnv.mjs";

/**
 * Load `.env.local` so the database suite sees `DATABASE_URL`.
 *
 * Next.js does this for the application; plain vitest does not. Nothing here
 * prints a name or a value -- the loader is deliberately silent.
 */
loadEnvLocal();

/**
 * These tests connect to a development database whose certificate chain is
 * self-signed, so they opt into the relaxed trust the development path allows.
 *
 * This CANNOT weaken production: `decideTls` ignores the flag when
 * NODE_ENV is production, and `tests/tls.test.ts` asserts that for every input.
 * Production requires either a publicly trusted certificate or PGSSLROOTCERT.
 */
process.env.PGSSL_ALLOW_UNVERIFIED ??= "true";
