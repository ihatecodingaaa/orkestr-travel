import { describe, it, expect } from "vitest";
import { validateIntentSchema } from "@/core/intent/schema";
import { segmentDiscussion } from "@/core/intent/spans";

/**
 * A discussion whose spans the fixtures below cite.
 *
 * Evidence is now a reference, so a test response can only be valid against a
 * discussion that actually contains the spans it names. That is the point of
 * the change: there is no longer a way to write a passing fixture whose
 * evidence came from nowhere.
 */
const TEST_DISCUSSION = ["Ama: Ama is coming. I cannot go above 450.", "Bo: I need to be back Sunday."].join("\n");
const SPANS = segmentDiscussion(TEST_DISCUSSION);

/**
 * Schema validation.
 *
 * The premise of every test here: JSON mode guarantees the response PARSES and
 * nothing more. Each case below is valid JSON that must still be refused.
 */

/** A minimal response that passes, used as the base for negative cases. */
function validResponse(): Record<string, unknown> {
  return {
    travellers: [
      { ref: "P1", displayName: "Ama", certainty: "EXPLICIT", evidence: ["M01.S01"] },
    ],
    constraints: [],
    relationships: [],
    assistanceNeeds: [],
    preferences: [],
    ambiguities: [],
  };
}

function budgetConstraint(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ownerRef: "P1",
    value: { kind: "BUDGET_MAX", amountMajor: 450, currency: "SGD" },
    proposedStrength: "HARD",
    certainty: "EXPLICIT",
    evidence: ["M01.S02"],
    ...overrides,
  };
}

describe("intent schema: the happy path", () => {
  it("accepts a well formed minimal response", () => {
    const result = validateIntentSchema(validResponse(), SPANS);
    expect(result.ok).toBe(true);
  });

  it("always stamps the prompt version from our side, never from the response", () => {
    const response = { ...validResponse(), promptVersion: "attacker-supplied-v9" };
    const result = validateIntentSchema(response, SPANS);
    if (!result.ok) throw new Error("expected success");
    expect(result.intent.promptVersion).toBe("orkestr-intent-v3");
  });

  it("treats missing optional arrays as empty rather than as a failure", () => {
    const result = validateIntentSchema({ travellers: [] }, SPANS);
    if (!result.ok) throw new Error("expected success");
    expect(result.intent.constraints).toEqual([]);
    expect(result.intent.ambiguities).toEqual([]);
  });

  it("accepts every permitted constraint kind", () => {
    const kinds: Record<string, unknown>[] = [
      { kind: "BUDGET_MAX", amountMajor: 450, currency: "SGD" },
      { kind: "DEPART_NOT_BEFORE", minutesOfDay: 540 },
      { kind: "DEPART_NOT_AFTER", minutesOfDay: 1200 },
      { kind: "MAX_STOPS", maxStops: 0 },
      { kind: "CHECKED_BAGS_REQUIRED", bagCount: 1 },
      { kind: "AVAILABLE_DATES", ranges: [{ from: "2026-08-24", to: "2026-08-30" }] },
      { kind: "ASSISTANCE_REQUIRED", need: "STEP_FREE_ACCESS" },
      { kind: "FREE_TEXT_REQUIREMENT", text: "wants a window seat" },
    ];
    for (const value of kinds) {
      const response = { ...validResponse(), constraints: [budgetConstraint({ value })] };
      const result = validateIntentSchema(response, SPANS);
      expect(result.ok, `${String(value["kind"])} was rejected`).toBe(true);
    }
  });
});

