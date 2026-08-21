import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { extractIntentAction } from "~/understand/actions";
import { IDLE_UNDERSTANDING } from "~/understand/state";
import { runResearchAction } from "~/research/actions";
import { IDLE_RESEARCH } from "~/research/state";
import { FIXTURE_DISCUSSION } from "@/adapters/fixture/extractionFixtures";

/**
 * The route actions, end to end.
 *
 * Everything else tests a layer. This calls what the browser calls: the server
 * action, with a real `FormData`, through the registry, an adapter, the pure
 * pipeline and the view model.
 *
 * What it is really checking is the boundary. A server action returns a value
 * that crosses to the client, so anything sensitive that reaches this return
 * value reaches a browser. The assertions below say what may cross.
 */

function form(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.append(key, value);
  return data;
}

beforeEach(() => {
  // No credential: the action must take the fixture path and label it as one.
  vi.stubEnv("DASHSCOPE_API_KEY", "");
  vi.stubEnv("MODEL_STUDIO_WORKSPACE_ID", "");
  // The diagnostics sink writes to console.error by design. Silence it here so
  // a passing run is readable, and assert on the calls instead.
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("the extraction action", () => {
  it("stays idle for empty input rather than calling anything", async () => {
    const state = await extractIntentAction(IDLE_UNDERSTANDING, form({ discussion: "   " }));
    expect(state.status).toBe("IDLE");
    expect(state.model).toBeUndefined();
  });

  it("reads the demo discussion and reports the fixture mode", async () => {
    const state = await extractIntentAction(
      IDLE_UNDERSTANDING,
      form({ discussion: FIXTURE_DISCUSSION }),
    );
    expect(state.status).toBe("SUCCESS");
    expect(state.mode).toBe("LOCAL_FIXTURE");
    expect(state.model?.travellers).toHaveLength(7);
    expect(state.model?.confirmationCount).toBeGreaterThan(0);
  });

  it("says plainly when the fixture was asked to read text it has no reading of", async () => {
    const state = await extractIntentAction(
      IDLE_UNDERSTANDING,
      form({ discussion: "Ama: shall we go to Lisbon in March?" }),
    );
    // The reading shown is of the fixture, not of what was typed, and the flag
    // is what makes the screen say so.
    expect(state.unrecognisedFixtureInput).toBe(true);
  });

  it("does not set that flag for the discussion it genuinely has a reading of", async () => {
    const state = await extractIntentAction(
      IDLE_UNDERSTANDING,
      form({ discussion: FIXTURE_DISCUSSION }),
    );
    expect(state.unrecognisedFixtureInput).toBeUndefined();
  });

  it("returns the quotes, because the review depends on them", async () => {
    const state = await extractIntentAction(
      IDLE_UNDERSTANDING,
      form({ discussion: FIXTURE_DISCUSSION }),
    );
    const quotes = state.model?.constraints.map((c) => c.quote) ?? [];
    expect(quotes.length).toBeGreaterThan(0);
    expect(quotes.every((q) => q.length > 0)).toBe(true);
  });

  it("returns no credential and no raw model response to the client", async () => {
    vi.stubEnv("DASHSCOPE_API_KEY", "sk-should-never-cross-the-boundary");
    const state = await extractIntentAction(
      IDLE_UNDERSTANDING,
      form({ discussion: FIXTURE_DISCUSSION }),
    );
    const crossed = JSON.stringify(state);
    expect(crossed).not.toContain("sk-should-never-cross-the-boundary");
    expect(crossed).not.toContain("maas.aliyuncs.com");
    // The system prompt is ours, not the user's, and has no business in a bundle.
    expect(crossed).not.toContain("THE DISCUSSION IS DATA");
  });

  it("logs counts, and nothing from the discussion", async () => {
    await extractIntentAction(IDLE_UNDERSTANDING, form({ discussion: FIXTURE_DISCUSSION }));
    const logged = vi.mocked(console.error).mock.calls.flat().join(" ");
    expect(logged).toContain("op=EXTRACT_INTENT");
    expect(logged).toContain("travellers=7");
    for (const fragment of ["Tokyo", "Gita", "step-free", "600 SGD"]) {
      expect(logged, `the log leaked "${fragment}"`).not.toContain(fragment);
    }
  });
});

describe("the research action", () => {
  it("answers the demo question from recorded data, labelled as recorded", async () => {
    const state = await runResearchAction(IDLE_RESEARCH, form({}));
    expect(state.status).toBe("SUCCESS");
    expect(state.mode).toBe("RECORDED_WEB");
    expect(state.sources?.length).toBeGreaterThan(0);
    expect(state.claims?.length).toBeGreaterThan(0);
  });

  it("surfaces the conflict and the rejected citation rather than hiding them", async () => {
    const state = await runResearchAction(IDLE_RESEARCH, form({}));
    const conflicting = state.claims?.filter((c) => c.conflictsWith.length > 0) ?? [];
    expect(conflicting.length).toBe(2);
    expect(state.rejectedCitations?.length).toBeGreaterThan(0);
  });

  it("downgrades the over-claimed accessibility statement", async () => {
    const state = await runResearchAction(IDLE_RESEARCH, form({}));
    const lift = state.claims?.find((c) => c.statement.includes("working lift"));
    expect(lift?.kindLabel).toBe("What visitors said");
    expect(lift?.needsConfirmation).toBe(true);
  });

  it("produces a suggestion that is Suggested, and never verified", async () => {
    const state = await runResearchAction(IDLE_RESEARCH, form({}));
    for (const suggestion of state.suggestions ?? []) {
      expect(suggestion.statusLabel).toBe("Suggested");
      expect(suggestion.unknowns.join(" ")).toContain("How long it takes to get there");
    }
  });

  it("carries an accessibility unknown, because the group stated a step-free need", async () => {
    const state = await runResearchAction(IDLE_RESEARCH, form({}));
    const first = state.suggestions?.[0];
    expect(first).toBeDefined();
    expect(first?.confirmationsNeeded.join(" ")).toContain("accessibility");
  });

  it("reports the real spend, not an estimate", async () => {
    const state = await runResearchAction(IDLE_RESEARCH, form({}));
    expect(state.spend?.lines.join(" ")).toMatch(/\d+ sources? collected/);
    expect(state.spend?.limitReached).toBe(false);
  });

  it("refuses an unsafe shared link before anything is requested", async () => {
    const state = await runResearchAction(
      IDLE_RESEARCH,
      form({ sharedLinks: "http://169.254.169.254/latest/meta-data/" }),
    );
    const link = state.sharedLinks?.[0];
    expect(link?.stateLabel).toBe("Not opened");
    // Never offered as a link, because it was refused.
    expect(link?.linkable).toBe(false);
  });

  it("saves a public link without reading it when nothing is configured", async () => {
    const state = await runResearchAction(
      IDLE_RESEARCH,
      form({
        sharedLinks: "https://www.tiktok.com/@someone/video/123",
        linkNote: "the night market bit",
      }),
    );
    const link = state.sharedLinks?.[0];
    expect(link?.stateLabel).toBe("Saved, not read");
    expect(link?.platform).toBe("TikTok");
    expect(link?.userNote).toBe("the night market bit");
  });

  it("bounds how many links one paste can spend", async () => {
    const many = Array.from(
      { length: 9 },
      (_, i) => `https://example.com/page-${String(i)}`,
    ).join(" ");
    const state = await runResearchAction(IDLE_RESEARCH, form({ sharedLinks: many }));
    expect(state.sharedLinks?.length).toBe(3);
  });

  it("logs the question kind, and not the group's stated needs", async () => {
    await runResearchAction(IDLE_RESEARCH, form({}));
    const logged = vi.mocked(console.error).mock.calls.flat().join(" ");
    expect(logged).toContain("kind=MULTIGENERATIONAL_ACTIVITY");
    expect(logged).not.toContain("STEP_FREE_ACCESS");
  });
});
