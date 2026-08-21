import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  DEFAULT_MODEL_STUDIO_MODE,
  readModelStudioMode,
} from "@/adapters/modelStudio/config";

/**
 * The offline safety layer.
 *
 * Three things that must hold on a machine with no credentials, no network and
 * no configuration -- which is the state of every fresh checkout, and the state
 * the demo has to survive in.
 */

const ROOT = process.cwd();

describe("the kill switch reads closed", () => {
  it("defaults to disabled", () => {
    expect(DEFAULT_MODEL_STUDIO_MODE).toBe("disabled");
    expect(readModelStudioMode({})).toBe("disabled");
  });

  it("accepts the three real modes", () => {
    expect(readModelStudioMode({ MODEL_STUDIO_MODE: "disabled" })).toBe("disabled");
    expect(readModelStudioMode({ MODEL_STUDIO_MODE: "recorded" })).toBe("recorded");
    expect(readModelStudioMode({ MODEL_STUDIO_MODE: "live" })).toBe("live");
  });

  it("tolerates the casing and padding a human types", () => {
    expect(readModelStudioMode({ MODEL_STUDIO_MODE: "LIVE" })).toBe("live");
    expect(readModelStudioMode({ MODEL_STUDIO_MODE: "  Live  " })).toBe("live");
  });

  it("fails closed on anything it does not recognise", () => {
    // The failure mode of a typo should be a demo on fixtures, not a bill.
    for (const value of ["on", "true", "yes", "enabled", "LIVE!", "liv", "", "   ", "1"]) {
      expect(readModelStudioMode({ MODEL_STUDIO_MODE: value }), value).toBe("disabled");
    }
  });
});

describe("the preflight command", () => {
  const run = () =>
    execFileSync("node", [join(ROOT, "scripts", "preflight.mjs")], {
      encoding: "utf8",
      cwd: ROOT,
    });

  it("runs, and exits successfully with nothing configured", () => {
    // An unconfigured checkout is a working checkout. A non-zero exit here
    // would make a healthy repository look broken.
    expect(() => run()).not.toThrow();
  });

  it("reports the mode and whether live is possible", () => {
    const out = run();
    expect(out).toContain("Model Studio mode:");
    expect(out).toContain("Live calls enabled:");
    expect(out).toContain("Ready for live verification:");
  });

  it("says plainly that it makes no network request", () => {
    expect(run()).toContain("makes no network request");
  });

  it("names what is missing rather than leaving somebody guessing", () => {
    const out = run();
    expect(out).toContain("To reach live verification:");
    expect(out).toContain("MODEL_STUDIO_MODE=live");
  });

  it("prints no secret, and no value that could narrow one down", () => {
    const out = run();
    // Only ever the names and yes/no.
    expect(out).not.toMatch(/sk-[A-Za-z0-9]{6,}/);
    expect(out).not.toContain("Authorization");
    expect(out).not.toContain("Bearer");
    // The endpoint embeds the workspace id, so it is never printed.
    expect(out).not.toContain("maas.aliyuncs.com");
  });

  it("never reads the ignored environment file into its output", () => {
    // Even if one exists, nothing from it may be echoed.
    const out = run();
    if (existsSync(join(ROOT, ".env.local"))) {
      const secrets = readFileSync(join(ROOT, ".env.local"), "utf8")
        .split("\n")
        .map((l) => l.split("=")[1]?.trim() ?? "")
        .filter((v) => v.length > 6);
      for (const value of secrets) {
        expect(out, "preflight echoed a value from .env.local").not.toContain(value);
      }
    }
    expect(out).toContain("Orkestr Travel");
  });
});

describe("the secret gate", () => {
  it("passes on this repository", () => {
    expect(() =>
      execFileSync("node", [join(ROOT, "scripts", "checkSecrets.mjs")], {
        encoding: "utf8",
        cwd: ROOT,
      }),
    ).not.toThrow();
  });

  it("is wired into the gate that runs before a push", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts["check"]).toContain("check:secrets");
    // verify includes check, so the gate covers the build path too.
    expect(pkg.scripts["verify"]).toContain("check");
  });

  it("keeps the live commands out of the deterministic gate", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    for (const gate of ["check", "verify", "test"]) {
      const script = pkg.scripts[gate] ?? "";
      expect(script, gate).not.toContain("smoke:model-studio");
      expect(script, gate).not.toContain("eval:qwen");
      expect(script, gate).not.toContain("vitest.live.config");
    }
  });
});

describe("no recorded Model Studio result is claimed to exist", () => {
  /**
   * A sanitised test fixture is not a recording.
   *
   * `RECORDED_WEB` renders as "Recorded Model Studio result". Until a real call
   * has been made and sanitised, nothing may carry that label, and the registry
   * must not hand it out.
   */
  it("does not label the fixture research provider as a recording", () => {
    const registry = readFileSync(join(ROOT, "src", "adapters", "registry.ts"), "utf8");
    expect(registry).not.toMatch(/new FixtureResearchProvider\(\s*"RECORDED_WEB"\s*\)/);
    expect(registry).toMatch(/new FixtureResearchProvider\(\s*"LOCAL_FIXTURE"\s*\)/);
  });

  it("keeps RECORDED_WEB reachable in the model for when one does exist", () => {
    const evidence = readFileSync(join(ROOT, "src", "domain", "evidence.ts"), "utf8");
    expect(evidence).toContain('"RECORDED_WEB"');
  });
});
