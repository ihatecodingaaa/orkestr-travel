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
 * THE FIRST ATTEMPT AT THIS WAS WRONG, and the way it was wrong is worth
 * keeping. It required Atlas to ECHO the environment back:
 *
 *   "Atlas did not state which environment is active, and an unstated
 *    environment is not a proven one."
 *
 * That sounds rigorous and is actually impossible. The real CLI 0.3.12 answers
 * the sandbox switch with
 *
 *   {"status":"success","code":"CONFIGURATION_UPDATED",
 *    "message":"Atlas configuration updated","data":{}}
 *
 * -- an EMPTY data object. No environment field, ever. So the check could never
 * pass, and it blocked the first authorised search rather than allowing an
 * unsafe one. A guard that can never succeed is not a safe guard; it is a broken
 * one that happens to fail in the safe direction, and it would have been
 * "fixed" under time pressure by somebody who trusted it less carefully.
 *
 * THE CORRECTED PROOF is about what WE did, not about what Atlas said back:
 *
 *   1. Orkestr invoked exactly the internal sandbox argument array.
 *   2. The envelope parsed, and `status` is success.
 *   3. The code is the observed successful configuration update.
 *
 * The word "sandbox" in the result therefore comes from the command this module
 * executed -- a compile-time constant nothing can influence -- and not from
 * pretending Atlas confirmed a value it never sends.
 *
 * That is stronger than a read anyway. A read-then-act check has a gap between
 * the read and the act; setting it immediately before the operation has no gap.
 * And the operation can only ever move towards safety:
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
      /**
       * Always "sandbox", and it comes from the command WE issued.
       *
       * Not from the response: Atlas returns an empty data object. Naming it
       * here records which environment this module forced, which is the only
       * environment it is capable of forcing.
       */
      readonly environment: "sandbox";
      /** How it was established. One value today; named so a second cannot hide. */
      readonly proofMethod: "EXPLICIT_SET_CONFIRMED";
      readonly durationMs: number;
    }
  | {
      readonly proven: false;
      /**
       * Why it failed, where that changes what somebody should do about it.
       *
       * A missing CLI and a refused switch both mean "no sandbox", and they
       * need completely different fixes. Collapsing them sends an operator
       * looking for a provider problem when the binary is simply not on PATH.
       */
      readonly kind: "NOT_INSTALLED" | "AUTHORIZATION_REQUIRED" | "SANDBOX_SET_FAILED";
      readonly reason: string;
      /** Present when Atlas answered but did not confirm sandbox. */
      readonly code?: string;
      readonly durationMs: number;
    };

/**
 * Codes that count as "the switch was applied".
 *
 * An allow-list, not a catch-all for anything non-erroring. A `status: success`
 * carrying a code this module has never seen is refused: it means the CLI's
 * behaviour moved, and the right response to that is to stop rather than to
 * assume the move was harmless. Adding a code here is a deliberate act with the
 * official contract in hand.
 */
export const SANDBOX_CONFIRMATION_CODES: readonly string[] = ["CONFIGURATION_UPDATED"];

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
      kind: outcome.kind === "NOT_INSTALLED" ? "NOT_INSTALLED" : "SANDBOX_SET_FAILED",
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
      kind: "SANDBOX_SET_FAILED",
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
      kind: "AUTHORIZATION_REQUIRED",
      reason:
        "Atlas authorization has not been completed on this machine, so the environment cannot be proven.",
      code: envelope.code,
      durationMs: outcome.durationMs,
    };
  }

  /**
   * Anything that is not an outright success fails.
   *
   * Both documented failure statuses are refused, and so is any status this
   * module does not recognise. The default branch is refusal.
   */
  if (envelope.status !== "success") {
    return {
      proven: false,
      kind: "SANDBOX_SET_FAILED",
      reason: `Atlas did not apply the sandbox setting (status ${envelope.status}).`,
      code: envelope.code,
      durationMs: outcome.durationMs,
    };
  }

  if (!SANDBOX_CONFIRMATION_CODES.includes(envelope.code)) {
    return {
      proven: false,
      kind: "SANDBOX_SET_FAILED",
      reason: `Atlas answered the sandbox switch with an unrecognised code, so the switch is not confirmed.`,
      code: envelope.code,
      durationMs: outcome.durationMs,
    };
  }

  return {
    proven: true,
    // From the constant argument array above. Never from the response.
    environment: "sandbox",
    proofMethod: "EXPLICIT_SET_CONFIRMED",
    durationMs: outcome.durationMs,
  };
}
