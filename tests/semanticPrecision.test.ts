import { describe, it, expect } from "vitest";
import { runExtractionPipeline } from "@/core/intent/pipeline";
import { assessStrength, markersIn, numbersMentionedIn } from "@/core/intent/semanticPolicy";
import { asIsoDateTime } from "@/domain/time";
import type { ExtractionResult } from "@/domain/extraction";

/**
 * Correct evidence is not a correct claim.
 *
 * Source grounding settled "did somebody write these words". It did not settle
 * "do those words support THIS structured fact, at THIS strength", and three
 * real defects lived in that gap:
 *
 *   "I'd like to keep it around 400 SGD ... but I could stretch a bit"
 *      became a HARD ceiling of 400.
 *   "I need step-free access the whole way through"
 *      became the same requirement twice on screen.
 *   "I can only get leave from the 24th"
 *      became a window ending on the 31st, in the year 2024.
 *
 * Every one quoted a real sentence. None of the sentences said what was built
 * from them. These tests are the corpus for the rule that closes that gap: a
 * claim may never be stronger than the words behind it.
 *
 * Every discussion here is invented.
 */

const NOW = asIsoDateTime("2026-08-01T09:00:00+08:00");

function run(discussion: string, response: unknown): ExtractionResult {
  return runExtractionPipeline({
    rawResponse: JSON.stringify(response),
    discussion,
    mapping: { now: NOW, idPrefix: "REQ-1", extractedBy: "test-provider" },
    diagnostics: {
      requestId: "REQ-1",
      operation: "EXTRACT_INTENT",
      providerName: "test",
      model: "test-model",
      promptVersion: "orkestr-intent-v3",
      durationMs: 1,
      startedAt: NOW,
    },
  });
}

const base = {
  relationships: [],
  assistanceNeeds: [],
  preferences: [],
  ambiguities: [],
};

const person = (ref: string, name: string, evidence: string[]) => ({
  ref,
  displayName: name,
  certainty: "EXPLICIT" as const,
  evidence,
});

/** One constraint, proposed as firmly as the model liked. */
function withConstraint(
  discussion: string,
  value: unknown,
  proposedStrength: string,
  evidence: string[],
  certainty = "EXPLICIT",
): ExtractionResult {
  return run(discussion, {
    travellers: [person("P1", "Ama", ["M01.S01"])],
    ...base,
    constraints: [{ ownerRef: "P1", value, proposedStrength, certainty, evidence }],
  });
}

const strengthOf = (result: ExtractionResult): string | undefined => {
  if (result.outcome !== "SUCCESS") return undefined;
  return result.mapped.constraints[0]?.strength;
};

/* --------------------------------------------------------------- A and B */

describe("A and B. a hedge is not a limit", () => {
  const stretchable = "Ama: I'd like to keep it around 400 SGD if we can, but I could stretch a bit.";
  const absolute = "Ama: My absolute ceiling is 600 SGD each, I cannot go above that.";

  it("refuses to harden a stretchable budget, however the model labelled it", () => {
    const result = withConstraint(
      stretchable,
      { kind: "BUDGET_MAX", amountMajor: 400, currency: "SGD" },
      "HARD",
      ["M01.S01"],
    );
    expect(strengthOf(result)).toBe("SOFT");
  });

  it("says why, in words a person can act on", () => {
    const result = withConstraint(
      stretchable,
      { kind: "BUDGET_MAX", amountMajor: 400, currency: "SGD" },
      "HARD",
      ["M01.S01"],
    );
    if (result.outcome !== "SUCCESS") throw new Error("expected success");
    const softened = result.warnings.find((w) => w.effect === "SOFTENED_UNSUPPORTED_STRENGTH");
    expect(softened).toBeDefined();
    expect(softened?.reason).toMatch(/preference rather than a limit|state no limit/i);
    expect(softened?.reason).not.toMatch(/SOFT|HARD|CONSTRAINT/);
  });

  it("keeps a genuine ceiling hard", () => {
    const result = withConstraint(
      absolute,
      { kind: "BUDGET_MAX", amountMajor: 600, currency: "SGD" },
      "HARD",
      ["M01.S01"],
    );
    expect(strengthOf(result)).toBe("HARD");
  });

  it("keeps the amount, and only moves the strength", () => {
    const result = withConstraint(
      stretchable,
      { kind: "BUDGET_MAX", amountMajor: 400, currency: "SGD" },
      "HARD",
      ["M01.S01"],
    );
    if (result.outcome !== "SUCCESS") throw new Error("expected success");
    const value = result.mapped.constraints[0]?.value;
    expect(value?.kind).toBe("BUDGET_MAX");
  });
});

