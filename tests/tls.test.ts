import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { inviteUrl, isUsableBase } from "@/server/shared/mode";
import {
  decideTls,
  parseCertMaterial,
  ALLOW_UNVERIFIED_VAR,
  ROOT_CERT_VAR,
  ROOT_CERT_B64_VAR,
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
    /**
     * A BEGIN marker on its own is not a certificate -- `tls.ts` holds one as a
     * constant so it can VALIDATE supplied material. What must never appear is
     * an actual certificate: a BEGIN/END pair with a base64 body between them.
     */
    const embedded = /-----BEGIN [A-Z ]*(?:CERTIFICATE|PRIVATE KEY)-----[\s\S]{40,}?-----END/;

    for (const file of filesUnder(join(ROOT, "src"), [".ts", ".tsx"])) {
      const source = readFileSync(file, "utf8");
      expect(source, `${file} embeds a certificate or key`).not.toMatch(embedded);
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
        "NEXT_PUBLIC_PGSSLROOTCERT_B64",
      ]) {
        expect(source, `${file} exposes ${forbidden}`).not.toContain(forbidden);
      }
    }
  });
});

describe("certificate material from the environment", () => {
  // A fake, and deliberately not a real certificate: nothing here needs one.
  const PEM = `-----BEGIN CERTIFICATE-----
ZmFrZS1jZXJ0aWZpY2F0ZS1ib2R5
-----END CERTIFICATE-----`;
  const B64 = Buffer.from(PEM, "utf8").toString("base64");

  it("decodes base64 into a certificate", () => {
    expect(parseCertMaterial(B64)).toContain("BEGIN CERTIFICATE");
  });

  it("accepts raw PEM pasted straight in", () => {
    /**
     * Base64 is the documented form because several deployment UIs mangle
     * multi-line values. Somebody pasting the certificate itself is doing the
     * obvious thing, and refusing it would produce a confusing failure rather
     * than a safer one.
     */
    expect(parseCertMaterial(PEM)).toContain("BEGIN CERTIFICATE");
  });

  it("refuses material that is not a certificate, rather than continuing", () => {
    // Valid base64, wrong contents -- the dangerous case, because it decodes.
    const notACert = Buffer.from("hello world", "utf8").toString("base64");
    expect(() => parseCertMaterial(notACert)).toThrow(/PEM certificate/i);
    expect(() => parseCertMaterial("   ")).toThrow();
  });

  it("never puts the material into its own error message", () => {
    const secretish = Buffer.from("SUPER-SECRET-VALUE", "utf8").toString("base64");
    try {
      parseCertMaterial(secretish);
      throw new Error("should have refused");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain("SUPER-SECRET-VALUE");
      expect(message).not.toContain(secretish);
    }
  });

  it("environment material takes precedence over a file on disk", () => {
    /**
     * So a deployment cannot be silently altered by a path that happens to
     * exist in an image.
     */
    const decision = decideTls({
      url: REMOTE,
      isProduction: true,
      rootCertB64: B64,
      rootCertPath: "/etc/ssl/some-other-root.crt",
      readCert: () => {
        throw new Error("the file must not be read when environment material is set");
      },
    });
    expect(decision.verified).toBe(true);
    expect(decision.caSource).toBe("environment");
    expect(decision.description).toContain(ROOT_CERT_B64_VAR);
  });

  it("still verifies in production when the material is malformed — by refusing", () => {
    expect(() =>
      decideTls({
        url: REMOTE,
        isProduction: true,
        rootCertB64: Buffer.from("not a certificate", "utf8").toString("base64"),
      }),
    ).toThrow();
  });

  it("reports where the trust root came from, and never its contents", () => {
    const fromEnv = decideTls({ url: REMOTE, isProduction: true, rootCertB64: B64 });
    const fromSystem = decideTls({ url: REMOTE, isProduction: true });
    const local = decideTls({ url: LOCAL, isProduction: false });

    expect(fromEnv.caSource).toBe("environment");
    expect(fromSystem.caSource).toBe("system");
    expect(local.caSource).toBe("none");

    for (const decision of [fromEnv, fromSystem, local]) {
      expect(decision.description).not.toContain("BEGIN CERTIFICATE");
    }
  });
});

describe("the canonical application origin", () => {
  /**
   * An invite link is a bearer credential, so where it points matters as much
   * as who holds it. In production the origin comes only from APP_BASE_URL --
   * never from the request -- because `Host` is attacker-controlled: an
   * organiser could be served a link pointing at a host of somebody else's
   * choosing, press Copy, and hand the group's tokens away.
   */
  const TOKEN = "t".repeat(43);

  /**
   * `NODE_ENV` is typed read-only, and rightly so -- production code must not
   * reassign it. A test that exercises the production branch has to, so it goes
   * through the environment object explicitly rather than via a cast that would
   * also permit it in application code.
   */
  const setNodeEnv = (value: string): void => {
    Object.defineProperty(process.env, "NODE_ENV", {
      value,
      configurable: true,
      writable: true,
      enumerable: true,
    });
  };

  it("uses the configured origin in production", () => {
    setNodeEnv("production");
    process.env.APP_BASE_URL = "https://orkestr.example";
    expect(inviteUrl(TOKEN)).toBe(`https://orkestr.example/join/${TOKEN}`);
  });

  it("REFUSES to build a production link from the request origin", () => {
    setNodeEnv("production");
    delete process.env.APP_BASE_URL;
    // Even handed a plausible origin, production will not use it.
    expect(inviteUrl(TOKEN, "https://attacker.example")).toBeUndefined();
  });

  it("refuses a non-https public origin, configured or not", () => {
    setNodeEnv("production");
    process.env.APP_BASE_URL = "http://orkestr.example";
    expect(inviteUrl(TOKEN)).toBeUndefined();
  });

  it("allows a configured loopback origin even in production mode", () => {
    /**
     * Running a production build locally is a legitimate thing to do, and
     * APP_BASE_URL is chosen by whoever deployed the app -- unlike a request
     * host, it is not attacker-controlled. The restriction that matters is on
     * the SOURCE, and it is tested above.
     */
    setNodeEnv("production");
    process.env.APP_BASE_URL = "http://localhost:3000";
    expect(inviteUrl(TOKEN)).toBe(`http://localhost:3000/join/${TOKEN}`);
  });

  it("allows plain http on loopback in development only", () => {
    setNodeEnv("development");
    delete process.env.APP_BASE_URL;
    expect(inviteUrl(TOKEN, "http://localhost:3000")).toContain("http://localhost:3000/join/");
    // Not any http origin -- only the machine the developer is on.
    expect(inviteUrl(TOKEN, "http://somewhere.example")).toBeUndefined();
  });

  it("judges a base the same way wherever it came from", () => {
    expect(isUsableBase("https://orkestr.example")).toBe(true);
    expect(isUsableBase("http://orkestr.example")).toBe(false);
    expect(isUsableBase("http://localhost:3000")).toBe(true);
    expect(isUsableBase("http://localhost.evil.example")).toBe(false);
    expect(isUsableBase("javascript:alert(1)")).toBe(false);
    expect(isUsableBase("not a url")).toBe(false);
  });
});
