import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { ModelStudioConfig, ModelStudioConfigResult } from "@/adapters/modelStudio/config";

/**
 * Shared helpers for the live evaluations.
 *
 * Two jobs: load `.env.local` (vitest does not, and should not, run Next's
 * environment loading), and print reports that carry no secret.
 */

/**
 * Load `.env.local` into the process environment.
 *
 * Deliberately minimal and non-overwriting: a variable already set in the shell
 * wins, so a one-off run with a different model does not need the file edited.
 * `.env.local` is gitignored, and nothing here ever prints a value.
 */
export function loadLocalEnv(file = ".env.local"): void {
  const path = join(process.cwd(), file);
  if (!existsSync(path)) return;

  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue;
    const equals = trimmed.indexOf("=");
    if (equals === -1) continue;
    const key = trimmed.slice(0, equals).trim();
    if (key.length === 0 || process.env[key] !== undefined) continue;
    let value = trimmed.slice(equals + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

/**
 * Print a labelled block.
 *
 * `console.log` is deliberate here: this IS the product of running an eval, and
 * a report nobody can read is not a report. Callers pass only safe metadata; the
 * one rule is that no value passed to this function may be a credential.
 */
export function report(label: string, fields: Record<string, string | number>): void {
  const lines = Object.entries(fields).map(([key, value]) => `  ${key}: ${String(value)}`);
  // eslint-disable-next-line no-console
  console.log(`\n[${label}]\n${lines.join("\n")}`);
}

/** Narrow a config result, with a message that says what to set. */
export function requireConfig(config: ModelStudioConfigResult): ModelStudioConfig {
  if (config.configured) return config;
  throw new Error(
    `Model Studio is not configured: ${config.reason} Missing: ${config.missing.join(", ")}`,
  );
}
