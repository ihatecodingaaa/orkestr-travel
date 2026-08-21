import { describe, it, expect } from "vitest";
import { readModelStudioConfig, describeConfig } from "@/adapters/modelStudio/config";
import { HttpModelStudioTransport } from "@/adapters/modelStudio/transport";
import { readResponsesBody } from "@/adapters/modelStudio/responsesShape";
import { loadLocalEnv, report, requireConfig } from "./harness";

/**
 * ONE tiny Responses API request, with no tools.
 *
 *   npm run smoke:responses
 *
 * ISOLATING ONE QUESTION: does the Responses API work at all for this workspace,
 * region and model?
 *
 * Extraction being live-verified proves the credential, the region, the endpoint
 * host and the model. It proves nothing about `/responses`, which is a different
 * endpoint with a different request shape and a different response shape. Going
 * straight to web research would confound four unknowns at once, and when it
 * failed we would not know which one broke.
 *
 * So: no tools, no search, no extraction. Fictional content. One question.
 *
 * It also RECORDS THE REAL RESPONSE SHAPE -- keys and types, never content --
 * so the offline parser can be compared against reality rather than against the
 * documentation I wrote it from.
 */

loadLocalEnv();

const config = readModelStudioConfig();
const configured = config.configured;

/** Describe a value's shape without printing what it says. */
function shapeOf(value: unknown, depth = 0): string {
  if (value === null) return "null";
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    return depth >= 2 ? `[${String(value.length)} items]` : `[${String(value.length)} x ${shapeOf(value[0], depth + 1)}]`;
  }
  if (typeof value === "object") {
    const keys = Object.keys(value);
    if (depth >= 2) return `{${keys.length} keys}`;
    return `{${keys.map((k) => `${k}: ${shapeOf((value as Record<string, unknown>)[k], depth + 1)}`).join(", ")}}`;
  }
  // Primitives report their type, not their value. A string's content may be
  // model output; its type is safe.
  return typeof value;
}

describe("Responses API smoke", () => {
  it("reports configuration before anything is called", () => {
    report("configuration", describeConfig(config));
    if (!configured) {
      report("result", { status: "NOT CONFIGURED", detail: "No call was made; skipped, not passed." });
    }
    expect(true).toBe(true);
  });

  it.skipIf(!configured)("accepts a minimal request and returns a readable response", async () => {
    const live = requireConfig(config);
    const transport = new HttpModelStudioTransport(live, () => Date.now());

    const outcome = await transport.send({
      path: "/responses",
      timeoutMs: live.timeoutMs,
      body: {
        model: live.researchModel,
        input: [
          {
            role: "user",
            content:
              "Reply with the single word ACKNOWLEDGED. This is a connectivity check for a fictional travel planning tool.",
          },
        ],
      },
    });

    report("technical", {
      ok: outcome.ok ? "yes" : "NO",
      durationMs: outcome.durationMs,
      model: live.researchModel,
      ...(outcome.ok ? { status: outcome.status } : { kind: outcome.kind, message: outcome.message }),
    });

    if (!outcome.ok) {
      throw new Error(`Responses API failed: ${outcome.kind} - ${outcome.message}`);
    }

    // The whole point of the smoke: what does the real thing actually look like?
    const body = outcome.body as Record<string, unknown>;
    report("actual response shape", {
      topLevelKeys: Object.keys(body).join(", "),
      status: typeof body["status"] === "string" ? body["status"] : "(absent)",
      outputShape: shapeOf(body["output"]),
      usageKeys:
        typeof body["usage"] === "object" && body["usage"] !== null
          ? Object.keys(body["usage"]).join(", ")
          : "(absent)",
    });

    const outputTypes = Array.isArray(body["output"])
      ? (body["output"] as Record<string, unknown>[]).map((item) => String(item["type"]))
      : [];
    report("output item types", { types: outputTypes.join(", ") || "(none)" });

    // And what our parser makes of it.
    const read = readResponsesBody(outcome.body);
    report("parser", {
      textLength: read.text.length,
      sources: read.sources.length,
      searchOperations: read.searchOperations,
      extractionOperations: read.extractionOperations,
      inputTokens: read.inputTokens ?? "not reported",
      outputTokens: read.outputTokens ?? "not reported",
      failedOperations: read.failedOperations.join(" | ") || "none",
    });

    expect(outcome.status).toBe(200);
    // A response with no readable assistant text would mean the parser cannot
    // find the message content, which is the one thing this smoke must confirm.
    expect(read.text.length).toBeGreaterThan(0);
  });
});
