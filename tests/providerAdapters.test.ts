import { describe, it, expect } from "vitest";
import type { ModelStudioTransport, TransportOutcome } from "@/adapters/modelStudio/transport";
import { HttpModelStudioTransport, redactSecrets, safeErrorMessage } from "@/adapters/modelStudio/transport";
import { QwenLanguageUnderstandingProvider } from "@/adapters/modelStudio/qwenLanguageUnderstanding";
import { QwenWebResearchProvider } from "@/adapters/modelStudio/qwenWebResearch";
import { readResponsesBody } from "@/adapters/modelStudio/responsesShape";
import { parseResearchPayload } from "@/adapters/modelStudio/researchPayload";
import { readSharedLink, readInterestLabel } from "@/adapters/modelStudio/sharedLinkReader";
import { FixtureLanguageUnderstandingProvider } from "@/adapters/fixture/fixtureLanguageUnderstanding";
import { FixtureResearchProvider } from "@/adapters/fixture/fixtureResearch";
import { FIXTURE_DISCUSSION } from "@/adapters/fixture/extractionFixtures";
import { DEFAULT_RESEARCH_BUDGET } from "@/core/research/budget";
import { buildBaseUrl, describeConfig, readModelStudioConfig } from "@/adapters/modelStudio/config";
import { asIsoDateTime, asResearchQuestionId } from "@/domain/index";
import type { ModelStudioConfig } from "@/adapters/modelStudio/config";
import type { ResearchQuestion } from "@/domain/research";

const NOW = asIsoDateTime("2026-08-01T09:00:00+08:00");

const CONFIG: ModelStudioConfig = {
  configured: true,
  mode: "live",
  apiKey: "sk-test-key-not-real-0000000000",
  baseUrl: "https://ws-test.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1",
  region: "ap-southeast-1",
  workspaceId: "ws-test",
  extractionModel: "qwen3.7-plus",
  researchModel: "qwen3.7-plus",
  structuredOutputMode: "json_object",
  timeoutMs: 5000,
};

/** A transport that returns whatever the test hands it. No network involved. */
function stubTransport(outcome: TransportOutcome): ModelStudioTransport & {
  readonly calls: { path: string; body: unknown }[];
} {
  const calls: { path: string; body: unknown }[] = [];
  return {
    calls,
    async send(request) {
      calls.push({ path: request.path, body: request.body });
      return Promise.resolve(outcome);
    },
  };
}

function chatBody(content: string): TransportOutcome {
  return {
    ok: true,
    status: 200,
    durationMs: 120,
    body: {
      choices: [{ message: { content } }],
      usage: { prompt_tokens: 900, completion_tokens: 300 },
    },
  };
}

const QUESTION: ResearchQuestion = {
  id: asResearchQuestionId("Q-1"),
  kind: "MULTIGENERATIONAL_ACTIVITY",
  destinationLabel: "Tokyo",
  context: {
    groupSize: 7,
    ageBands: ["OLDER_ADULT", "TEEN", "CHILD"],
    statedInterests: ["food markets"],
    accessibilityNeeds: ["STEP_FREE_ACCESS"],
    dietaryNeeds: [],
    pace: "BALANCED",
  },
  sourcePreference: "ANY",
  maxSources: 5,
  purpose: "Find one thing the whole group can do together.",
};

