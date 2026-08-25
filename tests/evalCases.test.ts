import { describe, it, expect } from "vitest";
import { EVAL_CASES, scoreCase } from "@/eval/cases";
import type { EvalCase } from "@/eval/cases";
import { runExtractionPipeline } from "@/core/intent/pipeline";
import type { ExtractionResult } from "@/domain/extraction";
import { asIsoDateTime } from "@/domain/index";

/**
 * The evaluation set itself, checked deterministically.
 *
 * The scorer decides whether a live model passed or failed, so a bug in it would
 * quietly change every evaluation result. These tests exercise it against
 * constructed results, with no network anywhere.
 */

const NOW = asIsoDateTime("2026-08-01T09:00:00+08:00");

function pipeline(discussion: string, rawResponse: string): ExtractionResult {
  return runExtractionPipeline({
    rawResponse,
    discussion,
    mapping: { now: NOW, idPrefix: "EV", extractedBy: "test" },
    diagnostics: {
      requestId: "EV",
      operation: "EXTRACT_INTENT",
      providerName: "test",
      model: "test",
      promptVersion: "orkestr-intent-v2",
      durationMs: 10,
      startedAt: NOW,
    },
  });
}

const budgetCase = EVAL_CASES.find((c) => c.id === "03-hard-budget") as EvalCase;
const familyCase = EVAL_CASES.find((c) => c.id === "11-mixed-age-family") as EvalCase;
const chatterCase = EVAL_CASES.find((c) => c.id === "17-nothing-to-extract") as EvalCase;

describe("the evaluation set", () => {
  it("holds at least the fifteen cases the phase requires", () => {
    expect(EVAL_CASES.length).toBeGreaterThanOrEqual(15);
  });

  it("gives every case a unique id and a stated purpose", () => {
    const ids = EVAL_CASES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const testCase of EVAL_CASES) {
      expect(testCase.tests.length, testCase.id).toBeGreaterThan(10);
      expect(testCase.discussion.length, testCase.id).toBeGreaterThan(10);
    }
  });

  it("covers the behaviours the phase named", () => {
    const ids = EVAL_CASES.map((c) => c.id).join(" ");
    for (const behaviour of [
      "clear-group",
      "ambiguous-direct-preference",
      "hard-budget",
      "stretchable-budget",
      "late-join",
      "flexible-duration",
      "multiple-date-windows",
      "must-travel-with",
      "prefer-travel-with",
      "step-free",
      "mixed-age-family",
      "conflicting-statements",
      "tentative-traveller",
      "prompt-injection",
      "unnamed-travellers",
    ]) {
      expect(ids, `no case covers ${behaviour}`).toContain(behaviour);
    }
  });

  it("uses no real personal data: every name is from the fictional cast", () => {
    const cast = ["Ama", "Bo", "Cai", "Dara", "Gita", "Elias", "Nadia", "Ryan"];
    for (const testCase of EVAL_CASES) {
      // Every capitalised word at the start of a chat line must be a cast name.
      const speakers = [...testCase.discussion.matchAll(/^([A-Z][a-z]+):/gm)].map((m) => m[1]);
      for (const speaker of speakers) {
        expect(cast, `${testCase.id} uses an unknown name ${String(speaker)}`).toContain(speaker);
      }
    }
  });
});

describe("the scorer accepts a correct reading", () => {
  it("passes a case whose expectations are all met", () => {
    const response = JSON.stringify({
      travellers: [
        {
          ref: "P1",
          displayName: "Ama",
          certainty: "EXPLICIT",
          evidence: ["M01.S01"],
        },
      ],
      constraints: [
        {
          ownerRef: "P1",
          value: { kind: "BUDGET_MAX", amountMajor: 450, currency: "SGD" },
          proposedStrength: "HARD",
          certainty: "EXPLICIT",
          evidence: ["M01.S01"],
        },
      ],
    });
    const outcome = scoreCase(budgetCase, pipeline(budgetCase.discussion, response));
    expect(outcome.failures).toEqual([]);
    expect(outcome.passed).toBe(true);
  });
});

