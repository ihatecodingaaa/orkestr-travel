import { loadEnvLocal } from "../../scripts/loadEnv.mjs";

/**
 * Load `.env.local` so the database suite sees `DATABASE_URL`.
 *
 * Next.js does this for the application; plain vitest does not. Nothing here
 * prints a name or a value -- the loader is deliberately silent.
 */
loadEnvLocal();
