import "server-only";
import { spawn } from "node:child_process";

/**
 * The Atlas CLI process boundary.
 *
 * Everything Orkestr knows about Atlas arrives through this file, and it arrives
 * as bytes from a subprocess. Three properties matter more than anything else
 * here, and each of them was chosen against a specific way this could go wrong.
 *
 * 1. NO SHELL, EVER. `shell: false` with an argument ARRAY. An origin code that
 *    arrives as `SIN; rm -rf /` must land in `argv[2]` as inert data and be
 *    rejected by validation, not interpreted by anything. There is deliberately
 *    no code path in this module that builds a command string.
 *
 * 2. EXIT CODE IS NOT THE FAILURE SIGNAL. Verified against the real CLI 0.3.12:
 *
 *      $ atlas-flight environment --json ; echo $?
 *      {"schema_version":"1","status":"terminal_error","code":"INVALID_ARGUMENT",...}
 *      0
 *
 *    A terminal error exits ZERO. An adapter that trusted the exit code would
 *    treat every Atlas failure as a success and then fall over parsing the
 *    payload, or worse, not fall over at all. The envelope is the truth; the
 *    exit code is recorded and reported but never used to decide success.
 *
 * 3. BOUNDED IN EVERY DIRECTION. Time, stdout, stderr. A provider that hangs
 *    must fail rather than hold a request open, and a provider that floods must
 *    be cut off rather than fill memory.
 *
 * NOT here: credentials. The CLI owns its own secure store and this module never
 * reads it, never passes a token, and never puts one in an argument. The
 * credential boundary is the CLI process itself.
 */

/** The executable name. Resolved on PATH; never a path we construct or guess. */
export const ATLAS_BINARY = "atlas-flight";

/** Hard ceiling on captured output. Atlas envelopes are kilobytes, not megabytes. */
export const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;

export interface CliInvocation {
  /** Arguments AFTER the binary name. Each element is one argv entry. */
  readonly args: readonly string[];
  readonly timeoutMs: number;
}

export type CliOutcome =
  | {
      readonly ok: true;
      /** Raw stdout, bounded. Parsed by `envelope.ts`, never by this module. */
      readonly stdout: string;
      readonly exitCode: number | null;
      readonly durationMs: number;
    }
  | {
      readonly ok: false;
      readonly kind:
        | "NOT_INSTALLED"
        | "TIMEOUT"
        | "OUTPUT_TOO_LARGE"
        | "SPAWN_FAILED"
        | "NO_OUTPUT";
      /** Safe to log. Never contains a credential, because none is ever passed. */
      readonly message: string;
      readonly exitCode?: number | null;
      readonly durationMs: number;
    };

/**
 * Arguments must be inert.
 *
 * Nothing here is about shell metacharacters -- `shell: false` already makes
 * those meaningless. This rejects the two things that are still dangerous when
 * passing an argument array:
 *
 *   * A NUL byte, which truncates the argument inside the OS call rather than
 *     in anything we can see.
 *   * A leading `-`, which turns a value into a FLAG. An origin code of
 *     `--passengers-file` would silently become a different command than the one
 *     this adapter believes it is running. Real IATA codes never start with a
 *     dash, so refusing is free.
 *
 * Validation of what a value MEANS belongs in the request layer. This is the
 * last line, not the first.
 */
export function isInertArgument(value: string): boolean {
  if (value.length === 0) return false;
  if (value.includes("\0")) return false;
  if (value.startsWith("-")) return false;
  return true;
}

export interface CliRunner {
  run(invocation: CliInvocation): Promise<CliOutcome>;
}

/**
 * Run the real CLI.
 *
 * Injected as an interface so every test in this repository can exercise the
 * adapter -- including timeout, malformed output and non-zero exit -- without a
 * subprocess and without Atlas.
 */
export class ChildProcessCliRunner implements CliRunner {
  constructor(
    private readonly binary: string = ATLAS_BINARY,
    private readonly now: () => number = Date.now,
  ) {}

  run(invocation: CliInvocation): Promise<CliOutcome> {
    const startedAt = this.now();
    const elapsed = (): number => this.now() - startedAt;

    return new Promise<CliOutcome>((resolve) => {
      let child;
      try {
        child = spawn(this.binary, [...invocation.args], {
          // THE line that matters. No shell, so no metacharacter has meaning.
          shell: false,
          // stdin closed: no command in this adapter accepts piped input, and
          // passenger data is not something Phase 7 sends at all.
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
        });
      } catch (error) {
        resolve({
          ok: false,
          kind: "SPAWN_FAILED",
          message: `The Atlas CLI could not be started: ${String(error)}`,
          durationMs: elapsed(),
        });
        return;
      }

      let stdout = "";
      let stderrBytes = 0;
      let settled = false;
      let overflowed = false;

      const finish = (outcome: CliOutcome): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(outcome);
      };

      /**
       * The timeout kills the process rather than merely abandoning it.
       *
       * Resolving the promise while leaving the child running would leak a
       * process per request and, on a slow provider, quietly build up a pile of
       * them behind a page that already returned.
       */
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        finish({
          ok: false,
          kind: "TIMEOUT",
          message: `The Atlas CLI did not respond within ${String(invocation.timeoutMs)}ms.`,
          durationMs: elapsed(),
        });
      }, invocation.timeoutMs);

      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        if (overflowed) return;
        if (Buffer.byteLength(stdout) + Buffer.byteLength(chunk) > MAX_OUTPUT_BYTES) {
          overflowed = true;
          child.kill("SIGKILL");
          finish({
            ok: false,
            kind: "OUTPUT_TOO_LARGE",
            message: `The Atlas CLI produced more than ${String(MAX_OUTPUT_BYTES)} bytes.`,
            durationMs: elapsed(),
          });
          return;
        }
        stdout += chunk;
      });

      /**
       * stderr is counted, never kept.
       *
       * It is diagnostic text from somebody else's program, it is not part of
       * the contract, and it is the most likely place for something we should
       * not be storing to appear. The byte count is enough to say "it said
       * something" without repeating what.
       */
      child.stderr.on("data", (chunk: Buffer) => {
        stderrBytes += chunk.byteLength;
      });

      child.on("error", (error: NodeJS.ErrnoException) => {
        finish({
          ok: false,
          kind: error.code === "ENOENT" ? "NOT_INSTALLED" : "SPAWN_FAILED",
          message:
            error.code === "ENOENT"
              ? "The Atlas CLI is not installed or is not on PATH."
              : `The Atlas CLI could not be started: ${error.code ?? "unknown"}`,
          durationMs: elapsed(),
        });
      });

      child.on("close", (code) => {
        if (stdout.trim().length === 0) {
          finish({
            ok: false,
            kind: "NO_OUTPUT",
            message:
              stderrBytes > 0
                ? `The Atlas CLI exited without JSON output (${String(stderrBytes)} bytes on stderr).`
                : "The Atlas CLI exited without any output.",
            exitCode: code,
            durationMs: elapsed(),
          });
          return;
        }
        /**
         * Note what is NOT checked: `code === 0`.
         *
         * The CLI exits 0 on terminal_error. Success is decided by the envelope,
         * which is a layer above this one. Here, output is output.
         */
        finish({ ok: true, stdout, exitCode: code, durationMs: elapsed() });
      });
    });
  }
}