/* --------------------------------------------------------------- C and D */

describe("C and D. the same distinction for times", () => {
  it('"ideally nothing before 9" stays a preference', () => {
    const result = withConstraint(
      "Bo: Early mornings are rough for me, ideally nothing before 9.",
      { kind: "DEPART_NOT_BEFORE", minutesOfDay: 540 },
      "HARD",
      ["M01.S01"],
    );
    expect(strengthOf(result)).toBe("SOFT");
  });

  it('"I cannot leave before 9" is a requirement', () => {
    const result = withConstraint(
      "Bo: I cannot leave before 9.",
      { kind: "DEPART_NOT_BEFORE", minutesOfDay: 540 },
      "HARD",
      ["M01.S01"],
    );
    expect(strengthOf(result)).toBe("HARD");
  });
});

/* --------------------------------------------------------------- E and F */

describe("E and F. the same distinction for connections", () => {
  it('"I\'d rather fly direct" is a preference', () => {
    const result = withConstraint(
      "Nadia: I'd rather not do a connection if we can help it, direct is better.",
      { kind: "MAX_STOPS", maxStops: 0 },
      "HARD",
      ["M01.S01"],
    );
    expect(strengthOf(result)).toBe("SOFT");
  });

  it('"I will only take a direct flight" is a requirement', () => {
    const result = withConstraint(
      "Nadia: I will only take a direct flight.",
      { kind: "MAX_STOPS", maxStops: 0 },
      "HARD",
      ["M01.S01"],
    );
    expect(strengthOf(result)).toBe("HARD");
  });
});

/* --------------------------------------------------------------- G and H */

describe("G and H. a taste is not a requirement", () => {
  it("a liking stays soft even when proposed as a requirement", () => {
    const result = withConstraint(
      "Cai: I like vegetarian places.",
      { kind: "FREE_TEXT_REQUIREMENT", text: "vegetarian food" },
      "HARD",
      ["M01.S01"],
    );
    expect(strengthOf(result)).toBe("SOFT");
  });

  it("a stated need is allowed to be a requirement", () => {
    const result = withConstraint(
      "Cai: I'm vegetarian and I need vegetarian food.",
      { kind: "FREE_TEXT_REQUIREMENT", text: "vegetarian food" },
      "HARD",
      ["M01.S01"],
    );
    expect(strengthOf(result)).toBe("HARD");
  });
});

/* ------------------------------------------------------ ACCESSIBILITY */

describe("accessibility is exempt, and the asymmetry is deliberate", () => {
  /**
   * Everywhere else, treating a requirement as a preference is the safe error.
   * Here it is not: a route booked without step-free access costs somebody the
   * journey, while an over-firm reading costs a narrower search.
   */
  it("a hedged access need is still treated as a requirement", () => {
    const result = withConstraint(
      "Gita: I'd prefer step-free access the whole way through.",
      { kind: "ASSISTANCE_REQUIRED", need: "STEP_FREE_ACCESS" },
      "HARD",
      ["M01.S01"],
    );
    expect(strengthOf(result)).toBe("HARD");
  });
});

/* --------------------------------------------------------------- I and J */

describe("I and J. who said it decides what it can become", () => {
  it("an organiser reporting somebody else does not confirm anything for them", () => {
    const discussion = "Lucas: Mum might prefer Wednesday.";
    const result = run(discussion, {
      travellers: [person("P1", "Lucas", ["M01.S01"])],
      ...base,
      ambiguities: [
        {
          question: "Does Wednesday work for Mum?",
          whyItMatters: "It decides the departure date.",
          evidence: ["M01.S01"],
        },
      ],
    });
    if (result.outcome !== "SUCCESS") throw new Error("expected success");
    expect(result.mapped.constraints).toHaveLength(0);
    expect(result.intent.ambiguities).toHaveLength(1);
  });

  /**
   * §28: extraction is never authority. However firmly a requirement is read,
   * it arrives PROPOSED and waits for the person it belongs to.
   */
  it("even a correctly hard requirement arrives unconfirmed", () => {
    const result = withConstraint(
      "Mum: Wednesday only, I cannot do Tuesday.",
      { kind: "FREE_TEXT_REQUIREMENT", text: "Wednesday departure" },
      "HARD",
      ["M01.S01"],
    );
    if (result.outcome !== "SUCCESS") throw new Error("expected success");
    const constraint = result.mapped.constraints[0];
    expect(constraint?.strength).toBe("HARD");
    expect(constraint?.confirmation).toBe("PROPOSED");
    expect(constraint?.origin).toBe("MODEL_PROPOSED");
  });
});

