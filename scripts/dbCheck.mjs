#!/usr/bin/env node
/**
 * Is shared mode configured, and can we reach the database?
 *
 * PRINTS NOTHING SENSITIVE. Not the URL, not the host, not the user, not the
 * database name. The whole point is that its output is safe to paste anywhere,
 * including into a chat window while asking for help.
 *
 * Driver errors are surfaced as CLASS NAMES only, because `pg` puts the
 * connection string into the message of several of them.
 */
import { readFileSync } from "node:fs";
import pg from "pg";
import { loadEnvLocal } from "./loadEnv.mjs";

const { loaded, names } = loadEnvLocal();

const present = (name) => {
  const value = process.env[name];
  return value !== undefined && value.trim() !== "";
};

console.log(".env.local found        :", loaded ? "yes" : "no");
console.log("variable names present  :", names.length === 0 ? "(none)" : names.join(", "));
console.log("DATABASE_URL set        :", present("DATABASE_URL") ? "yes" : "NO");
console.log("APP_BASE_URL set        :", present("APP_BASE_URL") ? "yes" : "no");
console.log("ORKESTR_SHARED_MODE     :", process.env.ORKESTR_SHARED_MODE ?? "unset");

if (!present("DATABASE_URL")) {
  console.log("\nShared mode is OFF. The local product still works.");
  process.exit(1);
}

const url = process.env.DATABASE_URL;

/**
 * Shape facts only, so a misconfiguration is diagnosable without the value.
 * Whether TLS is being used is worth knowing; the host is not printed.
 */
let scheme = "unknown";
let looksLocal = false;
try {
  const parsed = new URL(url);
  scheme = parsed.protocol.replace(":", "");
  // Parsed, not substring-matched: "localhost.evil.example.com" is remote.
  looksLocal = ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
} catch {
  console.log("\nDATABASE_URL is set but is not a parseable URL.");
  process.exit(1);
}

console.log("connection scheme       :", scheme);
console.log("target                  :", looksLocal ? "local" : "remote");
const rootCert = process.env.PGSSLROOTCERT;
const relaxed = (process.env.PGSSL_ALLOW_UNVERIFIED ?? "").toLowerCase() === "true";
const ssl = looksLocal
  ? false
  : rootCert !== undefined && rootCert.trim() !== ""
    ? { rejectUnauthorized: true, ca: readFileSync(rootCert.trim(), "utf8") }
    : relaxed
      ? { rejectUnauthorized: false }
      : { rejectUnauthorized: true };

console.log(
  "TLS                     :",
  looksLocal
    ? "off (connection is to this machine)"
    : ssl.ca !== undefined
      ? "verified against PGSSLROOTCERT"
      : ssl.rejectUnauthorized
        ? "verified against system roots"
        : "encrypted, NOT verified (PGSSL_ALLOW_UNVERIFIED is set)",
);

const client = new pg.Client({ connectionString: url, ssl });

try {
  await client.connect();
  const { rows } = await client.query(
    "SELECT version() AS version, current_database() IS NOT NULL AS has_db",
  );
  const short = /^(PostgreSQL\s+[\d.]+)/.exec(rows[0]?.version ?? "")?.[1] ?? "PostgreSQL";
  console.log("\nconnected               : yes");
  console.log("server                  :", short);
  console.log("database reachable      :", rows[0]?.has_db === true ? "yes" : "no");
} catch (error) {
  const name = error instanceof Error ? error.constructor.name : "Error";
  console.log("\nconnected               : NO");
  console.log("failure                 :", name);

  /**
   * SQLSTATE is safe to print and is the only thing that says WHY. The
   * driver's message is not printed by default: for auth failures it embeds
   * the username, and for others it can embed the connection string.
   */
  const code = typeof error?.code === "string" ? error.code : undefined;
  const MEANINGS = {
    "28P01": "password authentication failed - the password in DATABASE_URL is wrong",
    "28000": "the server refused this user (check the username or its login rules)",
    "3D000": "that database name does not exist on the server",
    "53300": "too many connections - the server is at its limit",
    "08006": "connection failure at the transport level",
    "0A000": "the server rejected a connection option (often an SSL or pooler mismatch)",
    "XX000": "internal server error - with poolers this often means a missing URL option",
    ECONNREFUSED: "nothing is listening on that host and port",
    ENOTFOUND: "that hostname does not resolve",
    ETIMEDOUT: "the host did not answer - usually a firewall or an IP allow-list",
    SELF_SIGNED_CERT_IN_CHAIN:
      "the certificate is not signed by a root this machine trusts. Production: set PGSSLROOTCERT to the provider's root certificate. Local: set PGSSL_ALLOW_UNVERIFIED=true (ignored in production).",
  };
  if (code !== undefined) {
    console.log("sqlstate / code         :", code);
    console.log("likely meaning          :", MEANINGS[code] ?? "(unmapped)");
  }
  if (typeof error?.severity === "string") {
    console.log("severity                :", error.severity);
  }
  process.exit(1);
} finally {
  await client.end().catch(() => {});
}
