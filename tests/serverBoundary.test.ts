import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

/**
 * The server boundary.
 *
 * `import "server-only"` makes the BUILD fail if an adapter is pulled into a
 * client component, which is the primary control. These tests are the second
 * layer, because the first one is a convention enforced by a bundler and the
 * cost of it being wrong is a credential in a browser bundle, permanently, for
 * everybody who ever loaded the page.
 *
 * This file checks the SOURCE GRAPH: no client component reaches an adapter.
 * The built output itself is checked in `tests/bundle/browserBundle.test.ts`,
 * which runs after the build.
 */

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

function read(file: string): string {
  return readFileSync(file, "utf8");
}

/** Files carrying the "use client" directive. */
function clientComponents(): readonly string[] {
  return [...filesUnder(join(ROOT, "app"), [".ts", ".tsx"]), ...filesUnder(join(ROOT, "src"), [".ts", ".tsx"])].filter(
    (file) => /^\s*["']use client["']/m.test(read(file).split("\n").slice(0, 3).join("\n")),
  );
}

describe("server-only modules stay on the server", () => {
  it("marks every Model Studio adapter server-only", () => {
    const adapters = filesUnder(join(ROOT, "src", "adapters", "modelStudio"), [".ts"]).filter(
      (file) => !file.includes("prompts") && !file.includes("responsesShape") && !file.includes("researchPayload"),
    );
    expect(adapters.length).toBeGreaterThan(0);
    for (const file of adapters) {
      expect(read(file), `${file} is not marked server-only`).toMatch(/^import "server-only";/m);
    }
  });

  it("marks the provider registry and the diagnostics logger server-only", () => {
    for (const file of ["src/adapters/registry.ts", "src/adapters/diagnostics.ts"]) {
      expect(read(join(ROOT, file)), file).toMatch(/^import "server-only";/m);
    }
  });

  it("has at least one client component, so this suite is not vacuous", () => {
    expect(clientComponents().length).toBeGreaterThan(0);
  });

  it("lets no client component import an adapter, a config or a registry", () => {
    for (const file of clientComponents()) {
      const source = read(file);
      expect(source, `${file} imports an adapter`).not.toMatch(/from\s+["']@\/adapters/);
      expect(source, `${file} imports the registry`).not.toMatch(/resolveProviders/);
      expect(source, `${file} reads the environment`).not.toMatch(/process\.env/);
    }
  });

  it("names no credential in any client component", () => {
    for (const file of clientComponents()) {
      expect(read(file), file).not.toContain("DASHSCOPE_API_KEY");
    }
  });
});

describe("no secret is exposed through the public prefix", () => {
  const sources = [
    ...filesUnder(join(ROOT, "app"), [".ts", ".tsx"]),
    ...filesUnder(join(ROOT, "src"), [".ts", ".tsx"]),
  ];

  it("never prefixes a Model Studio variable with NEXT_PUBLIC_", () => {
    // That prefix inlines a value into the browser bundle at build time, and
    // rotating the key is the only remedy afterwards.
    for (const file of [...sources, join(ROOT, ".env.example")]) {
      const source = read(file);
      expect(source, `${file}`).not.toMatch(/NEXT_PUBLIC_[A-Z_]*(?:KEY|SECRET|TOKEN|DASHSCOPE|WORKSPACE)/);
    }
  });

  it("reads the credential in exactly one module", () => {
    const readers = sources.filter((file) => read(file).includes("DASHSCOPE_API_KEY"));
    expect(readers.map((f) => f.replace(ROOT, "").replace(/\\/g, "/"))).toEqual([
      "/src/adapters/modelStudio/config.ts",
    ]);
  });

  it("dereferences the key value in exactly one module", () => {
    // config.ts declares the field; transport.ts is the only place that reads
    // it, and it reads it to build one Authorization header. A third file
    // touching `.apiKey` would be a new place a secret could escape from.
    const users = sources.filter((file) => /\.apiKey\b/.test(read(file)));
    const paths = users.map((f) => f.replace(ROOT, "").replace(/\\/g, "/")).sort();
    expect(paths).toEqual(["/src/adapters/modelStudio/transport.ts"]);
  });
});

describe("shared-trip server modules stay on the server", () => {
  const sharedServer = filesUnder(join(ROOT, "src", "server", "shared"), [".ts"]);

  it("every one of them declares server-only", () => {
    expect(sharedServer.length).toBeGreaterThan(0);
    for (const file of sharedServer) {
      expect(read(file), `${file} is missing server-only`).toMatch(/import\s+["']server-only["']/);
    }
  });

  it("no client component imports one", () => {
    /**
     * `server-only` already makes the BUILD fail on this, which is the primary
     * control. This is the second layer, because the first is a convention
     * enforced by a bundler and the cost of it being wrong is a database URL
     * or a token helper in a browser bundle.
     */
    for (const file of clientComponents()) {
      const source = read(file);
      expect(source, `${file} imports a shared server module`).not.toMatch(
        /from\s+["']@\/server/,
      );
      expect(source, `${file} imports the postgres driver`).not.toMatch(/from\s+["']pg["']/);
    }
  });

  it("the pure shared core imports no server module and no driver", () => {
    /**
     * core/shared holds the authority and privacy rules. They must be testable
     * without a database, and reachable from anywhere -- so nothing in there
     * may reach for a connection.
     */
    const core = filesUnder(join(ROOT, "src", "core", "shared"), [".ts"]);
    expect(core.length).toBeGreaterThan(0);
    for (const file of core) {
      const source = read(file);
      expect(source, `${file} imports a server module`).not.toMatch(/from\s+["'].*\/server\//);
      expect(source, `${file} imports the postgres driver`).not.toMatch(/from\s+["']pg["']/);
      expect(source, `${file} declares server-only`).not.toMatch(/["']server-only["']/);
    }
  });

  it("keeps the database variable out of anything with a public prefix", () => {
    for (const file of filesUnder(join(ROOT, "src"), [".ts", ".tsx"])) {
      expect(read(file), `${file} exposes the database URL publicly`).not.toContain(
        "NEXT_PUBLIC_DATABASE",
      );
    }
  });
});

describe("the deterministic core knows nothing about any vendor", () => {
  const coreFiles = filesUnder(join(ROOT, "src", "core"), [".ts"]);

  it("imports no adapter from src/core", () => {
    // The core decides; adapters fetch. An import in this direction would let a
    // network call reach the inside of a pure function.
    for (const file of coreFiles) {
      expect(read(file), `${file} imports an adapter`).not.toMatch(/from\s+["'].*adapters/);
    }
  });

  it("names no model provider in src/core", () => {
    for (const file of coreFiles) {
      const code = read(file)
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .split("\n")
        .filter((line) => !line.trim().startsWith("//"))
        .join("\n");
      expect(code, `${file} names a model provider`).not.toMatch(
        /qwen|dashscope|model studio|openai/i,
      );
    }
  });
});

/**
 * The built client output is checked in `tests/bundle/browserBundle.test.ts`.
 *
 * It lived here behind `it.skipIf(!built)` and silently skipped on a clean
 * checkout -- which is the case it existed to cover. It now runs after
 * `next build` in `npm run verify`, where a missing build is a failure.
 */