describe("intent schema: shape failures", () => {
  it("rejects a response that is not an object", () => {
    for (const value of ["a string", 42, null, [1, 2, 3], true]) {
      const result = validateIntentSchema(value, SPANS);
      expect(result.ok).toBe(false);
    }
  });

  it("rejects an unknown constraint kind", () => {
    const response = {
      ...validResponse(),
      constraints: [budgetConstraint({ value: { kind: "SEAT_PREFERENCE", seat: "window" } })],
    };
    const result = validateIntentSchema(response, SPANS);
    if (result.ok) throw new Error("expected failure");
    expect(result.code).toBe("SCHEMA_INVALID");
    expect(result.problems.some((p) => p.path.endsWith("value.kind"))).toBe(true);
  });

  it("rejects an unknown certainty value", () => {
    const response = {
      ...validResponse(),
      constraints: [budgetConstraint({ certainty: "VERY_SURE" })],
    };
    const result = validateIntentSchema(response, SPANS);
    if (result.ok) throw new Error("expected failure");
    expect(result.problems.some((p) => p.path.endsWith("certainty"))).toBe(true);
  });

  it("rejects an unknown assistance need", () => {
    const response = {
      ...validResponse(),
      assistanceNeeds: [
        {
          ownerRef: "P1",
          need: "NEEDS_A_NAP",
          certainty: "EXPLICIT",
          evidence: ["M01.S01"],
        },
      ],
    };
    expect(validateIntentSchema(response, SPANS).ok).toBe(false);
  });

  it("rejects a strength that is not HARD, SOFT or UNKNOWN", () => {
    const response = {
      ...validResponse(),
      constraints: [budgetConstraint({ proposedStrength: "VERY_HARD" })],
    };
    expect(validateIntentSchema(response, SPANS).ok).toBe(false);
  });

  it("rejects a person reference that is not the temporary form", () => {
    for (const ref of ["T-001", "Ama", "P0", "PX", "1", ""]) {
      const response = { ...validResponse(), constraints: [budgetConstraint({ ownerRef: ref })] };
      expect(validateIntentSchema(response, SPANS).ok, `${ref} was accepted`).toBe(false);
    }
  });

  it("rejects a constraint that cites no evidence at all", () => {
    const response = { ...validResponse(), constraints: [budgetConstraint({ evidence: [] })] };
    const result = validateIntentSchema(response, SPANS);
    if (result.ok) throw new Error("expected failure");
    expect(result.problems.some((p) => p.path.endsWith("evidence"))).toBe(true);
  });

  it("rejects a constraint with no evidence key", () => {
    const response = {
      ...validResponse(),
      constraints: [budgetConstraint({ evidence: undefined })],
    };
    expect(validateIntentSchema(response, SPANS).ok).toBe(false);
  });

  /**
   * The heart of the change: a citation is checked against spans this software
   * cut itself, so a plausible-looking id that was never issued is refused.
   */
  it("rejects an evidence id that was never in the supplied spans", () => {
    const response = {
      ...validResponse(),
      constraints: [budgetConstraint({ evidence: ["M99.S99"] })],
    };
    const result = validateIntentSchema(response, SPANS);
    if (result.ok) throw new Error("expected failure");
    expect(result.problems.some((p) => /not one of the spans/i.test(p.detail))).toBe(true);
  });

  it("resolves a valid citation into the exact words of that span", () => {
    const response = {
      ...validResponse(),
      constraints: [budgetConstraint({ evidence: ["M01.S02"] })],
    };
    const result = validateIntentSchema(response, SPANS);
    if (!result.ok) throw new Error("expected success");
    const quote = result.intent.constraints[0]?.source.quote ?? "";
    expect(quote).toBe("I cannot go above 450.");
    expect(TEST_DISCUSSION).toContain(quote);
    expect(result.intent.constraints[0]?.source.spanIds).toEqual(["M01.S02"]);
  });
});

describe("intent schema: money", () => {
  it("rejects a decimal budget, because minor units must stay exact", () => {
    const response = {
      ...validResponse(),
      constraints: [
        budgetConstraint({ value: { kind: "BUDGET_MAX", amountMajor: 449.99, currency: "SGD" } }),
      ],
    };
    const result = validateIntentSchema(response, SPANS);
    if (result.ok) throw new Error("expected failure");
    expect(result.problems.some((p) => p.path.endsWith("amountMajor"))).toBe(true);
  });

  it("rejects a budget written as words", () => {
    const response = {
      ...validResponse(),
      constraints: [
        budgetConstraint({
          value: { kind: "BUDGET_MAX", amountMajor: "four hundred", currency: "SGD" },
        }),
      ],
    };
    expect(validateIntentSchema(response, SPANS).ok).toBe(false);
  });

  it("rejects a currency that is not a three-letter code", () => {
    for (const currency of ["dollars", "S$", "sgd", "SGDD", ""]) {
      const response = {
        ...validResponse(),
        constraints: [
          budgetConstraint({ value: { kind: "BUDGET_MAX", amountMajor: 450, currency } }),
        ],
      };
      expect(validateIntentSchema(response, SPANS).ok, `${currency} was accepted`).toBe(false);
    }
  });

  it("rejects a negative budget", () => {
    const response = {
      ...validResponse(),
      constraints: [
        budgetConstraint({ value: { kind: "BUDGET_MAX", amountMajor: -1, currency: "SGD" } }),
      ],
    };
    expect(validateIntentSchema(response, SPANS).ok).toBe(false);
  });

  it("accepts a budget of exactly zero, which is a real statement", () => {
    const response = {
      ...validResponse(),
      constraints: [
        budgetConstraint({ value: { kind: "BUDGET_MAX", amountMajor: 0, currency: "SGD" } }),
      ],
    };
    expect(validateIntentSchema(response, SPANS).ok).toBe(true);
  });
});