/* --------------------------------------------------------------- L and M */

describe("L and M. one sentence, one requirement", () => {
  const gita = "Gita: I need step-free access the whole way through, and Elias travels with me.";

  it("does not record the same assistance need twice from two routes", () => {
    const result = run(gita, {
      travellers: [person("P1", "Gita", ["M01.S01"]), person("P2", "Elias", ["M01.S01"])],
      ...base,
      // The model lists the need AND the identical constraint. Mapping turns the
      // need into a constraint too, which is how one sentence became two rows.
      assistanceNeeds: [
        {
          ownerRef: "P1",
          need: "STEP_FREE_ACCESS",
          certainty: "EXPLICIT",
          evidence: ["M01.S01"],
        },
      ],
      constraints: [
        {
          ownerRef: "P1",
          value: { kind: "ASSISTANCE_REQUIRED", need: "STEP_FREE_ACCESS" },
          proposedStrength: "HARD",
          certainty: "EXPLICIT",
          evidence: ["M01.S01"],
        },
      ],
    });
    if (result.outcome !== "SUCCESS") throw new Error("expected success");
    const access = result.mapped.constraints.filter(
      (c) => c.value.kind === "ASSISTANCE_REQUIRED",
    );
    expect(access).toHaveLength(1);
    expect(result.mapped.assistanceNeeds).toHaveLength(1);
    expect(result.warnings.some((w) => w.effect === "MERGED_DUPLICATE_FACT")).toBe(true);
  });

  it("still keeps two genuinely different facts from one sentence", () => {
    const result = run(gita, {
      travellers: [person("P1", "Gita", ["M01.S01"]), person("P2", "Elias", ["M01.S01"])],
      ...base,
      assistanceNeeds: [
        { ownerRef: "P1", need: "STEP_FREE_ACCESS", certainty: "EXPLICIT", evidence: ["M01.S01"] },
      ],
      relationships: [
        {
          kind: "MUST_TRAVEL_WITH",
          fromRef: "P1",
          toRef: "P2",
          certainty: "EXPLICIT",
          evidence: ["M01.S01"],
        },
      ],
      constraints: [],
    });
    if (result.outcome !== "SUCCESS") throw new Error("expected success");
    expect(result.mapped.assistanceNeeds).toHaveLength(1);
    expect(result.intent.relationships).toHaveLength(1);
  });

  it("collapses the identical requirement stated twice in two sentences", () => {
    const discussion = "Ama: I cannot go above 600 SGD.\nAma: I cannot go above 600 SGD.";
    const result = run(discussion, {
      travellers: [person("P1", "Ama", ["M01.S01"])],
      ...base,
      constraints: [
        {
          ownerRef: "P1",
          value: { kind: "BUDGET_MAX", amountMajor: 600, currency: "SGD" },
          proposedStrength: "HARD",
          certainty: "EXPLICIT",
          evidence: ["M01.S01"],
        },
        {
          ownerRef: "P1",
          value: { kind: "BUDGET_MAX", amountMajor: 600, currency: "SGD" },
          proposedStrength: "HARD",
          certainty: "EXPLICIT",
          evidence: ["M02.S01"],
        },
      ],
    });
    if (result.outcome !== "SUCCESS") throw new Error("expected success");
    expect(result.mapped.constraints).toHaveLength(1);
  });

  /**
   * O. Two readings that disagree are a conflict, not a repetition. Collapsing
   * them would hide exactly the thing somebody needs to resolve.
   */
  it("keeps a disagreement rather than flattening it into one fact", () => {
    const discussion = "Ama: I cannot go above 600 SGD.\nAma: Actually I could go to 800.";
    const result = run(discussion, {
      travellers: [person("P1", "Ama", ["M01.S01"])],
      ...base,
      constraints: [
        {
          ownerRef: "P1",
          value: { kind: "BUDGET_MAX", amountMajor: 600, currency: "SGD" },
          proposedStrength: "HARD",
          certainty: "EXPLICIT",
          evidence: ["M01.S01"],
        },
        {
          ownerRef: "P1",
          value: { kind: "BUDGET_MAX", amountMajor: 800, currency: "SGD" },
          proposedStrength: "SOFT",
          certainty: "AMBIGUOUS",
          evidence: ["M02.S01"],
        },
      ],
    });
    if (result.outcome !== "SUCCESS") throw new Error("expected success");
    expect(result.mapped.constraints).toHaveLength(2);
  });
});

