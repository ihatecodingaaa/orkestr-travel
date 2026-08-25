import { describe, it, expect } from "vitest";
import { resolveEvidence, segmentDiscussion } from "@/core/intent/spans";
import type { SourceSpan } from "@/domain/intent";
import { validateIntentSemantics } from "@/core/intent/semantic";
import { mapIntentToDomain, minorUnitScaleFor } from "@/core/intent/mapping";
import { runExtractionPipeline } from "@/core/intent/pipeline";
import { constraintAuthority } from "@/core/constraint/authority";
import { asIsoDateTime } from "@/domain/index";
import type { ProposedTripIntent } from "@/domain/intent";

const NOW = asIsoDateTime("2026-08-01T09:00:00+08:00");

const MAPPING = { now: NOW, idPrefix: "REQ-1", extractedBy: "test-provider" } as const;

const DISCUSSION = [
  "Ama: I cannot go above 450 SGD each.",
  "Bo: I can only travel from the 24th.",
  "Gita: I need step-free access, and Elias travels with me.",
].join("\n");

const SPANS = segmentDiscussion(DISCUSSION);

/**
 * Build a SourceSpan the way the product does: cite spans, let software slice
 * the words out.
 *
 * Writing { quote: "..." } by hand here would reintroduce, in the test data,
 * exactly what the architecture removed from the model -- a quotation nobody
 * checked against the discussion.
 */
function ev(...ids: string[]): SourceSpan {
  const resolved = resolveEvidence(ids, SPANS);
  if (!resolved.ok) throw new Error(resolved.reason);
  return { quote: resolved.quote, spanIds: resolved.spanIds };
}

function intent(overrides: Partial<ProposedTripIntent> = {}): ProposedTripIntent {
  return {
    promptVersion: "orkestr-intent-v3",
    travellers: [
      {
        ref: "P1",
        displayName: "Ama",
        certainty: "EXPLICIT",
        source: ev("M01.S01"),
      },
      {
        ref: "P2",
        displayName: "Bo",
        certainty: "EXPLICIT",
        source: ev("M02.S01"),
      },
    ],
    constraints: [
      {
        ownerRef: "P1",
        value: { kind: "BUDGET_MAX", amountMajor: 450, currency: "SGD" },
        proposedStrength: "HARD",
        certainty: "EXPLICIT",
        source: ev("M01.S01"),
      },
    ],
    relationships: [],
    assistanceNeeds: [],
    preferences: [],
    ambiguities: [],
    ...overrides,
  };
}

describe("semantic validation: the reading must be possible", () => {
  it("accepts an intent whose every quote appears in the discussion", () => {
    expect(validateIntentSemantics(intent(), DISCUSSION).ok).toBe(true);
  });

  it("rejects a constraint owned by a person nobody described", () => {
    const result = validateIntentSemantics(
      intent({
        constraints: [
          {
            ownerRef: "P9",
            value: { kind: "MAX_STOPS", maxStops: 0 },
            proposedStrength: "SOFT",
            certainty: "EXPLICIT",
            source: ev("M01.S01"),
          },
        ],
      }),
      DISCUSSION,
    );
    expect(result.ok).toBe(false);
    expect(result.problems.some((p) => p.detail.includes("P9"))).toBe(true);
  });

  it("rejects a quote that does not appear in the discussion", () => {
    const result = validateIntentSemantics(
      intent({
        constraints: [
          {
            ownerRef: "P1",
            value: { kind: "BUDGET_MAX", amountMajor: 450, currency: "SGD" },
            proposedStrength: "HARD",
            certainty: "EXPLICIT",
            source: { quote: "Ama said her limit is one thousand pounds" },
          },
        ],
      }),
      DISCUSSION,
    );
    expect(result.ok).toBe(false);
    expect(result.problems[0]?.detail).toContain("does not appear");
  });

  it("accepts a quote that differs only by curly punctuation or spacing", () => {
    const discussion = "Ama: I can’t go above 450 SGD   each.";
    const result = validateIntentSemantics(
      intent({
        travellers: [
          {
            ref: "P1",
            certainty: "EXPLICIT",
            source: { quote: "I can't go above 450 SGD each." },
          },
        ],
        constraints: [],
      }),
      discussion,
    );
    expect(result.ok).toBe(true);
  });

  it("rejects two travellers sharing one reference", () => {
    const result = validateIntentSemantics(
      intent({
        travellers: [
          { ref: "P1", certainty: "EXPLICIT", source: ev("M01.S01") },
          { ref: "P1", certainty: "EXPLICIT", source: ev("M02.S01") },
        ],
      }),
      DISCUSSION,
    );
    expect(result.ok).toBe(false);
  });

  it("rejects an availability range that ends before it begins", () => {
    const result = validateIntentSemantics(
      intent({
        constraints: [
          {
            ownerRef: "P2",
            value: {
              kind: "AVAILABLE_DATES",
              ranges: [{ from: "2026-08-30", to: "2026-08-24" }],
            },
            proposedStrength: "HARD",
            certainty: "EXPLICIT",
            source: ev("M02.S01"),
          },
        ],
      }),
      DISCUSSION,
    );
    expect(result.ok).toBe(false);
    expect(result.problems.some((p) => p.detail.includes("ends before"))).toBe(true);
  });

  it("rejects a traveller required to travel with themselves", () => {
    const result = validateIntentSemantics(
      intent({
        relationships: [
          {
            kind: "MUST_TRAVEL_WITH",
            fromRef: "P1",
            toRef: "P1",
            certainty: "EXPLICIT",
            source: ev("M01.S01"),
          },
        ],
      }),
      DISCUSSION,
    );
    expect(result.ok).toBe(false);
  });

  it("rejects a custom assistance need with no description", () => {
    const result = validateIntentSemantics(
      intent({
        assistanceNeeds: [
          {
            ownerRef: "P1",
            need: "CUSTOM",
            certainty: "EXPLICIT",
            source: ev("M01.S01"),
          },
        ],
      }),
      DISCUSSION,
    );
    expect(result.ok).toBe(false);
  });
});

