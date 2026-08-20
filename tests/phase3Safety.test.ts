import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { asTravellerId, asTripId } from "@/domain/index.js";
import { planTravelWaves } from "@/core/waves/engine.js";
import { repairPlan } from "@/core/repair/repair.js";
import { proposeCompromises } from "@/core/compromise/engine.js";
import { resetFixtureCounters } from "@/fixtures/builders.js";
import { familyOffers, familySeven } from "@/fixtures/waveScenarios.js";
import { heroGroupSix, heroGroupSeven, heroOffers } from "@/fixtures/repairScenarios.js";

const TRIP = asTripId("TRIP-001");

beforeEach(() => {
  resetFixtureCounters();
});

/** Every .ts file under src/core, which must stay pure. */
function coreSources(): readonly string[] {
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir).sort()) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith(".ts")) files.push(full);
    }
  };
  walk(join(process.cwd(), "src", "core"));
  return files;
}

/** Strip comments so a rule about code is not tripped by prose explaining it. */
function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
}

describe("deterministic core purity", () => {
  it("reads no clock anywhere in src/core", () => {
    for (const file of coreSources()) {
      const code = codeOnly(readFileSync(file, "utf8"));
      expect(code, `${file} reads the clock`).not.toMatch(/Date\.now|new Date\(|Date\.parse/);
    }
  });

  it("uses no randomness anywhere in src/core", () => {
    for (const file of coreSources()) {
      const code = codeOnly(readFileSync(file, "utf8"));
      expect(code, `${file} uses randomness`).not.toMatch(/Math\.random|randomUUID|crypto\./);
    }
  });

  it("makes no network call anywhere in src/core", () => {
    for (const file of coreSources()) {
      const code = codeOnly(readFileSync(file, "utf8"));
      expect(code, `${file} touches the network`).not.toMatch(
        /\bfetch\(|axios|XMLHttpRequest|node:http|require\(['"]https?/,
      );
    }
  });

  it("calls no model or AI service anywhere in src/core", () => {
    for (const file of coreSources()) {
      const code = codeOnly(readFileSync(file, "utf8"));
      expect(code, `${file} references a model provider`).not.toMatch(
        /openai|dashscope|anthropic|qwen|completion\(/i,
      );
    }
  });

  it("does no floating-point arithmetic on money", () => {
    for (const file of coreSources()) {
      const code = codeOnly(readFileSync(file, "utf8"));
      expect(code, `${file} divides a money amount`).not.toMatch(/amountMinor\s*\//);
      expect(code, `${file} uses parseFloat or toFixed`).not.toMatch(/parseFloat|toFixed/);
    }
  });
});

describe("behavioural safety guarantees", () => {
  const heroOpts = (group: readonly { id: string }[]) => ({
    tripId: TRIP,
    planningTravellerIds: group.map((t) => asTravellerId(t.id)),
  });

  it("never relaxes a HARD constraint, in any proposal", () => {
    resetFixtureCounters();
    const group = familySeven();
    const hardIds = new Set(
      group.flatMap((t) => t.constraints.filter((c) => c.strength === "HARD").map((c) => c.id as string)),
    );
    expect(hardIds.size).toBeGreaterThan(0);

    const result = proposeCompromises(group, familyOffers(), heroOpts(group));
    if (result.ok) {
      for (const proposal of result.proposals) {
        for (const relaxation of proposal.relaxations) {
          expect(hardIds.has(relaxation.constraintId), "a hard constraint was relaxed").toBe(false);
        }
      }
    }
  });

  it("keeps the family fixture's assistance requirement unresolved", () => {
    // Phase 2 established this uncertainty. Phase 3 must not quietly resolve it.
    resetFixtureCounters();
    const group = familySeven();
    const plan = planTravelWaves(group, familyOffers(), heroOpts(group));
    if (!plan.ok) throw new Error("plan failed");

    resetFixtureCounters();
    const group2 = familySeven();
    const result = repairPlan(group2, familyOffers(), {
      tripId: TRIP,
      event: { type: "TRAVELLER_JOINED", travellerId: asTravellerId("T-001") },
      previousPlan: plan.selected,
      planningTravellerIds: group2.map((t) => asTravellerId(t.id)),
    });

    expect(result.unresolved.length).toBeGreaterThan(0);
    expect(result.unresolved.some((u) => u.unknownReason === "DEFERRED_TO_LATER_PHASE")).toBe(true);
    expect(result.repairedPlan?.state).toBe("UNRESOLVED");
  });

  it("never claims a seat exists on any flight", () => {
    resetFixtureCounters();
    const offers = heroOffers();
    const six = heroGroupSix();
    const before = planTravelWaves(six, offers, heroOpts(six));
    if (!before.ok) throw new Error("plan failed");

    resetFixtureCounters();
    const offers2 = heroOffers();
    const six2 = heroGroupSix();
    const baseline = planTravelWaves(six2, offers2, heroOpts(six2));
    if (!baseline.ok) throw new Error("plan failed");
    const seven = heroGroupSeven();
    const result = repairPlan(seven, offers2, {
      tripId: TRIP,
      event: { type: "TRAVELLER_JOINED", travellerId: asTravellerId("T-007") },
      previousPlan: baseline.selected,
      planningTravellerIds: seven.map((t) => asTravellerId(t.id)),
    });

    expect(result.reverificationRequired.length).toBeGreaterThan(0);
    const text = JSON.stringify(result.reverificationRequired).toLowerCase();
    expect(text).toContain("logically compatible");
    expect(text).not.toContain("seat is available");
    expect(text).not.toContain("capacity confirmed");
  });

  it("never turns an UNKNOWN into a satisfied requirement", () => {
    resetFixtureCounters();
    const group = familySeven();
    const plan = planTravelWaves(group, familyOffers(), heroOpts(group));
    if (!plan.ok) throw new Error("plan failed");

    const satisfiedIds = new Set(
      plan.selected.waves.flatMap((w) => w.softViolations.map((v) => v.constraintId as string)),
    );
    for (const unknown of plan.selected.unresolved) {
      expect(satisfiedIds.has(unknown.constraintId as string)).toBe(false);
    }
  });

  it("produces the same repair for the same input, every time", () => {
    const run = (): string => {
      resetFixtureCounters();
      const offers = heroOffers();
      const six = heroGroupSix();
      const baseline = planTravelWaves(six, offers, heroOpts(six));
      if (!baseline.ok) throw new Error("plan failed");
      const seven = heroGroupSeven();
      return JSON.stringify(
        repairPlan(seven, offers, {
          tripId: TRIP,
          event: { type: "TRAVELLER_JOINED", travellerId: asTravellerId("T-007") },
          previousPlan: baseline.selected,
          planningTravellerIds: seven.map((t) => asTravellerId(t.id)),
        }),
      );
    };
    expect(new Set([run(), run(), run()]).size).toBe(1);
  });

  it("reports the search bound rather than presenting a partial search as complete", () => {
    // The family scenario has a real branching factor (six units, four flights),
    // so a bound of one genuinely stops the search early. The hero scenario has
    // exactly one possible plan and would complete within any bound, which would
    // make this assertion vacuous.
    resetFixtureCounters();
    const offers = familyOffers();
    const group = familySeven();
    const baseline = planTravelWaves(group, offers, heroOpts(group));
    if (!baseline.ok) throw new Error("plan failed");

    const result = repairPlan(group, offers, {
      tripId: TRIP,
      event: { type: "TRAVELLER_JOINED", travellerId: asTravellerId("T-007") },
      previousPlan: baseline.selected,
      planningTravellerIds: group.map((t) => asTravellerId(t.id)),
      maxPlansExplored: 1,
    });
    expect(result.searchLimitReached).toBe(true);
    expect(result.status).toBe("SEARCH_LIMIT_REACHED");
  });

  it("does not claim a bound was hit when the search completed", () => {
    resetFixtureCounters();
    const offers = familyOffers();
    const group = familySeven();
    const baseline = planTravelWaves(group, offers, heroOpts(group));
    if (!baseline.ok) throw new Error("plan failed");
    const result = repairPlan(group, offers, {
      tripId: TRIP,
      event: { type: "TRAVELLER_JOINED", travellerId: asTravellerId("T-001") },
      previousPlan: baseline.selected,
      planningTravellerIds: group.map((t) => asTravellerId(t.id)),
    });
    expect(result.searchLimitReached).toBe(false);
    expect(result.status).not.toBe("SEARCH_LIMIT_REACHED");
  });
});

describe("Phase 4 provider and journey safety", () => {
  it("keeps every vendor name out of generic business logic", () => {
    // The provider boundary exists so nothing above it knows who it is talking
    // to. A vendor name in core logic is that boundary already leaking.
    for (const file of coreSources()) {
      if (file.includes("providers")) continue; // adapters may name themselves
      const code = codeOnly(readFileSync(file, "utf8"));
      expect(code, `${file} names Atlas`).not.toMatch(/\bAtlas\b/i);
      expect(code, `${file} names ATRIP`).not.toMatch(/\bATRIP\b/i);
    }
  });

  it("keeps the provider free of fare, budget and feasibility rules", () => {
    // A provider supplies facts. Deciding what they mean belongs to exactly one
    // place, and a second copy in an adapter could disagree with it.
    const provider = readFileSync(
      join(process.cwd(), "src", "core", "providers", "mockFlightProvider.ts"),
      "utf8",
    );
    const code = codeOnly(provider);
    expect(code).not.toMatch(/budget/i);
    expect(code).not.toMatch(/feasib/i);
    expect(code).not.toMatch(/constraint/i);
  });

  it("hard-codes no airport or immigration durations in the composer", () => {
    // Every such figure is an assumption supplied by the caller and carries a
    // source marker. Freezing one here would put an invented number into a plan
    // people arrange their lives around.
    const composer = readFileSync(
      join(process.cwd(), "src", "core", "journey", "composer.ts"),
      "utf8",
    );
    const code = codeOnly(composer);
    expect(code).not.toMatch(/=\s*120\b|=\s*90\b|=\s*60\s*;/);
    expect(code).toMatch(/assumptions\./);
  });

  it("marks every fixture assumption as an assumption", () => {
    const assumptions = readFileSync(
      join(process.cwd(), "src", "core", "journey", "assumptions.ts"),
      "utf8",
    );
    expect(assumptions).toContain("LOCAL_FIXTURE_ASSUMPTION");
  });

  it("labels every fixture flight offer as LOCAL_FIXTURE", () => {
    const builders = readFileSync(
      join(process.cwd(), "src", "fixtures", "builders.ts"),
      "utf8",
    );
    expect(builders).toContain('evidenceState: "LOCAL_FIXTURE"');
    // No override parameter exists, so a fixture cannot claim another source.
    expect(builders).not.toMatch(/evidenceState:\s*options\./);
  });
});
