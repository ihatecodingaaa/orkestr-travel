import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Invite and session tokens.
 *
 * SERVER ONLY. `import "server-only"` makes the build fail if a client
 * component ever reaches this file, which matters more here than almost
 * anywhere else in the codebase: a token generator in a browser bundle is a
 * token generator an attacker can read the parameters of.
 *
 * TWO RULES, AND THEY ARE THE WHOLE SECURITY MODEL FOR JOINING A TRIP.
 *
 * 1. Tokens are 256 bits of CSPRNG output. Not a uuid, not a timestamp, not a
 *    trip id with a suffix. Guessing is not a threat we mitigate; it is a
 *    threat we make arithmetically absurd.
 *
 * 2. The raw token is never stored. Only its SHA-256 hash reaches the database,
 *    so a dump of the invitations table yields hashes of random values and no
 *    usable links. The raw value exists in memory long enough to be handed to
 *    the organiser's clipboard, and then it is gone.
 *
 * SHA-256 with no salt or stretching is correct HERE and would be wrong for a
 * password. Passwords are low-entropy and human-chosen, so they need slow
 * hashing to survive a dictionary attack. These are 256-bit random values:
 * there is no dictionary, and a fast hash costs an attacker nothing they did
 * not already lack.
 */

/** 32 bytes = 256 bits. */
const TOKEN_BYTES = 32;

export interface IssuedToken {
  /** Hand to the user once. Never persist, never log, never render server-side. */
  readonly raw: string;
  /** Safe to store. */
  readonly hash: string;
}

/**
 * Base64url so the value is URL-safe without percent-encoding.
 *
 * A token that needs escaping ends up double-encoded by something eventually,
 * and then a valid link stops working for reasons nobody can reproduce.
 */
export function issueToken(): IssuedToken {
  const raw = randomBytes(TOKEN_BYTES).toString("base64url");
  return { raw, hash: hashToken(raw) };
}

export function hashToken(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

/**
 * Named for invitations specifically, so the bundle guard can assert this
 * symbol never appears in browser output.
 */
export const hashInviteToken = hashToken;

/**
 * Constant-time comparison of two hashes.
 *
 * The lookup is by hash, so a timing signal here is not much of a door. It
 * costs one function call to close it anyway, and `===` on secret-derived
 * values is the habit worth not having.
 */
export function hashesEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * Redact a token for a log line or an error message.
 *
 * Exists so that "just print it while debugging" has a safe thing to reach for.
 * Anything that reaches a log, an exception message or an analytics call goes
 * through here, and even then it keeps only enough to correlate two events.
 */
export function redactToken(raw: string): string {
  return raw.length <= 6 ? "<token>" : `<token:${raw.slice(0, 4)}…>`;
}
