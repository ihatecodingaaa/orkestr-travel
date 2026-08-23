import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  decideTls,
  ALLOW_UNVERIFIED_VAR,
  ROOT_CERT_VAR,
} from "@/server/shared/tls";

/**
 * How the database connection is trusted.
 *
 * The first version passed `rejectUnauthorized: false` everywhere, which
 * encrypts the connection and verifies nothing -- it stops somebody reading the
 * wire passively and does not stop somebody sitting in the middle of it. A
 * comment said so, which is not a control.
 *
 * These tests are the control. The one that matters most is that production
 * cannot be talked into relaxing, by any input.
 */

const REMOTE = "postgresql://user:pw@db.example.com:5432/orkestr";
const LOCAL = "postgresql://user:pw@localhost:5432/orkestr";

describe("production always verifies", () => {
  it("verifies against system roots with nothing configured", () => {
    const decision = decideTls({ url: REMOTE, isProduction: true });
    expect(decision.verified).toBe(true);
    expect(decision.ssl).not.toBe(false);
    if (decision.ssl !== false) expect(decision.ssl.rejectUnauthorized).toBe(true);
  });

  it("IGNORES the relax flag in production", () => {
    /**
     * The flag exists for local development against a self-signed Postgres.
     * A value copied from a developer's environment into a deployment must not
     * be able to weaken it -- which is why this is ignored rather than obeyed.
     */
    const decision = decideTls({
      url: REMOTE,
      isProduction: true,
      allowUnverified: "true",
    });
    expect(decision.verified).toBe(true);
    if (decision.ssl !== false) expect(decision.ssl.rejectUnauthorized).toBe(true);
    expect(decision.description).toMatch(/ignored in production/i);
  });

  it("has no input at all that produces an unverified production connection", () => {
    for (const allowUnverified of ["true", "TRUE", "yes", "1", "", undefined]) {
      const decision = decideTls({ url: REMOTE, isProduction: true, allowUnverified });
      expect(
        decision.ssl !== false && decision.ssl.rejectUnauthorized,
        `allowUnverified=${String(allowUnverified)} produced an unverified connection`,
      ).toBe(true);
    }
  });

  it("uses a supplied root certificate and still verifies", () => {
    const decision = decideTls({
      url: REMOTE,
      isProduction: true,
      rootCertPath: "/etc/ssl/provider-root.crt",
      readCert: () => "-----BEGIN CERTIFICATE-----\nfake\n-----END CERTIFICATE-----",
    });
    expect(decision.verified).toBe(true);
    if (decision.ssl !== false) {
      expect(decision.ssl.rejectUnauthorized).toBe(true);
      expect(decision.ssl.ca).toContain("BEGIN CERTIFICATE");
    }
    expect(decision.description).toContain(ROOT_CERT_VAR);
  });
});

describe("development", () => {
  it("relaxes only when explicitly asked, and says so", () => {
    const decision = decideTls({
      url: REMOTE,
      isProduction: false,
      allowUnverified: "true",
    });
    expect(decision.verified).toBe(false);
    if (decision.ssl !== false) expect(decision.ssl.rejectUnauthorized).toBe(false);
    expect(decision.description).toContain(ALLOW_UNVERIFIED_VAR);
    expect(decision.description).toMatch(/NOT verified/);
  });

  it("verifies by default, even in development", () => {
    const decision = decideTls({ url: REMOTE, isProduction: false });
    expect(decision.verified).toBe(true);
  });

  it("does not use TLS for a connection to this machine", () => {
    for (const url of [LOCAL, "postgresql://u:p@127.0.0.1:5432/db"]) {
      expect(decideTls({ url, isProduction: false }).ssl).toBe(false);
    }
  });

  it("a hostname that merely contains 'localhost' is still remote", () => {
    // `url.includes("localhost")` was the old test, and this would have fooled it.
    const decision = decideTls({
      url: "postgresql://u:p@localhost.evil.example.com:5432/db",
      isProduction: true,
    });
    expect(decision.ssl).not.toBe(false);
    expect(decision.verified).toBe(true);
  });
});

describe("certificate material stays on the server", () => {
  const ROOT = process.cwd();

  function filesUnder(dir: string, extensions: readonly string[]): readonly string[] {
    if (!existsSync(dir)) return [];
    const out: string[] = [];
    const walk = (current: string): void => {
      for (const entry of readdirSync(current).sort()) {
        const full = join(current, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (extensions.some((ext) => entry.endsWith(ext))) out.push(full);
      }
    };
    walk(dir);
    return out;
  }

  it("no certificate is embedded anywhere in the source", () => {
    for (const file of filesUnder(join(ROOT, "src"), [".ts", ".tsx"])) {
      const source = readFileSync(file, "utf8");
      // The test above uses a fake, which is why the check excludes tests.
      expect(source, `${file} embeds a certificate`).not.toContain("-----BEGIN CERTIFICATE-----");
      expect(source, `${file} embeds a private key`).not.toContain("-----BEGIN PRIVATE KEY-----");
    }
  });

  it("only the server reads the certificate variable", () => {
    const readers = filesUnder(join(ROOT, "src"), [".ts", ".tsx"]).filter((file) =>
      readFileSync(file, "utf8").includes(ROOT_CERT_VAR),
    );
    expect(readers.length).toBeGreaterThan(0);
    for (const file of readers) {
      expect(file.replace(/\\/g, "/"), `${file} reads ${ROOT_CERT_VAR}`).toContain(
        "/server/shared/",
      );
    }
  });

  it("there is no public-prefixed variant of any TLS or database variable", () => {
    for (const file of filesUnder(join(ROOT, "src"), [".ts", ".tsx"])) {
      const source = readFileSync(file, "utf8");
      for (const forbidden of [
        "NEXT_PUBLIC_PGSSL",
        "NEXT_PUBLIC_DATABASE",
        "NEXT_PUBLIC_PGSSLROOTCERT",
      ]) {
        expect(source, `${file} exposes ${forbidden}`).not.toContain(forbidden);
      }
    }
  });
});