describe("configuration", () => {
  it("reports NOT CONFIGURED rather than throwing when there is no key", () => {
    // Live mode set so the reader gets past the kill switch and actually looks
    // for a credential. Without it the answer is "switched off", which is a
    // different statement and is covered separately.
    const result = readModelStudioConfig({
      MODEL_STUDIO_MODE: "live",
      MODEL_STUDIO_WORKSPACE_ID: "ws-test",
    });
    expect(result.configured).toBe(false);
    if (result.configured) throw new Error("expected not configured");
    expect(result.missing).toContain("DASHSCOPE_API_KEY");
  });

  it("reports switched-off before it reports anything about credentials", () => {
    const result = readModelStudioConfig({});
    if (result.configured) throw new Error("expected not configured");
    expect(result.mode).toBe("disabled");
    expect(result.reason).toContain("switched off");
    // Nothing was even looked for, so nothing is reported missing.
    expect(result.missing).toEqual([]);
  });

  it("builds a workspace endpoint from configuration, never from a constant", () => {
    const result = buildBaseUrl({ region: "ap-southeast-1", workspaceId: "llm-abc123" });
    if (!result.ok) throw new Error("expected success");
    expect(result.baseUrl).toBe(
      "https://llm-abc123.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1",
    );
  });

  it("refuses a workspace id that could rewrite the hostname", () => {
    for (const workspaceId of ["a.b/../evil", "ws test", "ws@evil.com", "ws/../.."]) {
      const result = buildBaseUrl({ region: "ap-southeast-1", workspaceId });
      expect(result.ok, workspaceId).toBe(false);
    }
  });

  it("refuses an unknown region", () => {
    const result = buildBaseUrl({ region: "mars-central-1", workspaceId: "ws" });
    expect(result.ok).toBe(false);
  });

  it("lets an explicit base URL win, but only over https", () => {
    const good = buildBaseUrl({
      region: "ap-southeast-1",
      explicitBaseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/",
    });
    if (!good.ok) throw new Error("expected success");
    expect(good.baseUrl).toBe("https://dashscope-intl.aliyuncs.com/compatible-mode/v1");

    const bad = buildBaseUrl({
      region: "ap-southeast-1",
      explicitBaseUrl: "http://insecure.example.com/v1",
    });
    expect(bad.ok).toBe(false);
  });

  it("reads models and timeout from the environment with safe defaults", () => {
    const result = readModelStudioConfig({
      MODEL_STUDIO_MODE: "live",
      DASHSCOPE_API_KEY: "sk-x",
      MODEL_STUDIO_WORKSPACE_ID: "ws",
      QWEN_EXTRACTION_MODEL: "qwen3.7-max",
    });
    if (!result.configured) throw new Error("expected configured");
    expect(result.extractionModel).toBe("qwen3.7-max");
    expect(result.researchModel).toBe("qwen3.7-plus");
    expect(result.timeoutMs).toBe(30_000);
  });

  it("never puts the key, its length or its prefix into a description", () => {
    const result = readModelStudioConfig({
      MODEL_STUDIO_MODE: "live",
      DASHSCOPE_API_KEY: "sk-super-secret-value-1234567890",
      MODEL_STUDIO_WORKSPACE_ID: "ws-private-id",
    });
    const described = JSON.stringify(describeConfig(result));
    expect(described).not.toContain("sk-super-secret-value-1234567890");
    expect(described).not.toContain("sk-");
    // The workspace id is configuration about somebody's account too.
    expect(described).not.toContain("ws-private-id");
    expect(described).toContain("CONFIGURED");
  });

  it("describes the not-configured state safely", () => {
    const described = describeConfig(readModelStudioConfig({}));
    expect(described["status"]).toBe("NOT_CONFIGURED");
  });
});