/* --------------------------------------------------------------- N, dates */

describe("N. a citation proves the field it supports, not its neighbours", () => {
  const bo = "Bo: I can only get leave from the 24th, so anything before that is out for me.";

  it("removes a window that has already happened rather than repairing it", () => {
    const result = withConstraint(
      bo,
      { kind: "AVAILABLE_DATES", ranges: [{ from: "2024-08-24", to: "2024-08-31" }] },
      "HARD",
      ["M01.S01"],
    );
    if (result.outcome !== "SUCCESS") throw new Error("expected success");
    expect(result.mapped.constraints).toHaveLength(0);
    const dropped = result.warnings.find((w) => w.effect === "DROPPED_IMPOSSIBLE_VALUE");
    expect(dropped).toBeDefined();
    expect(dropped?.reason).toMatch(/in the past/i);
  });

  it("keeps a plausible window but stops it claiming the words stated the end", () => {
    const result = withConstraint(
      bo,
      { kind: "AVAILABLE_DATES", ranges: [{ from: "2026-08-24", to: "2026-08-31" }] },
      "HARD",
      ["M01.S01"],
    );
    if (result.outcome !== "SUCCESS") throw new Error("expected success");
    expect(result.mapped.constraints).toHaveLength(1);
    expect(result.warnings.some((w) => w.effect === "LOWERED_UNSUPPORTED_CERTAINTY")).toBe(true);
  });

  it("leaves a window alone when the sentence states both ends", () => {
    const cai = "Cai: I can do the 10th to the 14th of September 2026.";
    const result = withConstraint(
      cai,
      { kind: "AVAILABLE_DATES", ranges: [{ from: "2026-09-10", to: "2026-09-14" }] },
      "HARD",
      ["M01.S01"],
    );
    if (result.outcome !== "SUCCESS") throw new Error("expected success");
    expect(result.warnings.some((w) => w.effect === "LOWERED_UNSUPPORTED_CERTAINTY")).toBe(false);
  });
});

/* --------------------------------------------------------- K, abstention */

describe("K. an unconfirmed person is not a traveller with requirements", () => {
  it("somebody who might come produces no requirements of their own", () => {
    const discussion = "Ama: Ryan hasn't replied yet, he might still come.";
    const result = run(discussion, {
      travellers: [person("P1", "Ama", ["M01.S01"])],
      ...base,
      ambiguities: [
        {
          question: "Is Ryan joining the trip?",
          whyItMatters: "It changes the group size.",
          evidence: ["M01.S01"],
        },
      ],
      constraints: [],
    });
    if (result.outcome !== "SUCCESS") throw new Error("expected success");
    expect(result.mapped.constraints).toHaveLength(0);
    expect(result.intent.ambiguities).toHaveLength(1);
  });
});

/* ------------------------------------------------------------- THE UNITS */

describe("the markers themselves", () => {
  it("finds hedges and restrictions in ordinary wording", () => {
    expect(markersIn("I could stretch a bit").soft.length).toBeGreaterThan(0);
    expect(markersIn("I cannot go above that").hard.length).toBeGreaterThan(0);
    expect(markersIn("Tokyo in August").soft).toEqual([]);
    expect(markersIn("Tokyo in August").hard).toEqual([]);
  });

  it("never promotes a soft or unknown proposal, whatever the wording", () => {
    for (const proposed of ["SOFT", "UNKNOWN"] as const) {
      const assessment = assessStrength({
        proposed,
        evidence: "I absolutely cannot go above 600, it is a hard limit.",
        value: { kind: "BUDGET_MAX", amountMajor: 600, currency: "SGD" },
      });
      expect(assessment.strength).toBe(proposed);
      expect(assessment.softened).toBe(false);
    }
  });

  it("reads day numbers and years out of a sentence, and nothing else", () => {
    const found = numbersMentionedIn("I can do the 10th to the 14th of September 2026.");
    expect([...found.days].sort((a, b) => a - b)).toEqual([10, 14]);
    expect([...found.years]).toEqual([2026]);
    expect([...numbersMentionedIn("from the 24th").years]).toEqual([]);
  });
});

