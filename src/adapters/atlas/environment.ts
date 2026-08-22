import "server-only";
import type { CliRunner } from "./cli";
import { parseEnvelope } from "./envelope";

/**
 * Proving that Atlas is pointed at the sandbox.
 *
 * THE FACT THAT MAKES THIS FILE NECESSARY, from the official README:
 *
 *   "Atlas Flight Booking uses production services by default."
 *
 * Production is not something you opt into. It is where you already are. A bug
 * that merely FAILS to switch environments is therefore a bug that searches
 * live fares, and in a booking flow it is a bug that spends money.
 *
 * THE SECOND FACT, established by running the real CLI 0.3.12: there is no
 * command that READS the current environment. `environment use sandbox` and
 * `environment use production` exist; `environment`, `environment show`,
 * `environment status` and `environment current` all return INVALID_ARGUMENT.
 *
 * So "check whether we are in sandbox, and stop if not" is not implementable.
 * The only proof available is to SET sandbox and read the confirmation back.
 *
 * That turns out to be the stronger design anyway. A read-then-act check has a
 * gap between the read and the act; setting it immediately before the operation
 * has no gap. And the operation can only ever move towards safety:
 *
 *   THIS MODULE CANNOT SELECT PRODUCTION. The word appears in no argument array
 *   it can build. There is no parameter, no branch and no configuration value
 *   that causes `environment use production` to be issued. Asserted in tests.
 *
 * If the confirmation does not prove sandbox, no flight operation runs. Not a
 * degraded one, not a fixture one. None.
 */

/** The only environment this application is authorised to use. */
export const REQUIRED_ENVIRONMENT = "sandbox";

/**
 * The argument array, fixed at module scope.
 *
 * A constant rather than a built string so there is no interpolation site where
 * an environment name could come from a variable, a config file, or a caller.
 */
const SANDBOX_ARGS: readonly string[] = ["environment", "use", "sandbox", "--json"];

export const DEFAULT_ENVIRONMENT_TIMEOUT_MS = 30_000;

export type SandboxProof =
  | {
      readonly proven: true;
      /** Exactly what Atlas reported, for display and for the record. */
      readonly environment: string;
      readonly durationMs: number;
    }
  | {
      readonly proven: false;
      readonly reason: string;
      /** Present when Atlas answered but did not confirm sandbox. */
      readonly code?: string;
      readonly durationMs: number;
    };

/**
 * Read the environment out of a confirmation envelope.
 *
 * Accepts a small number of field names because the confirmation shape is not
 * in the CLI contract reference, only the command is. Every accepted name must
 * still contain the literal string `sandbox`; a missing field is never treated
 * as agreement.
 */
function readEnvironmentName(data: Readonly<Record<string, unknown>>): string | undefined {
  for (const key of ["environment", "env", "current_environment", "name"]) {
    const value = data[key];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return undefined;
}

export interface SandboxProofOptions {
  readonly runner: CliRunner;
  readonly timeoutMs?: number;
}

/**
 * Force sandbox, then prove it.
 *
 * Returns `proven: false` for every ambiguity. There is no "probably fine"
 * branch: an unreadable confirmation, an unexpected code, a missing field and a
 * name that is not `sandbox` all produce the same refusal, because the cost of
 * being wrong is a real booking against real money.
 */
export async function proveSandbox(options: SandboxProofOptions): Promise<SandboxProof> {
  const outcome = await options.runner.run({
    args: SANDBOX_ARGS,
    timeoutMs: options.timeoutMs ?? DEFAULT_ENVIRONMENT_TIMEOUT_MS,
  });

  if (!outcome.ok) {
    return {
      proven: false,
      reason:
        outcome.kind === "NOT_INSTALLED"
          ? "The Atlas CLI is not installed, so the environment cannot be proven."
          : `The environment could not be established: ${outcome.message}`,
      durationMs: outcome.durationMs,
    };
  }

  const parsed = parseEnvelope(outcome.stdout);
  if (!parsed.ok) {
    return {
      proven: false,
      reason: `The environment response could not be read: ${parsed.reason}`,
      durationMs: outcome.durationMs,
    };
  }

  const envelope = parsed.envelope;

  /**
   * An authorization failure here is NOT a sandbox failure, and saying so
   * matters: the operator needs to know they have a human step to complete, not
   * that something is wrong with their environment setting.
   */
  if (envelope.code === "AUTHORIZATION_REQUIRED" || envelope.code === "AUTH_EXPIRED") {
    return {
      proven: false,
      reason:
        "Atlas authorization has not been completed on this machine, so the environment cannot be proven.",
      code: envelope.code,
      durationMs: outcome.durationMs,
    };
  }

  if (envelope.status === "terminal_error") {
    return {
      proven: false,
      reason: "Atlas refused the environment command.",
      code: envelope.code,
      durationMs: outcome.durationMs,
    };
  }

  const name = readEnvironmentName(envelope.data);
  if (name === undefined) {
    return {
      proven: false,
      reason:
        "Atlas did not state which environment is active, and an unstated environment is not a proven one.",
      code: envelope.code,
      durationMs: outcome.durationMs,
    };
  }

  if (name.toLowerCase() !== REQUIRED_ENVIRONMENT) {
    return {
      proven: false,
      reason: `Atlas reported the "${name}" environment. Only sandbox is authorised.`,
      code: envelope.code,
      durationMs: outcome.durationMs,
    };
  }

  return { proven: true, environment: name, durationMs: outcome.durationMs };
}
