/**
 * The Atlas kill switch.
 *
 * Deliberately the SAME shape as `readModelStudioMode`, down to the fail-closed
 * behaviour on a typo, because a second mode system with different rules is a
 * second thing to reason about at the exact moment somebody is trying to work
 * out why a demo just spent money.
 *
 * The default is `disabled`. Installing the Atlas CLI, authorising it, and
 * pointing it at sandbox are all CAPABILITIES. None of them is an instruction to
 * contact a provider, and none of them switches this on.
 */

export type AtlasMode =
  /** Never start the CLI. Nothing reaches Atlas. */
  | "disabled"
  /** Serve a result captured from a real sandbox run. Never labelled live. */
  | "recorded"
  /** Contact the Atlas sandbox, after proving the environment. */
  | "sandbox";

export const DEFAULT_ATLAS_MODE: AtlasMode = "disabled";

const MODES: readonly AtlasMode[] = ["disabled", "recorded", "sandbox"];

export type EnvSource = Readonly<Record<string, string | undefined>>;

/**
 * Read the mode, defaulting closed.
 *
 * NOTE WHAT IS MISSING: there is no `production` mode, and no value of
 * `ATLAS_MODE` produces one. Production is not disabled by configuration in this
 * application; it is absent from the type. Somebody who wanted it would have to
 * add a variant, which is a code review rather than an environment variable.
 */
export function readAtlasMode(env: EnvSource = process.env): AtlasMode {
  const raw = env["ATLAS_MODE"];
  if (raw === undefined) return DEFAULT_ATLAS_MODE;
  const normalised = raw.trim().toLowerCase();
  return MODES.includes(normalised as AtlasMode) ? (normalised as AtlasMode) : DEFAULT_ATLAS_MODE;
}

export const DEFAULT_SEARCH_TIMEOUT_MS = 90_000;
export const DEFAULT_VERIFY_TIMEOUT_MS = 60_000;

export interface AtlasConfig {
  readonly mode: AtlasMode;
  readonly searchTimeoutMs: number;
  readonly verifyTimeoutMs: number;
}

export function readAtlasConfig(env: EnvSource = process.env): AtlasConfig {
  return {
    mode: readAtlasMode(env),
    searchTimeoutMs: readTimeout(env["ATLAS_SEARCH_TIMEOUT_MS"], DEFAULT_SEARCH_TIMEOUT_MS),
    verifyTimeoutMs: readTimeout(env["ATLAS_VERIFY_TIMEOUT_MS"], DEFAULT_VERIFY_TIMEOUT_MS),
  };
}

/** Bounded on both sides. An unparseable or absurd value falls back to the default. */
function readTimeout(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const parsed = Number.parseInt(raw.trim(), 10);
  if (!Number.isSafeInteger(parsed) || parsed < 1_000 || parsed > 300_000) return fallback;
  return parsed;
}

/** Safe to log and safe to render. Contains nothing the CLI keeps private. */
export function describeAtlasConfig(config: AtlasConfig): Readonly<Record<string, string>> {
  return {
    mode: config.mode,
    searchTimeoutMs: String(config.searchTimeoutMs),
    verifyTimeoutMs: String(config.verifyTimeoutMs),
    environmentPolicy: "sandbox only; production is not representable",
  };
}