/* ----------------------------------------- §19 THE PRODUCTION EXTRACTION */

/**
 * The three defects, in one response, exactly as production produced them.
 *
 * On 25 August 2026 the deployed `/understand` succeeded -- every quotation was
 * real -- and still put three wrong things on screen: Gita needed step-free
 * access twice, Bo's availability ran to a date nobody named, and it ran in
 * 2024. This is that shape. Each assertion below fails on the previous code.
 *
 * Reconstructed from the rendered page rather than a captured response body,
 * which was not kept. The shape is what matters; it is the shape that had to
 * become impossible.
 */
describe("§19. the production extraction, corrected", () => {
  const discussion = [
    "Ama: Right, Tokyo in late August then? I'm thinking five nights.",
    "Bo: I'm in. I can only get leave from the 24th, so anything before that is out for me.",
    "Bo: Early mornings are rough for me, ideally nothing before 9.",
    "Gita: I need step-free access the whole way through, and Elias travels with me.",
  ].join("\n");

  const asProduction = {
    travellers: [
      person("P1", "Ama", ["M01.S01"]),
      person("P2", "Bo", ["M02.S01"]),
      person("P3", "Gita", ["M04.S01"]),
    ],
    relationships: [],
    preferences: [],
    ambiguities: [],
    // One sentence, recorded as a need AND as the identical constraint.
    assistanceNeeds: [
      { ownerRef: "P3", need: "STEP_FREE_ACCESS", certainty: "EXPLICIT", evidence: ["M04.S01"] },
    ],
    constraints: [
      {
        ownerRef: "P3",
        value: { kind: "ASSISTANCE_REQUIRED", need: "STEP_FREE_ACCESS" },
        proposedStrength: "HARD",
        certainty: "EXPLICIT",
        evidence: ["M04.S01"],
      },
      {
        ownerRef: "P2",
        value: { kind: "AVAILABLE_DATES", ranges: [{ from: "2024-08-24", to: "2024-08-31" }] },
        proposedStrength: "HARD",
        certainty: "EXPLICIT",
        evidence: ["M02.S02"],
      },
      {
        ownerRef: "P2",
        value: { kind: "DEPART_NOT_BEFORE", minutesOfDay: 540 },
        proposedStrength: "HARD",
        certainty: "EXPLICIT",
        evidence: ["M03.S01"],
      },
    ],
  };

  const result = run(discussion, asProduction);

  it("still succeeds: the evidence was never the problem", () => {
    expect(result.outcome).toBe("SUCCESS");
  });

  it("records Gita's access requirement once, not twice", () => {
    if (result.outcome !== "SUCCESS") throw new Error("expected success");
    const access = result.mapped.constraints.filter((c) => c.value.kind === "ASSISTANCE_REQUIRED");
    expect(access).toHaveLength(1);
    expect(result.mapped.assistanceNeeds).toHaveLength(1);
  });

  it("does not plan Bo a trip into the past", () => {
    if (result.outcome !== "SUCCESS") throw new Error("expected success");
    const dates = result.mapped.constraints.filter((c) => c.value.kind === "AVAILABLE_DATES");
    expect(dates).toHaveLength(0);
    expect(result.warnings.some((w) => w.effect === "DROPPED_IMPOSSIBLE_VALUE")).toBe(true);
  });

  it("keeps Bo's 9am as the preference he actually expressed", () => {
    if (result.outcome !== "SUCCESS") throw new Error("expected success");
    const time = result.mapped.constraints.find((c) => c.value.kind === "DEPART_NOT_BEFORE");
    expect(time?.strength).toBe("SOFT");
  });

  it("leaves nothing confirmed, however firmly any of it was read", () => {
    if (result.outcome !== "SUCCESS") throw new Error("expected success");
    for (const constraint of result.mapped.constraints) {
      expect(constraint.confirmation).toBe("PROPOSED");
      expect(constraint.origin).toBe("MODEL_PROPOSED");
    }
    for (const need of result.mapped.assistanceNeeds) {
      expect(need.confirmedByOwner).toBe(false);
    }
  });

  it("every quotation is still an exact slice of the discussion", () => {
    if (result.outcome !== "SUCCESS") throw new Error("expected success");
    for (const constraint of result.mapped.constraints) {
      expect(discussion).toContain(constraint.provenance?.sourceQuote ?? "");
    }
  });
});
