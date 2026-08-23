/**
 * Load `.env.local` into `process.env` for scripts.
 *
 * Next.js does this itself for the app; plain Node scripts do not, so the
 * migration runner and the integration tests need it.
 *
 * READS, NEVER PRINTS. Nothing in here logs a key, a value, or a line of the
 * file. The only thing any caller learns is whether a given NAME is present.
 * Existing environment variables win, so a value exported in the shell is not
 * silently overridden by a stale file.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export function loadEnvLocal() {
  const path = join(ROOT, ".env.local");
  if (!existsSync(path)) return { loaded: false, names: [] };

  const names = [];
  for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (line.length === 0 || line.startsWith("#")) continue;

    const eq = line.indexOf("=");
    if (eq <= 0) continue;

    const name = line.slice(0, eq).trim();
    if (!/^[A-Z_][A-Z0-9_]*$/i.test(name)) continue;

    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    names.push(name);
    process.env[name] ??= value;
  }

  // NAMES only. Never values.
  return { loaded: true, names };
}
