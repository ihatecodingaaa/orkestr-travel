import { describe, it, expect, vi, afterEach } from "vitest";
import { resolveProviders } from "@/adapters/registry";
import { logExtraction, logResearch } from "@/adapters/diagnostics";
import type { DiagnosticSink } from "@/adapters/diagnostics";
import { DEFAULT_RESEARCH_BUDGET } from "@/core/research/budget";
import { HERO_QUESTION } from "@/ui/demo/researchDemo";
import { FIXTURE_DISCUSSION } from "@/adapters/fixture/extractionFixtures";
import { asIsoDateTime } from "@/domain/index";

/**
 * The provider registry and the diagnostics logger.
 *
 * These sit between the routes and the adapters, and they are where two of the
 * phase's rules actually live: no silent fallback, and no sensitive content in a
 * log. Both are easy to break with a well-meaning edit, so both are asserted.
 */

const NOW = asIsoDateTime("2026-08-01T09:00:00+08:00");

afterEach(() => {
  vi.restoreAllMocks();
});

describe("provider selection has no silent fallback", () => {
  it("uses fixture providers, clearly labelled, when nothing is configured", () => {
    const bundle = resolveProviders({ env: {} });
    expect(bundle.understanding.mode).toBe("LOCAL_FIXTURE");
    expect(bundle.research.mode).toBe("RECORDED_WEB");
    expect(bundle.config.configured).toBe(false);
    // No transport exists, so nothing can be called by accident.
    expect(bundle.transport).toBeUndefined();
  });

  it("uses live providers, labelled live, when credentials exist", () => {
    const bundle = resolveProviders({
      env: { DASHSCOPE_API_KEY: "sk-test", MODEL_STUDIO_WORKSPACE_ID: "ws" },
      now: () => 0,
      fetchImpl: (() => Promise.reject(new Error("no calls in tests"))) as unknown as typeof fetch,
    });
    expect(bundle.understanding.mode).toBe("LIVE_MODEL");
    expect(bundle.research.mode).toBe("LIVE_WEB");
    expect(bundle.transport).toBeDefined();
  });

  it("lets a caller force fixtures, but never lets fixtures claim to be live", () => {
    const bundle = resolveProviders({
      env: { DASHSCOPE_API_KEY: "sk-test", MODEL_STUDIO_WORKSPACE_ID: "ws" },
      forceFixture: true,
    });
    expect(bundle.understanding.mode).toBe("LOCAL_FIXTURE");
    expect(bundle.research.mode).not.toBe("LIVE_WEB");
  });

  it("returns the mode alongside the provider, so a screen cannot take one without the other", () => {
    const bundle = resolveProviders({ env: {} });
    // The mode is a property of the provider itself, not a separate flag a
    // caller could forget to read.
    expect(bundle.understanding).toHaveProperty("mode");
    expect(bundle.research).toHaveProperty("mode");
  });
});

describe("the fixture path works end to end with no credentials", () => {
  it("extracts the demo discussion", async () => {
    const bundle = resolveProviders({ env: {} });
    const result = await bundle.understanding.extractIntent({
      discussion: FIXTURE_DISCUSSION,
      now: NOW,
      requestId: "REQ-1",
    });
    expect(result.outcome).toBe("SUCCESS");
  });

  it("answers the demo research question", async () => {
    const bundle = resolveProviders({ env: {} });
    const answer = await bundle.research.answer(HERO_QUESTION, DEFAULT_RESEARCH_BUDGET, {
      now: NOW,
      requestId: "RES-1",
    });
    expect(answer.outcome).toBe("SUCCESS");
    if (answer.outcome !== "SUCCESS") return;
    expect(answer.ledger.sources.length).toBeGreaterThan(0);
    expect(answer.diagnostics.mode).toBe("RECORDED_WEB");
  });

  it("reports a question it has no recorded answer for, rather than inventing one", async () => {
    const bundle = resolveProviders({ env: {} });
    const answer = await bundle.research.answer(
      { ...HERO_QUESTION, destinationLabel: "Reykjavik" },
      DEFAULT_RESEARCH_BUDGET,
      { now: NOW, requestId: "RES-2" },
    );
    if (answer.outcome !== "FAILED") throw new Error("expected failure");
    expect(answer.code).toBe("ZERO_SOURCES");
  });
});

describe("diagnostics carry counts, never content", () => {
  function capture(): { readonly sink: DiagnosticSink; readonly lines: string[] } {
    const lines: string[] = [];
    return { sink: { write: (line) => lines.push(line) }, lines };
  }

  it("logs the operation, the model and the counts", async () => {
    const bundle = resolveProviders({ env: {} });
    const result = await bundle.understanding.extractIntent({
      discussion: FIXTURE_DISCUSSION,
      now: NOW,
      requestId: "REQ-1",
    });
    const { sink, lines } = capture();
    logExtraction(result.diagnostics, result.outcome, sink);

    const line = lines[0] ?? "";
    expect(line).toContain("op=EXTRACT_INTENT");
    expect(line).toContain("requestId=REQ-1");
    expect(line).toContain("prompt=orkestr-intent-v1");
    expect(line).toContain("travellers=7");
  });

  it("logs no part of the pasted discussion", async () => {
    const bundle = resolveProviders({ env: {} });
    const result = await bundle.understanding.extractIntent({
      discussion: FIXTURE_DISCUSSION,
      now: NOW,
      requestId: "REQ-1",
    });
    const { sink, lines } = capture();
    logExtraction(result.diagnostics, result.outcome, sink);

    const line = lines.join("\n");
    for (const fragment of ["Tokyo", "Gita", "step-free", "600 SGD", "Ryan"]) {
      expect(line, `the log leaked "${fragment}"`).not.toContain(fragment);
    }
  });

  it("logs no accessibility or medical information", async () => {
    const bundle = resolveProviders({ env: {} });
    const result = await bundle.understanding.extractIntent({
      discussion: FIXTURE_DISCUSSION,
      now: NOW,
      requestId: "REQ-1",
    });
    const { sink, lines } = capture();
    logExtraction(result.diagnostics, result.outcome, sink);
    const line = lines.join("\n").toLowerCase();
    expect(line).not.toContain("wheelchair");
    expect(line).not.toContain("assistance");
    expect(line).not.toContain("step");
  });

  it("logs the research question kind but not the group's stated needs", async () => {
    const bundle = resolveProviders({ env: {} });
    const answer = await bundle.research.answer(HERO_QUESTION, DEFAULT_RESEARCH_BUDGET, {
      now: NOW,
      requestId: "RES-1",
    });
    const { sink, lines } = capture();
    logResearch(answer.diagnostics, answer.outcome, sink);

    const line = lines[0] ?? "";
    expect(line).toContain("kind=MULTIGENERATIONAL_ACTIVITY");
    expect(line).toContain("sources=");
    // The stated access need is the sensitive part of a question.
    expect(line).not.toContain("STEP_FREE_ACCESS");
    expect(line).not.toContain("Tokyo");
  });

  it("redacts anything key-shaped that reaches a log line", () => {
    const { sink, lines } = capture();
    logExtraction(
      {
        requestId: "sk-abcdefghijklmnop12345678",
        operation: "EXTRACT_INTENT",
        providerName: "test",
        model: "test",
        promptVersion: "orkestr-intent-v1",
        durationMs: 1,
        travellerCount: 0,
        proposalCount: 0,
        ambiguityCount: 0,
        startedAt: NOW,
      },
      "FAILED",
      sink,
    );
    expect(lines[0]).toContain("[redacted]");
    expect(lines[0]).not.toContain("abcdefghijklmnop12345678");
  });
});