describe("the scorer catches what matters", () => {
  it("fails a case where a required constraint is missing", () => {
    const response = JSON.stringify({
      travellers: [
        {
          ref: "P1",
          displayName: "Ama",
          certainty: "EXPLICIT",
          evidence: ["M01.S01"],
        },
      ],
      constraints: [],
    });
    const outcome = scoreCase(budgetCase, pipeline(budgetCase.discussion, response));
    expect(outcome.passed).toBe(false);
    expect(outcome.failures.join(" ")).toContain("BUDGET_MAX");
  });

  it("fails a case where the wrong person owns the constraint", () => {
    const response = JSON.stringify({
      travellers: [
        {
          ref: "P1",
          displayName: "Bo",
          certainty: "EXPLICIT",
          evidence: ["M01.S01"],
        },
      ],
      constraints: [
        {
          ownerRef: "P1",
          value: { kind: "BUDGET_MAX", amountMajor: 450, currency: "SGD" },
          proposedStrength: "HARD",
          certainty: "EXPLICIT",
          evidence: ["M01.S01"],
        },
      ],
    });
    const outcome = scoreCase(budgetCase, pipeline(budgetCase.discussion, response));
    expect(outcome.passed).toBe(false);
    expect(outcome.failures.join(" ")).toContain("Ama was not found");
  });

  it("fails a case where an assistance need was inferred from an age", () => {
    // The most important negative in the whole set. Being 78 is not a need.
    const response = JSON.stringify({
      travellers: [
        {
          ref: "P1",
          displayName: "Ama",
          certainty: "EXPLICIT",
          evidence: ["M01.S01"],
        },
      ],
      constraints: [],
      assistanceNeeds: [
        {
          ownerRef: "P1",
          need: "REDUCED_WALKING",
          certainty: "LIKELY",
          evidence: ["M01.S01"],
        },
      ],
    });
    const outcome = scoreCase(familyCase, pipeline(familyCase.discussion, response));
    expect(outcome.passed).toBe(false);
    expect(outcome.failures.join(" ")).toContain("INFERRED A NEED");
  });

  it("fails a case where a requirement was invented from chatter", () => {
    const response = JSON.stringify({
      travellers: [
        {
          ref: "P1",
          displayName: "Ama",
          certainty: "EXPLICIT",
          evidence: ["M01.S01"],
        },
      ],
      constraints: [
        {
          ownerRef: "P1",
          value: { kind: "BUDGET_MAX", amountMajor: 500, currency: "SGD" },
          proposedStrength: "SOFT",
          certainty: "LIKELY",
          evidence: ["M01.S01"],
        },
      ],
    });
    const outcome = scoreCase(chatterCase, pipeline(chatterCase.discussion, response));
    expect(outcome.passed).toBe(false);
    expect(outcome.failures.join(" ")).toContain("INVENTED");
  });

  it("reports a failed extraction as a failed case rather than scoring nothing", () => {
    const outcome = scoreCase(budgetCase, pipeline(budgetCase.discussion, "not json"));
    expect(outcome.passed).toBe(false);
    expect(outcome.failures[0]).toContain("MALFORMED_JSON");
  });

  it("checks the safety properties on every case, whatever that case declares", () => {
    // A case with no safety expectations of its own must still catch a confirmed
    // constraint, because the pipeline can never produce one.
    const response = JSON.stringify({
      travellers: [
        {
          ref: "P1",
          displayName: "Ama",
          certainty: "EXPLICIT",
          evidence: ["M01.S01"],
        },
      ],
      constraints: [
        {
          ownerRef: "P1",
          value: { kind: "BUDGET_MAX", amountMajor: 450, currency: "SGD" },
          proposedStrength: "HARD",
          certainty: "EXPLICIT",
          evidence: ["M01.S01"],
        },
      ],
    });
    const result = pipeline(budgetCase.discussion, response);
    if (result.outcome !== "SUCCESS") throw new Error("expected success");
    // Tamper with the mapped result to prove the scorer would notice.
    const tampered: ExtractionResult = {
      ...result,
      mapped: {
        ...result.mapped,
        constraints: result.mapped.constraints.map((c) => ({ ...c, confirmation: "CONFIRMED" as const })),
      },
    };
    const outcome = scoreCase(budgetCase, tampered);
    expect(outcome.failures.join(" ")).toContain("SAFETY");
  });
});