describe("safe mapping: the model proposes, it never confirms", () => {
  it("marks every mapped constraint MODEL_PROPOSED and PROPOSED", () => {
    const mapped = mapIntentToDomain(intent(), MAPPING);
    expect(mapped.constraints.length).toBeGreaterThan(0);
    for (const constraint of mapped.constraints) {
      expect(constraint.origin).toBe("MODEL_PROPOSED");
      expect(constraint.confirmation).toBe("PROPOSED");
      expect(constraint.confirmedAt).toBeUndefined();
    }
  });

  it("leaves every consequential proposal unable to bind", () => {
    const mapped = mapIntentToDomain(intent(), MAPPING);
    for (const constraint of mapped.requiresConfirmation) {
      expect(constraintAuthority(constraint)).toBe("NEEDS_CONFIRMATION");
    }
  });

  it("treats a budget, a departure window and an access need as consequential", () => {
    const mapped = mapIntentToDomain(
      intent({
        constraints: [
          {
            ownerRef: "P1",
            value: { kind: "BUDGET_MAX", amountMajor: 450, currency: "SGD" },
            proposedStrength: "HARD",
            certainty: "EXPLICIT",
            source: ev("M01.S01"),
          },
          {
            ownerRef: "P2",
            value: { kind: "DEPART_NOT_BEFORE", minutesOfDay: 540 },
            proposedStrength: "SOFT",
            certainty: "EXPLICIT",
            source: ev("M02.S01"),
          },
        ],
      }),
      MAPPING,
    );
    expect(mapped.requiresConfirmation).toHaveLength(2);
  });

  it("treats a narrative note as non-consequential, so it needs no confirmation", () => {
    const mapped = mapIntentToDomain(
      intent({
        constraints: [
          {
            ownerRef: "P1",
            value: { kind: "FREE_TEXT_REQUIREMENT", text: "would like a window seat" },
            proposedStrength: "SOFT",
            certainty: "LIKELY",
            source: ev("M01.S01"),
          },
        ],
      }),
      MAPPING,
    );
    expect(mapped.requiresConfirmation).toHaveLength(0);
    expect(mapped.constraints[0]?.consequential).toBe(false);
  });

  it("carries the traveller's own words on every proposal", () => {
    const mapped = mapIntentToDomain(intent(), MAPPING);
    expect(mapped.constraints[0]?.provenance?.sourceQuote).toBe("I cannot go above 450 SGD each.");
    expect(mapped.constraints[0]?.provenance?.extractedBy).toBe("test-provider");
  });

  it("files every constraint under the traveller it belongs to", () => {
    const mapped = mapIntentToDomain(intent(), MAPPING);
    const ama = mapped.travellers.find((t) => t.displayName === "Ama");
    const bo = mapped.travellers.find((t) => t.displayName === "Bo");
    expect(ama?.constraints).toHaveLength(1);
    expect(bo?.constraints).toHaveLength(0);
    expect(mapped.constraints[0]?.ownerTravellerId).toBe(ama?.id);
  });

  it("starts everybody INVITED, because being mentioned is not agreeing to come", () => {
    const mapped = mapIntentToDomain(intent(), MAPPING);
    for (const traveller of mapped.travellers) {
      expect(traveller.membershipState).toBe("INVITED");
    }
  });

  it("never assigns an age band, because age is person-supplied", () => {
    const mapped = mapIntentToDomain(intent(), MAPPING);
    for (const traveller of mapped.travellers) {
      expect(traveller.ageBand).toBeUndefined();
    }
  });

  it("never grants permission to travel alone, because silence is not consent", () => {
    const mapped = mapIntentToDomain(intent(), MAPPING);
    for (const traveller of mapped.travellers) {
      expect(traveller.relationships.canTravelSeparately).toBe(false);
    }
  });
});