describe("transport", () => {
  it("aborts rather than waiting when the provider is slow", async () => {
    let elapsed = 0;
    const transport = new HttpModelStudioTransport(
      CONFIG,
      () => (elapsed += 10),
      // A fetch that never resolves until aborted.
      ((_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          });
        })) as unknown as typeof fetch,
    );

    const result = await transport.send({ path: "/chat/completions", body: {}, timeoutMs: 20 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("TIMEOUT");
  });

  it("sends the key only in the Authorization header", async () => {
    let seenInit: RequestInit | undefined;
    const transport = new HttpModelStudioTransport(
      CONFIG,
      () => 0,
      ((_url: string, init?: RequestInit) => {
        seenInit = init;
        return Promise.resolve(new Response("{}", { status: 200 }));
      }) as unknown as typeof fetch,
    );
    await transport.send({ path: "/chat/completions", body: { model: "x" }, timeoutMs: 100 });
    const headers = seenInit?.headers as Record<string, string> | undefined;
    expect(headers?.["Authorization"]).toContain(CONFIG.apiKey);
    // The body is a JSON string here; the key must not be anywhere in it.
    const body: unknown = seenInit?.body;
    expect(typeof body === "string" ? body : "").not.toContain(CONFIG.apiKey);
  });

  it("reports a non-JSON response as malformed rather than crashing", async () => {
    const transport = new HttpModelStudioTransport(
      CONFIG,
      () => 0,
      () => Promise.resolve(new Response("<html>gateway error</html>", { status: 200 })),
    );
    const result = await transport.send({ path: "/x", body: {}, timeoutMs: 100 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("MALFORMED_RESPONSE");
  });

  it("does not leak the endpoint or workspace in a network failure message", async () => {
    const transport = new HttpModelStudioTransport(
      CONFIG,
      () => 0,
      () => Promise.reject(new Error("getaddrinfo ENOTFOUND ws-test.ap-southeast-1.maas.aliyuncs.com")),
    );
    const result = await transport.send({ path: "/x", body: {}, timeoutMs: 100 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).not.toContain("ws-test");
  });

  it("redacts anything key-shaped from a provider error message", () => {
    expect(redactSecrets("your key sk-abcdef1234567890 is invalid")).toContain("[redacted]");
    expect(redactSecrets("Authorization: Bearer abcdefgh12345678")).toContain("[redacted]");
    expect(safeErrorMessage(401, { error: { message: "Invalid API key sk-abcdef1234567890" } })).not.toContain(
      "sk-abcdef1234567890",
    );
  });
});

describe("the live extraction adapter", () => {
  it("asks for structured output and a deterministic temperature", async () => {
    const transport = stubTransport(chatBody("{}"));
    const provider = new QwenLanguageUnderstandingProvider(CONFIG, transport);
    await provider.extractIntent({ discussion: "Ama: hello", now: NOW, requestId: "R1" });

    const body = transport.calls[0]?.body as Record<string, unknown>;
    expect(transport.calls[0]?.path).toBe("/chat/completions");
    expect(body["response_format"]).toEqual({ type: "json_object" });
    expect(body["temperature"]).toBe(0);
    // Capping output under structured output truncates the JSON.
    expect(body["max_tokens"]).toBeUndefined();
  });

  it("reports a timeout as MODEL_TIMEOUT, distinctly from a failure", async () => {
    const provider = new QwenLanguageUnderstandingProvider(
      CONFIG,
      stubTransport({ ok: false, kind: "TIMEOUT", message: "too slow", durationMs: 5000 }),
    );
    const result = await provider.extractIntent({ discussion: "x", now: NOW, requestId: "R1" });
    if (result.outcome !== "FAILED") throw new Error("expected failure");
    expect(result.code).toBe("MODEL_TIMEOUT");
    expect(result.diagnostics.durationMs).toBe(5000);
  });

  it("reports an unreachable provider as MODEL_UNAVAILABLE", async () => {
    const provider = new QwenLanguageUnderstandingProvider(
      CONFIG,
      stubTransport({ ok: false, kind: "NETWORK", message: "unreachable", durationMs: 30 }),
    );
    const result = await provider.extractIntent({ discussion: "x", now: NOW, requestId: "R1" });
    if (result.outcome !== "FAILED") throw new Error("expected failure");
    expect(result.code).toBe("MODEL_UNAVAILABLE");
  });

  it("reports an empty completion as malformed rather than as an empty reading", async () => {
    const provider = new QwenLanguageUnderstandingProvider(
      CONFIG,
      stubTransport({ ok: true, status: 200, durationMs: 10, body: { choices: [] } }),
    );
    const result = await provider.extractIntent({ discussion: "x", now: NOW, requestId: "R1" });
    if (result.outcome !== "FAILED") throw new Error("expected failure");
    expect(result.code).toBe("MALFORMED_JSON");
  });

  it("records token usage when the provider reports it", async () => {
    const discussion = "Ama: I cannot spend more than 400 SGD.";
    const body = JSON.stringify({
      travellers: [
        { ref: "P1", displayName: "Ama", certainty: "EXPLICIT", source: { quote: "I cannot spend more than 400 SGD." } },
      ],
      constraints: [],
    });
    const provider = new QwenLanguageUnderstandingProvider(CONFIG, stubTransport(chatBody(body)));
    const result = await provider.extractIntent({ discussion, now: NOW, requestId: "R1" });
    expect(result.diagnostics.inputTokens).toBe(900);
    expect(result.diagnostics.outputTokens).toBe(300);
  });
});

describe("reading the Responses API output", () => {
  const RECORDED = {
    id: "resp-1",
    object: "response",
    status: "completed",
    output: [
      { type: "reasoning", summary: [{ type: "summary_text", text: "thinking about it" }] },
      {
        type: "web_search_call",
        status: "completed",
        action: {
          type: "search",
          query: "Tokyo step-free garden",
          sources: [
            { type: "url", url: "https://www.tokyometro.jp/en/tips/barrier_free/index.html" },
            { type: "url", url: "https://www.reddit.com/r/JapanTravel/comments/x/" },
          ],
        },
      },
      {
        type: "web_extractor_call",
        status: "completed",
        goal: "read the access page",
        output: "some extracted text",
        urls: ["https://www.tokyometro.jp/en/tips/barrier_free/index.html"],
      },
      {
        type: "message",
        content: [{ type: "output_text", text: '{"claims":[]}' }],
      },
    ],
    usage: { input_tokens: 40836, output_tokens: 2106, total_tokens: 42942 },
  };

  it("takes source URLs from the tool call, not from the message text", () => {
    const read = readResponsesBody(RECORDED);
    expect(read.sources).toHaveLength(2);
    expect(read.sources[0]?.url).toBe("https://www.tokyometro.jp/en/tips/barrier_free/index.html");
    expect(read.sources[0]?.searchQuery).toBe("Tokyo step-free garden");
    expect(read.sources[0]?.rank).toBe(1);
  });

  it("ignores the reasoning summary, which is narration and not evidence", () => {
    const read = readResponsesBody(RECORDED);
    expect(read.text).toBe('{"claims":[]}');
    expect(read.text).not.toContain("thinking about it");
  });

  it("counts the operations and the pages the extractor was pointed at", () => {
    const read = readResponsesBody(RECORDED);
    expect(read.searchOperations).toBe(1);
    expect(read.extractionOperations).toBe(1);
    expect(read.extractedUrls).toHaveLength(1);
  });

  it("records token usage where the provider gives it", () => {
    const read = readResponsesBody(RECORDED);
    expect(read.inputTokens).toBe(40836);
    expect(read.outputTokens).toBe(2106);
  });

  it("records a blocked extraction rather than pretending it succeeded", () => {
    const read = readResponsesBody({
      output: [{ type: "web_extractor_call", status: "failed", urls: ["https://www.tiktok.com/@x/video/1"] }],
    });
    expect(read.failedOperations).toHaveLength(1);
    expect(read.failedOperations[0]).toContain("web_extractor");
  });

  it("returns nothing rather than crashing on an unreadable body", () => {
    for (const body of [null, "text", 42, {}, { output: "not an array" }]) {
      const read = readResponsesBody(body);
      expect(read.sources).toHaveLength(0);
    }
  });

  it("tolerates a source list of plain strings", () => {
    const read = readResponsesBody({
      output: [
        {
          type: "web_search_call",
          action: { query: "q", sources: ["https://example.com/a", "https://example.com/b"] },
        },
      ],
    });
    expect(read.sources).toHaveLength(2);
  });
});

describe("the research payload validator", () => {
  it("rejects a payload that is not JSON", () => {
    const result = parseResearchPayload("Here is what I found about Tokyo...");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("MALFORMED_JSON");
  });

  it("rejects a payload with no readable claim", () => {
    const result = parseResearchPayload(JSON.stringify({ claims: [{ statement: 42 }] }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("SCHEMA_INVALID");
  });

  it("rejects an unknown claim type rather than guessing one", () => {
    const result = parseResearchPayload(
      JSON.stringify({ claims: [{ statement: "x", claimType: "DEFINITELY_TRUE", citedUrls: [] }] }),
    );
    expect(result.ok).toBe(false);
  });

  it("drops a suggestion whose reason points at no claim", () => {
    const result = parseResearchPayload(
      JSON.stringify({
        claims: [{ statement: "x", claimType: "COMMUNITY_SIGNAL", citedUrls: [] }],
        suggestions: [
          { title: "A", what: "b", candidateSlot: "Day 1", whyItMayFit: [{ text: "r", claimIndex: 9 }] },
          { title: "B", what: "b", candidateSlot: "Day 1", whyItMayFit: [] },
        ],
      }),
    );
    if (!result.ok) throw new Error("expected success");
    // Neither survives: one cites a claim that does not exist, one cites nothing.
    expect(result.suggestions).toHaveLength(0);
  });

  it("accepts a fenced payload", () => {
    const result = parseResearchPayload(
      "```json\n" + JSON.stringify({ claims: [{ statement: "x", claimType: "COMMUNITY_SIGNAL", citedUrls: [] }] }) + "\n```",
    );
    expect(result.ok).toBe(true);
  });
});

describe("the live research adapter", () => {
  function responsesOutcome(sources: readonly string[], text: string): TransportOutcome {
    return {
      ok: true,
      status: 200,
      durationMs: 900,
      body: {
        output: [
          {
            type: "web_search_call",
            status: "completed",
            action: { query: "q", sources: sources.map((url) => ({ type: "url", url })) },
          },
          { type: "message", content: [{ type: "output_text", text }] },
        ],
        usage: { input_tokens: 100, output_tokens: 50 },
      },
    };
  }

  it("enables web search and extraction, and never the code interpreter", async () => {
    const transport = stubTransport(responsesOutcome([], "{}"));
    const provider = new QwenWebResearchProvider(CONFIG, transport);
    await provider.answer(QUESTION, DEFAULT_RESEARCH_BUDGET, { now: NOW, requestId: "R1" });
    const body = transport.calls[0]?.body as { tools?: { type: string }[] };
    expect(transport.calls[0]?.path).toBe("/responses");
    expect(body.tools?.map((t) => t.type).sort()).toEqual(["web_extractor", "web_search"]);
  });

  it("reports ZERO_SOURCES when the search found nothing usable", async () => {
    const provider = new QwenWebResearchProvider(CONFIG, stubTransport(responsesOutcome([], "{}")));
    const result = await provider.answer(QUESTION, DEFAULT_RESEARCH_BUDGET, {
      now: NOW,
      requestId: "R1",
    });
    if (result.outcome !== "FAILED") throw new Error("expected failure");
    expect(result.code).toBe("ZERO_SOURCES");
  });

  it("keeps the retrieved sources when the answer itself was unreadable", async () => {
    const provider = new QwenWebResearchProvider(
      CONFIG,
      stubTransport(responsesOutcome(["https://www.tokyometro.jp/en/x"], "not json at all")),
    );
    const result = await provider.answer(QUESTION, DEFAULT_RESEARCH_BUDGET, {
      now: NOW,
      requestId: "R1",
    });
    if (result.outcome !== "FAILED") throw new Error("expected failure");
    expect(result.code).toBe("MALFORMED_JSON");
    // The search really happened, so what it returned is not thrown away.
    expect(result.partialLedger?.sources).toHaveLength(1);
  });

  it("rejects a citation to a page the search never returned", async () => {
    const payload = JSON.stringify({
      claims: [
        {
          statement: "The station has lift access.",
          claimType: "OPERATIONAL_FACT",
          citedUrls: ["https://www.invented-source.example.com/access"],
        },
      ],
    });
    const provider = new QwenWebResearchProvider(
      CONFIG,
      stubTransport(responsesOutcome(["https://www.tokyometro.jp/en/x"], payload)),
    );
    const result = await provider.answer(QUESTION, DEFAULT_RESEARCH_BUDGET, {
      now: NOW,
      requestId: "R1",
    });
    if (result.outcome !== "SUCCESS") throw new Error("expected success");
    expect(result.ledger.rejectedCitations).toContain("https://www.invented-source.example.com/access");
    expect(result.ledger.claims[0]?.state).toBe("UNVERIFIED");
  });

  it("reports a timeout as RESEARCH_TIMEOUT and records that a limit was hit", async () => {
    const provider = new QwenWebResearchProvider(
      CONFIG,
      stubTransport({ ok: false, kind: "TIMEOUT", message: "slow", durationMs: 45000 }),
    );
    const result = await provider.answer(QUESTION, DEFAULT_RESEARCH_BUDGET, {
      now: NOW,
      requestId: "R1",
    });
    if (result.outcome !== "FAILED") throw new Error("expected failure");
    expect(result.code).toBe("RESEARCH_TIMEOUT");
    expect(result.diagnostics.limitReached).toBe(true);
  });

  it("takes the tighter of the question limit and the run budget", async () => {
    const transport = stubTransport(responsesOutcome([], "{}"));
    const provider = new QwenWebResearchProvider(CONFIG, transport);
    await provider.answer({ ...QUESTION, maxSources: 50 }, DEFAULT_RESEARCH_BUDGET, {
      now: NOW,
      requestId: "R1",
    });
    const body = transport.calls[0]?.body as { input?: { content?: string }[] };
    const instruction = body.input?.[1]?.content ?? "";
    expect(instruction).toContain(`at most ${String(DEFAULT_RESEARCH_BUDGET.maxSourcesPerQuestion)} sources`);
  });

  it("refuses to start when the run budget is already spent", async () => {
    const provider = new QwenWebResearchProvider(CONFIG, stubTransport(responsesOutcome([], "{}")));
    const result = await provider.answer(
      QUESTION,
      { ...DEFAULT_RESEARCH_BUDGET, maxQuestions: 0 },
      { now: NOW, requestId: "R1" },
    );
    if (result.outcome !== "FAILED") throw new Error("expected failure");
    expect(result.code).toBe("RESEARCH_LIMIT_REACHED");
  });
});

describe("user-shared links", () => {
  it("refuses an unsafe URL before any request is made", async () => {
    const transport = stubTransport({ ok: true, status: 200, durationMs: 1, body: {} });
    const reading = await readSharedLink("http://169.254.169.254/latest/meta-data/", {
      config: CONFIG,
      transport,
      now: NOW,
    });
    expect(reading.link.state).toBe("URL_REJECTED");
    // Nothing was sent. The check happened first.
    expect(transport.calls).toHaveLength(0);
  });

  it("reports NOT_CONFIGURED when no provider can read a page", async () => {
    const reading = await readSharedLink("https://www.tiktok.com/@someone/video/123", {
      config: undefined,
      transport: undefined,
      now: NOW,
    });
    expect(reading.link.state).toBe("NOT_CONFIGURED");
    expect(reading.link.platform).toBe("TikTok");
  });

  it("reports a blocked social page as unavailable, and invents nothing", async () => {
    const reading = await readSharedLink("https://www.instagram.com/p/abc123/", {
      config: CONFIG,
      transport: stubTransport({
        ok: false,
        kind: "HTTP_ERROR",
        message: "The provider could not read the page.",
        status: 403,
        durationMs: 400,
      }),
      now: NOW,
    });
    expect(reading.link.state).toBe("EXTRACTION_UNAVAILABLE");
    expect(reading.link.platform).toBe("Instagram");
    expect(reading.interest).toBeUndefined();
  });

  it("reports unavailable when the page was reached but said it was unreadable", async () => {
    const reading = await readSharedLink("https://www.tiktok.com/@someone/video/123", {
      config: CONFIG,
      transport: stubTransport({
        ok: true,
        status: 200,
        durationMs: 300,
        body: {
          output: [
            { type: "message", content: [{ type: "output_text", text: '{"interest":null,"readable":false}' }] },
          ],
        },
      }),
      now: NOW,
    });
    expect(reading.link.state).toBe("EXTRACTION_UNAVAILABLE");
    expect(reading.interest).toBeUndefined();
  });

  it("produces at most an INFERRED interest when a page can be read", async () => {
    const reading = await readSharedLink("https://www.youtube.com/watch?v=abc", {
      config: CONFIG,
      transport: stubTransport({
        ok: true,
        status: 200,
        durationMs: 300,
        body: {
          output: [
            {
              type: "message",
              content: [{ type: "output_text", text: '{"interest":"night market food","readable":true}' }],
            },
          ],
        },
      }),
      now: NOW,
    });
    expect(reading.link.state).toBe("EXTRACTED");
    expect(reading.interest?.label).toBe("night market food");
    // Sharing a link is not asking for the thing in it.
    expect(reading.interest?.status).toBe("INFERRED");
  });

  it("only enables extraction, never a search, for a page we already have", async () => {
    const transport = stubTransport({ ok: true, status: 200, durationMs: 1, body: {} });
    await readSharedLink("https://example.com/article", {
      config: CONFIG,
      transport,
      now: NOW,
    });
    const body = transport.calls[0]?.body as { tools?: { type: string }[] };
    expect(body.tools?.map((t) => t.type)).toEqual(["web_extractor"]);
  });

  it("refuses to read an interest out of anything that is not the agreed shape", () => {
    expect(readInterestLabel("night market food")).toBeUndefined();
    expect(readInterestLabel('{"readable":false,"interest":"guessed"}')).toBeUndefined();
    expect(readInterestLabel('{"interest":""}')).toBeUndefined();
    expect(readInterestLabel(`{"interest":"${"x".repeat(80)}"}`)).toBeUndefined();
    expect(readInterestLabel('{"interest":"street food","readable":true}')).toBe("street food");
  });
});

describe("fixture providers run the same rules as the live ones", () => {
  it("labels itself a fixture and never claims to be live", async () => {
    const provider = new FixtureLanguageUnderstandingProvider();
    expect(provider.mode).toBe("LOCAL_FIXTURE");
    const result = await provider.extractIntent({
      discussion: FIXTURE_DISCUSSION,
      now: NOW,
      requestId: "R1",
    });
    expect(result.diagnostics.providerName).toBe("local-fixture");
  });

  it("puts the hero fixture through the real validation pipeline", async () => {
    const provider = new FixtureLanguageUnderstandingProvider();
    const result = await provider.extractIntent({
      discussion: FIXTURE_DISCUSSION,
      now: NOW,
      requestId: "R1",
    });
    if (result.outcome !== "SUCCESS") throw new Error("the hero fixture failed validation");
    expect(result.mapped.travellers).toHaveLength(7);
    // Every proposal is still a proposal.
    expect(result.mapped.constraints.every((c) => c.confirmation === "PROPOSED")).toBe(true);
    expect(result.intent.ambiguities.length).toBeGreaterThan(0);
  });

  it("produces the same result every time it is run", async () => {
    const provider = new FixtureLanguageUnderstandingProvider();
    const run = async () =>
      JSON.stringify(
        await provider.extractIntent({
          discussion: FIXTURE_DISCUSSION,
          now: NOW,
          requestId: "R1",
        }),
      );
    expect(new Set([await run(), await run(), await run()]).size).toBe(1);
  });

  it("applies the operational-fact downgrade to recorded research too", async () => {
    const provider = new FixtureResearchProvider("RECORDED_WEB");
    const result = await provider.answer(QUESTION, DEFAULT_RESEARCH_BUDGET, {
      now: NOW,
      requestId: "R1",
    });
    if (result.outcome !== "SUCCESS") throw new Error("expected success");

    // The fixture deliberately over-claims a lift as an operational fact with
    // only a community source. The rules downgrade it here exactly as live.
    const overclaimed = result.ledger.claims.find((c) => c.statement.includes("working lift"));
    expect(overclaimed?.claimType).toBe("COMMUNITY_SIGNAL");
    expect(overclaimed?.needsConfirmation).toBe(true);
  });

  it("rejects the fixture's invented citation exactly as a live one would be", async () => {
    const provider = new FixtureResearchProvider("RECORDED_WEB");
    const result = await provider.answer(QUESTION, DEFAULT_RESEARCH_BUDGET, {
      now: NOW,
      requestId: "R1",
    });
    if (result.outcome !== "SUCCESS") throw new Error("expected success");
    expect(result.ledger.rejectedCitations.length).toBeGreaterThan(0);
  });

  it("surfaces the fixture's genuine disagreement as a conflict", async () => {
    const provider = new FixtureResearchProvider("RECORDED_WEB");
    const result = await provider.answer(QUESTION, DEFAULT_RESEARCH_BUDGET, {
      now: NOW,
      requestId: "R1",
    });
    if (result.outcome !== "SUCCESS") throw new Error("expected success");
    const conflicting = result.ledger.claims.filter((c) => c.state === "CONFLICTING");
    expect(conflicting.length).toBe(2);
  });

  it("counts community sources from the ledger, never from a written number", async () => {
    const provider = new FixtureResearchProvider("RECORDED_WEB");
    const result = await provider.answer(QUESTION, DEFAULT_RESEARCH_BUDGET, {
      now: NOW,
      requestId: "R1",
    });
    if (result.outcome !== "SUCCESS") throw new Error("expected success");
    const communitySources = result.ledger.sources.filter((s) => s.authority === "COMMUNITY");
    expect(result.community?.sourcesConsidered).toBe(communitySources.length);
  });

  it("never reports a fixture answer as live", async () => {
    const provider = new FixtureResearchProvider("RECORDED_WEB");
    const result = await provider.answer(QUESTION, DEFAULT_RESEARCH_BUDGET, {
      now: NOW,
      requestId: "R1",
    });
    expect(result.diagnostics.mode).toBe("RECORDED_WEB");
    expect(provider.mode).not.toBe("LIVE_WEB");
  });
});
