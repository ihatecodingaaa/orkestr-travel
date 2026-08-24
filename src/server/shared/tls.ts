import "server-only";
import { readFileSync } from "node:fs";

/**
 * How the database connection is trusted.
 *
 * THE RULE: production always verifies. There is no environment variable, no
 * flag and no code path that turns verification off in production. A switch for
 * "trust anything" is a switch that ends up set, usually at 2am, usually
 * permanently.
 *
 * The first version used `rejectUnauthorized: false` everywhere, which encrypts
 * the connection and verifies nothing — it stops somebody reading the wire
 * passively and does not stop somebody sitting in the middle of it. A comment
 * said so, which is not a control.
 *
 * TWO WAYS TO SUPPLY A ROOT, because the two environments cannot share one.
 * A developer has a file on disk. A serverless function has environment
 * variables and no filesystem you can put a certificate in, so the certificate
 * travels as one.
 *
 * PRECEDENCE, and it is deliberate:
 *
 *   1. `PGSSLROOTCERT_B64`  — certificate material from the environment
 *   2. `PGSSLROOTCERT`      — certificate file on disk
 *   3. `PGSSL_ALLOW_UNVERIFIED=true`, DEVELOPMENT ONLY
 *   4. verify against the system roots
 *
 * Step 4 is the fail-closed default: with nothing configured the connection
 * still verifies and simply fails against an untrusted server, which is the
 * outcome you want when somebody forgets to set something.
 *
 * Environment beats file so that a deployment cannot be silently altered by a
 * path that happens to exist in an image.
 */

export const ROOT_CERT_VAR = "PGSSLROOTCERT";
export const ROOT_CERT_B64_VAR = "PGSSLROOTCERT_B64";
export const ALLOW_UNVERIFIED_VAR = "PGSSL_ALLOW_UNVERIFIED";

const PEM_HEADER = "-----BEGIN CERTIFICATE-----";

export type SslConfig =
  | false
  | {
      readonly rejectUnauthorized: boolean;
      readonly ca?: string;
    };

export interface TlsDecision {
  readonly ssl: SslConfig;
  /** Plain-English. Safe to print: no host, no secret, no certificate. */
  readonly description: string;
  /** Encrypted AND certificate-verified. */
  readonly verified: boolean;
  /** Where the trust root came from, for diagnostics. Never its contents. */
  readonly caSource: "environment" | "file" | "system" | "none";
}

/**
 * A certificate supplied through the environment.
 *
 * Base64 is the documented form, because certificate PEM is multi-line and
 * several deployment UIs and shell pipelines mangle newlines. Raw PEM is
 * accepted too — somebody pasting a certificate straight in is doing the
 * obvious thing, and refusing it would produce a confusing failure rather than
 * a safer one.
 *
 * MALFORMED MATERIAL FAILS LOUDLY. A value that does not decode to something
 * containing a PEM certificate header is a configuration error, and continuing
 * with it would mean falling back to a weaker trust root without saying so.
 */
export function parseCertMaterial(raw: string): string {
  const value = raw.trim();
  if (value === "") throw new Error(`${ROOT_CERT_B64_VAR} is set but empty.`);

  if (value.startsWith(PEM_HEADER)) return value;

  let decoded: string;
  try {
    decoded = Buffer.from(value, "base64").toString("utf8");
  } catch {
    throw new Error(`${ROOT_CERT_B64_VAR} is not valid base64.`);
  }

  if (!decoded.includes(PEM_HEADER)) {
    /**
     * Deliberately does not echo the value or the decoded bytes. A certificate
     * is not a password, but a diagnostic that prints whatever was in an
     * environment variable is a diagnostic that will one day print a password.
     */
    throw new Error(
      `${ROOT_CERT_B64_VAR} does not contain a PEM certificate once decoded.`,
    );
  }

  return decoded;
}

function isLoopback(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  } catch {
    return false;
  }
}

export function decideTls(input: {
  readonly url: string;
  readonly isProduction: boolean;
  readonly rootCertB64?: string | undefined;
  readonly rootCertPath?: string | undefined;
  readonly allowUnverified?: string | undefined;
  readonly readCert?: (path: string) => string;
}): TlsDecision {
  const read = input.readCert ?? ((path: string) => readFileSync(path, "utf8"));

  /**
   * A loopback connection does not cross a network anybody can sit on, and a
   * local Postgres usually has TLS off entirely. Encrypting to yourself is not
   * the control that matters here.
   */
  if (isLoopback(input.url)) {
    return {
      ssl: false,
      description: "TLS off (connection is to this machine)",
      verified: false,
      caSource: "none",
    };
  }

  /* --- 1. certificate material from the environment ---------------------- */
  if (input.rootCertB64 !== undefined && input.rootCertB64.trim() !== "") {
    const ca = parseCertMaterial(input.rootCertB64);
    return {
      ssl: { rejectUnauthorized: true, ca },
      description: `TLS verified against the certificate in ${ROOT_CERT_B64_VAR}`,
      verified: true,
      caSource: "environment",
    };
  }

  /* --- 2. certificate file on disk --------------------------------------- */
  if (input.rootCertPath !== undefined && input.rootCertPath.trim() !== "") {
    const ca = read(input.rootCertPath.trim());
    if (!ca.includes(PEM_HEADER)) {
      throw new Error(`${ROOT_CERT_VAR} points at a file with no PEM certificate in it.`);
    }
    return {
      ssl: { rejectUnauthorized: true, ca },
      description: `TLS verified against the certificate in ${ROOT_CERT_VAR}`,
      verified: true,
      caSource: "file",
    };
  }

  /* --- 3. development-only relaxation ------------------------------------ */
  const relaxed = (input.allowUnverified ?? "").toLowerCase() === "true";
  if (relaxed && !input.isProduction) {
    return {
      ssl: { rejectUnauthorized: false },
      description: `TLS encrypted but NOT verified (${ALLOW_UNVERIFIED_VAR} is set, development only)`,
      verified: false,
      caSource: "none",
    };
  }

  /* --- 4. verify against system roots ------------------------------------ */
  return {
    ssl: { rejectUnauthorized: true },
    description:
      relaxed && input.isProduction
        ? `TLS verified against system roots (${ALLOW_UNVERIFIED_VAR} is ignored in production)`
        : "TLS verified against system roots",
    verified: true,
    caSource: "system",
  };
}

/** The decision for the current process. */
export function tlsForUrl(url: string): TlsDecision {
  return decideTls({
    url,
    isProduction: process.env.NODE_ENV === "production",
    rootCertB64: process.env[ROOT_CERT_B64_VAR],
    rootCertPath: process.env[ROOT_CERT_VAR],
    allowUnverified: process.env[ALLOW_UNVERIFIED_VAR],
  });
}
