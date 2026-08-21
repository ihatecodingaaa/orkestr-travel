import { describe, it, expect } from "vitest";
import type { ModelStudioTransport, TransportOutcome } from "@/adapters/modelStudio/transport";
import { QwenLanguageUnderstandingProvider } from "@/adapters/modelStudio/qwenLanguageUnderstanding";
import type { ModelStudioConfig } from "@/adapters/modelStudio/config";
import { asIsoDateTime } from "@/domain/index";

/**
 * The JSON-mode contract.
 *
 * Model Studio's `json_object` response format has a hard provider-side
 * requirement: the word "JSON" must appear in the request messages. A request
 * that sets the format without it is rejected with a 400, and the failure would
 * surface as MODEL_UNAVAILABLE -- a network-shaped error for what is actually a
 * request-construction bug.
 *
 * `tests/prompts.test.ts` asserts the word is in the system prompt. That is a
 * weaker guarantee than it looks: it checks the constant, not the request. If
 * the adapter ever stopped sending that message, or reordered it away, or sent
 * only the user message, the prompt test would still pass and every live call
 * would fail.
 *
 * So these assertions are made against the SERIALISED REQUEST BODY the adapter
 * actually builds, which is the thing the provider validates.
 */

const NOW = asIsoDateTime("2026-08-01T09:00:00+08:00");

const CONFIG: ModelStudioConfig = {
  configured: true,
  apiKey: "sk-test-key-not-real-0000000000",
  baseUrl: "https://ws-test.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1",
  region: "ap-southeast-1",
  workspaceId: "ws-test",
  extractionModel: "qwen3.7-plus",
  researchModel: "qwen3.7-plus",
  structuredOutputMode: "json_object",
  timeoutMs: 5000,
};

function capturingTransport(): ModelStudioTransport & {
  readonly bodies: unknown[];
} {
  const bodies: unknown[] = [];
  const outcome: TransportOutcome = {
    ok: true,
    status: 200,
    durationMs: 1,
    body: { choices: [{ message: { content: "{}" } }] },
  };
  return {
    bodies,
    async send(request) {
      bodies.push(request.body);
      return Promise.resolve(outcome);
    },
  };
}

interface ChatRequest {
  readonly messages?: readonly { readonly role: string; readonly content: string }[];
  readonly response_format?: { readonly type: string };
  readonly max_tokens?: number;
  readonly temperature?: number;
}

async function buildRequest(config: ModelStudioConfig): Promise<ChatRequest> {
  const transport = capturingTransport();
  const provider = new QwenLanguageUnderstandingProvider(config, transport);
  await provider.extractIntent({
    discussion: "Ama: seven of us for Tokyo in August.",
    now: NOW,
    requestId: "REQ-JSON-MODE",
  });
  return transport.bodies[0] as ChatRequest;
}

describe("json_object mode sends what the provider requires", () => {
  it("puts the literal word JSON in the serialised request body", async () => {
    const body = await buildRequest(CONFIG);
    expect(body.response_format).toEqual({ type: "json_object" });
    // The provider scans the request. So does this.
    expect(JSON.stringify(body)).toContain("JSON");
  });

  it("puts it in the system message, not only somewhere in the payload", async () => {
    const body = await buildRequest(CONFIG);
    const system = body.messages?.find((m) => m.role === "system");
    expect(system).toBeDefined();
    expect(system?.content).toContain("JSON");
  });

  it("puts it in the user message too, so either message alone satisfies the rule", async () => {
    // Belt and braces: Model Studio accepts the word in either message, and a
    // future change that trims the system prompt should not break the request.
    const body = await buildRequest(CONFIG);
    const user = body.messages?.find((m) => m.role === "user");
    expect(user).toBeDefined();
    expect(user?.content).toContain("JSON");
  });

  it("sends exactly one system message and one user message", async () => {
    const body = await buildRequest(CONFIG);
    expect(body.messages?.map((m) => m.role)).toEqual(["system", "user"]);
  });

  it("never sets max_tokens, which would truncate the JSON mid-object", async () => {
    const body = await buildRequest(CONFIG);
    expect(body.max_tokens).toBeUndefined();
  });

  it("asks for a deterministic sample", async () => {
    const body = await buildRequest(CONFIG);
    expect(body.temperature).toBe(0);
  });

  it("still carries the word when json_schema mode is configured instead", async () => {
    // json_schema mode does not require it, but the request is built from the
    // same prompts and switching modes must not silently change the messages.
    const body = await buildRequest({ ...CONFIG, structuredOutputMode: "json_schema" });
    expect(body.response_format?.type).toBe("json_schema");
    expect(JSON.stringify(body.messages)).toContain("JSON");
  });
});