describe("safe mapping: privacy and assistance", () => {
  const withAssistance = () =>
    mapIntentToDomain(
      intent({
        assistanceNeeds: [
          {
            ownerRef: "P1",
            need: "STEP_FREE_ACCESS",
            certainty: "EXPLICIT",
            source: ev("M01.S01"),
          },
        ],
      }),
      MAPPING,
    );

  it("makes an extracted assistance requirement SENSITIVE", () => {
    const mapped = withAssistance();
    const assistance = mapped.constraints.find((c) => c.value.kind === "ASSISTANCE_REQUIRED");
    expect(assistance?.visibility).toBe("SENSITIVE");
  });

  it("never makes an extracted constraint PUBLIC", () => {
    const mapped = withAssistance();
    for (const constraint of mapped.constraints) {
      expect(constraint.visibility).not.toBe("PUBLIC");
    }
  });

  it("leaves an assistance need unconfirmed by its owner and unknown to any provider", () => {
    const mapped = withAssistance();
    const need = mapped.assistanceNeeds[0];
    expect(need?.confirmedByOwner).toBe(false);
    expect(need?.operationalStatus).toBe("UNKNOWN");
    expect(need?.statedBy).toBe("TRAVELLER");
  });
});

describe("safe mapping: relationships and money", () => {
  it("applies must-travel-with in both directions", () => {
    const mapped = mapIntentToDomain(
      intent({
        relationships: [
          {
            kind: "MUST_TRAVEL_WITH",
            fromRef: "P1",
            toRef: "P2",
            certainty: "EXPLICIT",
            source: ev("M01.S01"),
          },
        ],
      }),
      MAPPING,
    );
    const [first, second] = mapped.travellers;
    expect(first?.relationships.mustTravelWith).toContain(second?.id);
    expect(second?.relationships.mustTravelWith).toContain(first?.id);
  });

  it("keeps prefer-travel-with one-directional, because a preference can be one-sided", () => {
    const mapped = mapIntentToDomain(
      intent({
        relationships: [
          {
            kind: "PREFER_TRAVEL_WITH",
            fromRef: "P1",
            toRef: "P2",
            certainty: "LIKELY",
            source: ev("M01.S01"),
          },
        ],
      }),
      MAPPING,
    );
    const [first, second] = mapped.travellers;
    expect(first?.relationships.preferTravelWith).toContain(second?.id);
    expect(second?.relationships.preferTravelWith).toHaveLength(0);
  });

  it("converts a budget into exact minor units with the currency's own scale", () => {
    const mapped = mapIntentToDomain(intent(), MAPPING);
    const value = mapped.constraints[0]?.value;
    if (value?.kind !== "BUDGET_MAX") throw new Error("expected a budget");
    expect(value.maxPerTraveller.amountMinor).toBe(45000);
    expect(value.maxPerTraveller.minorUnitScale).toBe(2);
  });

  it("reads yen as a zero-decimal currency rather than assuming two places", () => {
    expect(minorUnitScaleFor("JPY")).toBe(0);
    expect(minorUnitScaleFor("SGD")).toBe(2);

    const mapped = mapIntentToDomain(
      intent({
        constraints: [
          {
            ownerRef: "P1",
            value: { kind: "BUDGET_MAX", amountMajor: 12000, currency: "JPY" },
            proposedStrength: "HARD",
            certainty: "EXPLICIT",
            source: ev("M01.S01"),
          },
        ],
      }),
      MAPPING,
    );
    const value = mapped.constraints[0]?.value;
    if (value?.kind !== "BUDGET_MAX") throw new Error("expected a budget");
    // 12000 JPY is 12000 minor units, not 1,200,000.
    expect(value.maxPerTraveller.amountMinor).toBe(12000);
    expect(value.maxPerTraveller.minorUnitScale).toBe(0);
  });
});

