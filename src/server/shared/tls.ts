import "server-only";
import { readFileSync } from "node:fs";

/**
 * How the database connection is trusted.
 *
 * THE THING THIS FIXES. The first version used `rejectUnauthorized: false`
 * everywhere, which encrypts the connection and verifies nothing. That stops
 * somebody passively reading the wire and does not stop somebody sitting in the
 * middle of it — and the code said so in a comment, which is not a control.
 *
 * THE RULE: production always verifies. There is no environment variable, no
 * flag and no code path that turns verification off in production. A switch for
 * "trust anything" is a switch that ends up set, usually at 2am, usually
 * permanently.
 *
 * Development may relax it, but only when somebody asks in writing
 * (`PGSSL_ALLOW_UNVERIFIED=true`), and the reason that exists is honest: a
 * local Postgres with a self-signed certificate is a normal thing to develop
 * against, and refusing it would push people to weaken the production path
 * instead.
 *
 * Most managed Postgres providers present certificates signed by a public root
 * that Node already trusts, so verification simply works. `PGSSLROOTCERT`
 * exists for the ones that do not.
 */

export const ROOT_CERT_VAR = "PGSSLROOTCERT";
export const ALLOW_UNVERIFIED_VAR = "PGSSL_ALLOW_UNVERIFIED";

export type SslConfig =
  | false
  | {
      readonly rejectUnauthorized: boolean;
      readonly ca?: string;
    };

export interface TlsDecision {
  readonly ssl: SslConfig;
  /** Plain-English description. Safe to print: contains no host and no secret. */
  readonly description: string;
  /** True when the connection is encrypted AND the certificate is verified. */
  readonly verified: boolean;
}

function isLoopback(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  } catch {
    return false;
  }
}

/**
 * Decide how to connect.
 *
 * `readCert` is injectable so the tests can exercise every branch without a
 * certificate on disk.
 */
export function decideTls(input: {
  readonly url: string;
  readonly isProduction: boolean;
  readonly rootCertPath?: string | undefined;
  readonly allowUnverified?: string | undefined;
  readonly readCert?: (path: string) => string;
}): TlsDecision {
  const read = input.readCert ?? ((path: string) => readFileSync(path, "utf8"));

  /**
   * A loopback connection is not crossing a network anybody can sit on, and
   * local Postgres usually has TLS off entirely. Encrypting to yourself is not
   * the control that matters here.
   */
  if (isLoopback(input.url)) {
    return {
      ssl: false,
      description: "TLS off (connection is to this machine)",
      verified: false,
    };
  }

  if (input.rootCertPath !== undefined && input.rootCertPath.trim() !== "") {
    const ca = read(input.rootCertPath.trim());
    return {
      ssl: { rejectUnauthorized: true, ca },
      description: `TLS verified against the certificate in ${ROOT_CERT_VAR}`,
      verified: true,
    };
  }

  const relaxed = (input.allowUnverified ?? "").toLowerCase() === "true";

  if (relaxed && !input.isProduction) {
    return {
      ssl: { rejectUnauthorized: false },
      description: `TLS encrypted but NOT verified (${ALLOW_UNVERIFIED_VAR} is set, development only)`,
      verified: false,
    };
  }

  /**
   * Everything else verifies, including production with the flag set -- the
   * flag is ignored there rather than honoured, so a value copied from a
   * development environment cannot weaken a deployment.
   */
  return {
    ssl: { rejectUnauthorized: true },
    description:
      relaxed && input.isProduction
        ? `TLS verified against system roots (${ALLOW_UNVERIFIED_VAR} is ignored in production)`
        : "TLS verified against system roots",
    verified: true,
  };
}

/** The decision for the current process. */
export function tlsForUrl(url: string): TlsDecision {
  return decideTls({
    url,
    isProduction: process.env.NODE_ENV === "production",
    rootCertPath: process.env[ROOT_CERT_VAR],
    allowUnverified: process.env[ALLOW_UNVERIFIED_VAR],
  });
}
