import { describe, it, expect } from "vitest";
import { validateIntentSchema } from "@/core/intent/schema";
import { runExtractionPipeline } from "@/core/intent/pipeline";
import { asIsoDateTime } from "@/domain/index";
import { INTENT_SYSTEM_PROMPT } from "@/adapters/modelStudio/prompts/intentV2";

/**
 * The blast-radius correction, and the boundary it must not weaken.
 *
 * A live evaluation of seventeen fictional cases produced eight failures with
 * one shared cause: `tripContext.certainty` was absent, and its absence threw
 * away valid travellers, constraints and relationships that had nothing to do
 * with it.
 *
 * The fix is NOT "validate less". It is that optional, non-authoritative context
 * degrades field by field while everything that can BIND still fails closed. The
 * two halves of that sentence are tested together here on purpose, because a
 * change that achieved the first by sacrificing the second would look like a
 * success in a pass count and be a serious regression.
 */

const NOW = asIsoDateTime("2026-08-01T09:00:00+08:00");

const DISCUSSION = [
  "Ama: Tokyo in August. I cannot go above 450 SGD each.",
  "Bo: I can only travel from the 24th.",
  "Gita: I need step-free access, and Elias travels with me.",
  "Dara: I can do about 600 for the flights, I think.",
].join("\n");

const base = {
  discussion: DISCUSSION,
  mapping: { now: NOW, idPrefix: "REQ-1", extractedBy: "test" },
  diagnostics: {
    requestId: "REQ-1",
    operation: "EXTRACT_INTENT" as const,
    providerName: "test",
    model: "test",
    promptVersion: "orkestr-intent-v2" as const,
    durationMs: 1,
    startedAt: NOW,
  },
};

const AMA = {
  ref: "P1",
  displayName: "Ama",
  certainty: "EXPLICIT",
  source: { quote: "I cannot go above 450 SGD each." },
};
const BO = {
  ref: "P2",
  displayName: "Bo",
  certainty: "EXPLICIT",
  source: { quote: "I can only travel from the 24th." },
};
const GITA = {
  ref: "P3",
  displayName: "Gita",
  certainty: "EXPLICIT",
  source: { quote: "I need step-free access, and Elias travels with me." },
};
const ELIAS = {
  ref: "P4",
  displayName: "Elias",
  certainty: "LIKELY",
  source: { quote: "Elias travels with me" },
};

const GOOD_BUDGET = {
  ownerRef: "P1",
  value: { kind: "BUDGET_MAX", amountMajor: 450, currency: "SGD" },
  proposedStrength: "HARD",
  certainty: "EXPLICIT",
  source: { quote: "I cannot go above 450 SGD each." },
};

const MUST_TRAVEL_WITH = {
  kind: "MUST_TRAVEL_WITH",
  fromRef: "P3",
  toRef: "P4",
  certainty: "EXPLICIT",
  source: { quote: "I need step-free access, and Elias travels with me." },
};

function run(response: Record<string, unknown>) {
  return runExtractionPipeline({ ...base, rawResponse: JSON.stringify(response) });
}

/* ------------------------------------------------------------------------ A */