describe("the pipeline refuses to apply anything partially", () => {
  const base = {
    discussion: DISCUSSION,
    mapping: MAPPING,
    diagnostics: {
      requestId: "REQ-1",
      operation: "EXTRACT_INTENT" as const,
      providerName: "test",
      model: "test",
      promptVersion: "orkestr-intent-v3" as const,
      durationMs: 5,
      startedAt: NOW,
    },
  };

  it("reports MALFORMED_JSON for a response that is not JSON", () => {
    const result = runExtractionPipeline({ ...base, rawResponse: "I think Ama wants Tokyo." });
    if (result.outcome !== "FAILED") throw new Error("expected failure");
    expect(result.code).toBe("MALFORMED_JSON");
  });

  it("does not leak the response text into the failure detail", () => {
    const secret = "Gita takes insulin four times a day";
    const result = runExtractionPipeline({ ...base, rawResponse: `not json: ${secret}` });
    if (result.outcome !== "FAILED") throw new Error("expected failure");
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it("accepts JSON wrapped in a markdown fence, which is a formatting habit", () => {
    const body = JSON.stringify({
      travellers: [
        { ref: "P1", certainty: "EXPLICIT", evidence: ["M01.S01"] },
      ],
    });
    const result = runExtractionPipeline({
      ...base,
      rawResponse: "```json\n" + body + "\n```",
    });
    expect(result.outcome).toBe("SUCCESS");
  });

  it("keeps nothing at all when one constraint of several is invalid", () => {
    const body = JSON.stringify({
      travellers: [
        { ref: "P1", certainty: "EXPLICIT", evidence: ["M01.S01"] },
      ],
      constraints: [
        {
          ownerRef: "P1",
          value: { kind: "BUDGET_MAX", amountMajor: 450, currency: "SGD" },
          proposedStrength: "HARD",
          certainty: "EXPLICIT",
          evidence: ["M01.S01"],
        },
        {
          ownerRef: "P1",
          value: { kind: "BUDGET_MAX", amountMajor: 450, currency: "not a code" },
          proposedStrength: "HARD",
          certainty: "EXPLICIT",
          evidence: ["M01.S01"],
        },
      ],
    });
    const result = runExtractionPipeline({ ...base, rawResponse: body });
    // The valid half is NOT kept. The whole extraction failed.
    if (result.outcome !== "FAILED") throw new Error("expected failure");
    expect(result.code).toBe("SCHEMA_INVALID");
  });

  it("reports counts on success and zeroes on failure", () => {
    const ok = runExtractionPipeline({
      ...base,
      rawResponse: JSON.stringify({
        travellers: [
          { ref: "P1", certainty: "EXPLICIT", evidence: ["M01.S01"] },
        ],
        ambiguities: [
          {
            question: "Whose budget is that?",
            whyItMatters: "It changes which flights are affordable.",
            evidence: ["M01.S01"],
          },
        ],
      }),
    });
    if (ok.outcome !== "SUCCESS") throw new Error("expected success");
    expect(ok.diagnostics.travellerCount).toBe(1);
    expect(ok.diagnostics.ambiguityCount).toBe(1);

    const bad = runExtractionPipeline({ ...base, rawResponse: "{" });
    if (bad.outcome !== "FAILED") throw new Error("expected failure");
    expect(bad.diagnostics.travellerCount).toBe(0);
  });
});

describe("certainty travels with the constraint, not with its position", () => {
  it("records the certainty of every constraint against its own id", () => {
    const mapped = mapIntentToDomain(
      intent({
        constraints: [
          {
            ownerRef: "P1",
            value: { kind: "BUDGET_MAX", amountMajor: 450, currency: "SGD" },
            proposedStrength: "HARD",
            certainty: "EXPLICIT",
            source: ev("M01.S01"),
          },
          {
            ownerRef: "P2",
            value: { kind: "MAX_STOPS", maxStops: 0 },
            proposedStrength: "SOFT",
            certainty: "AMBIGUOUS",
            source: ev("M02.S01"),
          },
        ],
        assistanceNeeds: [
          {
            ownerRef: "P1",
            need: "STEP_FREE_ACCESS",
            certainty: "LIKELY",
            source: ev("M01.S01"),
          },
        ],
      }),
      MAPPING,
    );

    // Three constraints: two extracted, one derived from the assistance need.
    expect(mapped.constraints).toHaveLength(3);
    for (const constraint of mapped.constraints) {
      expect(
        mapped.certaintyByConstraintId.has(constraint.id as string),
        `no certainty recorded for ${constraint.id as string}`,
      ).toBe(true);
    }

    const byKind = (kind: string) =>
      mapped.constraints.find((c) => c.value.kind === kind)?.id as string;
    expect(mapped.certaintyByConstraintId.get(byKind("BUDGET_MAX"))).toBe("EXPLICIT");
    expect(mapped.certaintyByConstraintId.get(byKind("MAX_STOPS"))).toBe("AMBIGUOUS");
    // The assistance-derived constraint inherits the need's own certainty.
    expect(mapped.certaintyByConstraintId.get(byKind("ASSISTANCE_REQUIRED"))).toBe("LIKELY");
  });

  it("keeps the quote on the constraint itself", () => {
    const mapped = mapIntentToDomain(intent(), MAPPING);
    for (const constraint of mapped.constraints) {
      expect(constraint.provenance?.sourceQuote).toBeTruthy();
    }
  });
});