describe("intent schema: numeric boundaries", () => {
  it("accepts minutes of day at both ends and rejects one past each", () => {
    const cases: [number, boolean][] = [
      [-1, false],
      [0, true],
      [1439, true],
      [1440, false],
    ];
    for (const [minutesOfDay, expected] of cases) {
      const response = {
        ...validResponse(),
        constraints: [budgetConstraint({ value: { kind: "DEPART_NOT_BEFORE", minutesOfDay } })],
      };
      expect(validateIntentSchema(response, SPANS).ok, `${String(minutesOfDay)}`).toBe(expected);
    }
  });

  it("accepts zero stops and rejects a negative stop count", () => {
    const zero = {
      ...validResponse(),
      constraints: [budgetConstraint({ value: { kind: "MAX_STOPS", maxStops: 0 } })],
    };
    expect(validateIntentSchema(zero, SPANS).ok).toBe(true);

    const negative = {
      ...validResponse(),
      constraints: [budgetConstraint({ value: { kind: "MAX_STOPS", maxStops: -1 } })],
    };
    expect(validateIntentSchema(negative, SPANS).ok).toBe(false);
  });

  it("rejects a date that is not a real calendar date", () => {
    for (const from of ["2026-02-30", "2026-13-01", "26-08-24", "August 24", ""]) {
      const response = {
        ...validResponse(),
        constraints: [
          budgetConstraint({
            value: { kind: "AVAILABLE_DATES", ranges: [{ from, to: "2026-08-30" }] },
          }),
        ],
      };
      expect(validateIntentSchema(response, SPANS).ok, `${from} was accepted`).toBe(false);
    }
  });

  it("rejects an availability constraint with no ranges", () => {
    const response = {
      ...validResponse(),
      constraints: [budgetConstraint({ value: { kind: "AVAILABLE_DATES", ranges: [] } })],
    };
    expect(validateIntentSchema(response, SPANS).ok).toBe(false);
  });
});

describe("intent schema: the model may not grant itself authority", () => {
  const forbidden = [
    "confirmed",
    "confirmation",
    "confirmedAt",
    "origin",
    "authority",
    "binding",
    "consequential",
    "ownerTravellerId",
    "constraintId",
    "id",
  ];

  it.each(forbidden)("refuses a constraint carrying %s as UNSAFE_OUTPUT", (field) => {
    const response = {
      ...validResponse(),
      constraints: [budgetConstraint({ [field]: field === "confirmed" ? true : "anything" })],
    };
    const result = validateIntentSchema(response, SPANS);
    if (result.ok) throw new Error("expected failure");
    expect(result.code).toBe("UNSAFE_OUTPUT");
  });

  it("refuses a traveller carrying a real traveller identifier", () => {
    const response = {
      travellers: [
        {
          ref: "P1",
          travellerId: "T-001",
          certainty: "EXPLICIT",
          evidence: ["M01.S01"],
        },
      ],
    };
    const result = validateIntentSchema(response, SPANS);
    if (result.ok) throw new Error("expected failure");
    expect(result.code).toBe("UNSAFE_OUTPUT");
  });

  it("reports UNSAFE_OUTPUT even when the response is also malformed", () => {
    // The more serious problem is the one worth investigating.
    const response = {
      ...validResponse(),
      constraints: [budgetConstraint({ confirmed: true, certainty: "NONSENSE" })],
    };
    const result = validateIntentSchema(response, SPANS);
    if (result.ok) throw new Error("expected failure");
    expect(result.code).toBe("UNSAFE_OUTPUT");
    expect(result.problems.length).toBeGreaterThan(1);
  });
});

describe("intent schema: bounds", () => {
  it("rejects an implausible number of travellers rather than processing it", () => {
    const travellers = Array.from({ length: 60 }, (_, i) => ({
      ref: `P${String(i + 1)}`,
      certainty: "EXPLICIT",
      evidence: ["M01.S01"],
    }));
    expect(validateIntentSchema({ travellers }, SPANS).ok).toBe(false);
  });

  it("rejects a citation of more spans than one reading may rest on", () => {
    const response = {
      ...validResponse(),
      constraints: [
        budgetConstraint({ evidence: ["M01.S01", "M01.S02", "M02.S01", "M01.S01", "M01.S02"] }),
      ],
    };
    expect(validateIntentSchema(response, SPANS).ok).toBe(false);
  });

  it("rejects an evidence id that is not a string", () => {
    const response = {
      ...validResponse(),
      constraints: [budgetConstraint({ evidence: [{ id: "M01.S01" }] })],
    };
    expect(validateIntentSchema(response, SPANS).ok).toBe(false);
  });

  /**
   * There is no longer a field for model-authored evidence text, and a response
   * that invents one is refused rather than quietly ignored.
   */
  it("rejects a response that tries to supply its own quote", () => {
    const response = {
      ...validResponse(),
      constraints: [budgetConstraint({ source: { quote: "words nobody said" } })],
    };
    expect(validateIntentSchema(response, SPANS).ok).toBe(false);
  });

  it("rejects an array where an object was required", () => {
    expect(validateIntentSchema({ travellers: "not an array" }, SPANS).ok).toBe(false);
    expect(validateIntentSchema({ ...validResponse(), constraints: {} }, SPANS).ok).toBe(false);
  });
});