describe("A. optional context missing certainty does not destroy the extraction", () => {
  const response = {
    travellers: [GITA, ELIAS],
    relationships: [MUST_TRAVEL_WITH],
    // The exact shape that failed eight live cases: context with no certainty.
    tripContext: { destinationLabel: "Tokyo", nights: 5 },
  };

  it("survives, where before it failed the whole extraction", () => {
    const result = run(response);
    expect(result.outcome).toBe("SUCCESS");
  });

  it("keeps the relationship that had nothing to do with the missing field", () => {
    const result = run(response);
    if (result.outcome !== "SUCCESS") throw new Error("expected success");
    expect(result.intent.relationships).toHaveLength(1);
    expect(result.intent.relationships[0]?.kind).toBe("MUST_TRAVEL_WITH");
    expect(result.mapped.travellers).toHaveLength(2);
  });

  it("keeps the context that was readable", () => {
    const result = run(response);
    if (result.outcome !== "SUCCESS") throw new Error("expected success");
    expect(result.intent.tripContext?.destinationLabel).toBe("Tokyo");
    expect(result.intent.tripContext?.nights).toBe(5);
  });

  it("leaves certainty absent rather than inventing one", () => {
    const result = run(response);
    if (result.outcome !== "SUCCESS") throw new Error("expected success");
    // Never EXPLICIT, never LIKELY, never anything. Absent means absent.
    expect(result.intent.tripContext?.certainty).toBeUndefined();
  });

  it("records no warning for a field the model simply did not send", () => {
    // Omitting an optional field is not a defect. A warning here would train
    // people to ignore warnings.
    const result = run(response);
    if (result.outcome !== "SUCCESS") throw new Error("expected success");
    expect(result.warnings).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------------ B */

describe("B. a malformed optional field is dropped, traced, and gains nothing", () => {
  const response = {
    travellers: [AMA],
    constraints: [GOOD_BUDGET],
    tripContext: {
      destinationLabel: "Tokyo",
      certainty: "VERY_SURE_INDEED",
      nights: 999999,
    },
  };

  it("keeps the valid constraint", () => {
    const result = run(response);
    if (result.outcome !== "SUCCESS") throw new Error("expected success");
    expect(result.mapped.constraints).toHaveLength(1);
    const value = result.mapped.constraints[0]?.value;
    if (value?.kind !== "BUDGET_MAX") throw new Error("expected a budget");
    expect(value.maxPerTraveller.amountMinor).toBe(45000);
  });

  it("drops the invalid fields and leaves a trace for each", () => {
    const result = run(response);
    if (result.outcome !== "SUCCESS") throw new Error("expected success");
    const paths = result.warnings.map((w) => w.path);
    expect(paths).toContain("tripContext.certainty");
    expect(paths).toContain("tripContext.nights");
    expect(result.warnings.every((w) => w.effect === "OMITTED_FROM_CONTEXT")).toBe(true);
  });

  it("counts the warnings in the diagnostics", () => {
    const result = run(response);
    expect(result.diagnostics.warningCount).toBe(2);
  });

  it("does not let the invalid values survive in any form", () => {
    const result = run(response);
    if (result.outcome !== "SUCCESS") throw new Error("expected success");
    expect(result.intent.tripContext?.certainty).toBeUndefined();
    expect(result.intent.tripContext?.nights).toBeUndefined();
    // What was readable is kept.
    expect(result.intent.tripContext?.destinationLabel).toBe("Tokyo");
  });

  it("never turns a dropped field into a substituted one", () => {
    // The only permitted effect removes information. Nothing adds a default.
    const result = run(response);
    if (result.outcome !== "SUCCESS") throw new Error("expected success");
    for (const warning of result.warnings) {
      expect(warning.effect).toBe("OMITTED_FROM_CONTEXT");
    }
  });
});

/* ------------------------------------------------------------------------ C */

describe("C. the authority boundary is unchanged", () => {
  it("still rejects an invalid consequential constraint, valid context or not", () => {
    const result = run({
      travellers: [AMA],
      constraints: [
        { ...GOOD_BUDGET, value: { kind: "BUDGET_MAX", amountMajor: 450, currency: "not a code" } },
      ],
      tripContext: { destinationLabel: "Tokyo", certainty: "EXPLICIT" },
    });
    if (result.outcome !== "FAILED") throw new Error("expected failure");
    expect(result.code).toBe("SCHEMA_INVALID");
  });

  it("still rejects an unknown constraint kind", () => {
    const result = run({
      travellers: [AMA],
      constraints: [{ ...GOOD_BUDGET, value: { kind: "SEAT_PREFERENCE", seat: "window" } }],
      tripContext: { destinationLabel: "Tokyo" },
    });
    expect(result.outcome).toBe("FAILED");
  });

  it("still rejects an unknown relationship kind", () => {
    const result = run({
      travellers: [GITA, ELIAS],
      relationships: [{ ...MUST_TRAVEL_WITH, kind: "MUST_SIT_BESIDE" }],
    });
    expect(result.outcome).toBe("FAILED");
  });

  it("still rejects an unknown traveller reference", () => {
    const result = run({
      travellers: [AMA],
      constraints: [{ ...GOOD_BUDGET, ownerRef: "P9" }],
    });
    if (result.outcome !== "FAILED") throw new Error("expected failure");
    expect(result.code).toBe("SEMANTIC_VALIDATION_FAILED");
  });

  it("still rejects a self must-travel-with", () => {
    const result = run({
      travellers: [GITA],
      relationships: [{ ...MUST_TRAVEL_WITH, fromRef: "P3", toRef: "P3" }],
    });
    expect(result.outcome).toBe("FAILED");
  });

  it("still rejects an invalid date inside a consequential availability range", () => {
    // Degradation is for CONTEXT. A date a constraint depends on is not context.
    const result = run({
      travellers: [BO],
      constraints: [
        {
          ownerRef: "P2",
          value: { kind: "AVAILABLE_DATES", ranges: [{ from: "four nights", to: "2026-08-30" }] },
          proposedStrength: "HARD",
          certainty: "EXPLICIT",
          source: { quote: "I can only travel from the 24th." },
        },
      ],
    });
    if (result.outcome !== "FAILED") throw new Error("expected failure");
    expect(result.code).toBe("SCHEMA_INVALID");
  });
});

/* ------------------------------------------------------------------------ I */

describe("I. authority escalation is still refused, including through context", () => {
  it("refuses a confirmation attempt on a constraint", () => {
    const result = run({
      travellers: [AMA],
      constraints: [{ ...GOOD_BUDGET, confirmed: true }],
    });
    if (result.outcome !== "FAILED") throw new Error("expected failure");
    expect(result.code).toBe("UNSAFE_OUTPUT");
  });

  it("refuses an authority field smuggled into trip context", () => {
    /**
     * The one thing in tripContext that is still FATAL.
     *
     * Degradation is for a model fumbling decoration. A model putting
     * `confirmed` into the context object is not fumbling; it is attempting
     * authority, and that must not be softened into a warning.
     */
    const result = run({
      travellers: [AMA],
      tripContext: { destinationLabel: "Tokyo", confirmed: true },
    });
    if (result.outcome !== "FAILED") throw new Error("expected failure");
    expect(result.code).toBe("UNSAFE_OUTPUT");
  });

  it("refuses a provider-verification attempt on an assistance need", () => {
    const result = run({
      travellers: [GITA],
      assistanceNeeds: [
        {
          ownerRef: "P3",
          need: "STEP_FREE_ACCESS",
          certainty: "EXPLICIT",
          confirmation: "PROVIDER_CONFIRMED",
          source: { quote: "I need step-free access" },
        },
      ],
    });
    if (result.outcome !== "FAILED") throw new Error("expected failure");
    expect(result.code).toBe("UNSAFE_OUTPUT");
  });
});

/* -------------------------------------------------------------------- D/E/F */

describe("D-F. money without a currency creates nothing", () => {
  it("D. rejects a budget with an empty currency rather than storing a hole", () => {
    // The exact shape the live model produced when told not to guess.
    const result = run({
      travellers: [{ ...AMA, ref: "P1", displayName: "Dara", source: { quote: "I can do about 600 for the flights, I think." } }],
      constraints: [
        {
          ownerRef: "P1",
          value: { kind: "BUDGET_MAX", amountMajor: 600, currency: "" },
          proposedStrength: "SOFT",
          certainty: "LIKELY",
          source: { quote: "I can do about 600 for the flights, I think." },
        },
      ],
    });
    if (result.outcome !== "FAILED") throw new Error("expected failure");
    expect(result.code).toBe("SCHEMA_INVALID");
    expect(result.problems.some((p) => p.path.includes("currency"))).toBe(true);
  });

  it("D. accepts the correct behaviour: no money proposal, an ambiguity instead", () => {
    const result = run({
      travellers: [
        {
          ref: "P1",
          displayName: "Dara",
          certainty: "EXPLICIT",
          source: { quote: "I can do about 600 for the flights, I think." },
        },
      ],
      constraints: [],
      ambiguities: [
        {
          question: "Which currency is the 600 in?",
          aboutRef: "P1",
          whyItMatters: "A budget cannot be compared to a fare without a currency.",
          source: { quote: "I can do about 600 for the flights, I think." },
        },
      ],
    });
    if (result.outcome !== "SUCCESS") throw new Error("expected success");
    expect(result.mapped.constraints).toHaveLength(0);
    expect(result.intent.ambiguities).toHaveLength(1);
  });

  it("E. accepts a budget that states its currency", () => {
    const result = run({ travellers: [AMA], constraints: [GOOD_BUDGET] });
    if (result.outcome !== "SUCCESS") throw new Error("expected success");
    const value = result.mapped.constraints[0]?.value;
    if (value?.kind !== "BUDGET_MAX") throw new Error("expected a budget");
    expect(value.maxPerTraveller.currency).toBe("SGD");
  });

  it("F. never infers a currency from the destination", () => {
    /**
     * A Tokyo trip does not make an unstated amount yen, and a Singapore origin
     * does not make it SGD. The schema has no path that supplies a currency, so
     * inference is not merely discouraged, it is unrepresentable.
     */
    const result = run({
      travellers: [AMA],
      constraints: [
        {
          ownerRef: "P1",
          value: { kind: "BUDGET_MAX", amountMajor: 600 },
          proposedStrength: "SOFT",
          certainty: "LIKELY",
          source: { quote: "I cannot go above 450 SGD each." },
        },
      ],
      tripContext: { destinationLabel: "Tokyo", originLabel: "Singapore" },
    });
    expect(result.outcome).toBe("FAILED");
  });

  it("F. the prompt forbids inferring a currency from anything about the speaker", () => {
    expect(INTENT_SYSTEM_PROMPT).toContain("never infer a currency from the destination");
  });
});

/* -------------------------------------------------------------------- G/H */

describe("G-H. durations never become calendar dates", () => {
  it("H. drops a duration placed in a date field, with a warning", () => {
    const result = run({
      travellers: [AMA],
      tripContext: { destinationLabel: "Tokyo", earliestDate: "four nights", nights: 4 },
    });
    if (result.outcome !== "SUCCESS") throw new Error("expected success");
    expect(result.intent.tripContext?.earliestDate).toBeUndefined();
    expect(result.warnings.map((w) => w.path)).toContain("tripContext.earliestDate");
    // The legitimate part survives.
    expect(result.intent.tripContext?.nights).toBe(4);
  });

  it("H. drops a month name, a season and a weekday from a date field", () => {
    for (const value of ["August", "next summer", "Tuesday", "2026-13-01", "26-08-24"]) {
      const result = run({
        travellers: [AMA],
        tripContext: { destinationLabel: "Tokyo", latestDate: value },
      });
      if (result.outcome !== "SUCCESS") throw new Error(`${value} failed the extraction`);
      expect(result.intent.tripContext?.latestDate, value).toBeUndefined();
    }
  });

  it("G. a stated range yields no fabricated dates", () => {
    // "between four and six nights" -- correct behaviour is an ambiguity and no
    // dates at all, not a guess at either end.
    const result = run({
      travellers: [AMA],
      tripContext: { destinationLabel: "Tokyo" },
      ambiguities: [
        {
          question: "Is the trip four nights or six?",
          whyItMatters: "The duration changes which date pairs are searched.",
          source: { quote: "Tokyo in August. I cannot go above 450 SGD each." },
        },
      ],
    });
    if (result.outcome !== "SUCCESS") throw new Error("expected success");
    expect(result.intent.tripContext?.earliestDate).toBeUndefined();
    expect(result.intent.tripContext?.latestDate).toBeUndefined();
    expect(result.intent.ambiguities).toHaveLength(1);
  });

  it("G. the prompt forbids picking one value out of a stated range", () => {
    expect(INTENT_SYSTEM_PROMPT).toContain("Never pick one value out of a stated range");
  });

  it("keeps a genuine calendar date", () => {
    const result = run({
      travellers: [AMA],
      tripContext: { destinationLabel: "Tokyo", earliestDate: "2026-08-24", latestDate: "2026-08-30" },
    });
    if (result.outcome !== "SUCCESS") throw new Error("expected success");
    expect(result.intent.tripContext?.earliestDate).toBe("2026-08-24");
    expect(result.warnings).toHaveLength(0);
  });
});

/* --------------------------------------------------------------- schema level */

describe("the schema layer reports warnings alongside a valid intent", () => {
  it("returns warnings on success", () => {
    const result = validateIntentSchema({
      travellers: [],
      tripContext: { certainty: "NOT_A_VALUE" },
    });
    if (!result.ok) throw new Error("expected success");
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]?.path).toBe("tripContext.certainty");
  });

  it("drops a context object that degrades to nothing", () => {
    const result = validateIntentSchema({
      travellers: [],
      tripContext: { certainty: "NOT_A_VALUE" },
    });
    if (!result.ok) throw new Error("expected success");
    // A shell with every field dropped is not context.
    expect(result.intent.tripContext).toBeUndefined();
  });

  it("stamps the prompt version we actually sent", () => {
    const result = validateIntentSchema({ travellers: [] });
    if (!result.ok) throw new Error("expected success");
    expect(result.intent.promptVersion).toBe("orkestr-intent-v2");
  });
});
