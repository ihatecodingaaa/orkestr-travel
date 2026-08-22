import { describe, it, expect } from "vitest";
import { readModelStudioConfig } from "@/adapters/modelStudio/config";
import { HttpModelStudioTransport } from "@/adapters/modelStudio/transport";
import { readResponsesBody } from "@/adapters/modelStudio/responsesShape";
import { RESEARCH_SYSTEM_PROMPT, buildResearchInstruction } from "@/adapters/modelStudio/prompts/researchV2";
import type { ResearchQuestion } from "@/domain/research";
import { asResearchQuestionId } from "@/domain/ids";
import { loadLocalEnv, report, requireConfig } from "./harness";

/**
 * A MEASUREMENT, not a fix.
 *
 *   npm run research:diagnose
 *
 * The bounded research call timed out at exactly 30,016ms, which is our own
 * deadline rather than anything the provider said. Two very different things
 * produce that symptom:
 *
 *   A. The workload is genuinely slower than 30s. A research call reasons,
 *      searches the web, fetches pages and synthesises -- several network round
 *      trips outside our control. 30s may simply be the wrong number.
 *
 *   B. Something hangs, the way extraction hung before `enable_thinking:false`.
 *
 * Raising the timeout to make the error go away would be indistinguishable from
 * fixing it, and would leave us not knowing which of these is true. So this runs
 * ONCE with a deliberately generous ceiling for the sole purpose of learning the
 * real number, and reports what it finds before anything permanent changes.
 *
 * It also captures the real tool-call response shape, which is the data the
 * offline parser fixtures need anyway.
 */

loadLocalEnv();

const config = readModelStudioConfig();
const configured = config.configured;

/** Generous ON PURPOSE. This is an instrument, not a setting. */
const DIAGNOSTIC_CEILING_MS = 150_000;

const QUESTION: ResearchQuestion = {
  id: asResearchQuestionId("Q-DIAG"),
  kind: "OFFICIAL_ACCESSIBILITY",
  destinationLabel: "Hamarikyu Gardens",
  context: {
    groupSize: 7,
    ageBands: [],
    statedInterests: ["gardens"],
    accessibilityNeeds: ["STEP_FREE_ACCESS"],
    dietaryNeeds: [],
  },
  sourcePreference: "ANY",
  maxSources: 4,
  purpose: "Establish what is officially published about step-free access at this one attraction.",
};

function shapeOf(value: unknown, depth = 0): string {
  if (value === null) return "null";
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    return depth >= 3 ? `[${String(value.length)}]` : `[${String(value.length)} x ${shapeOf(value[0], depth + 1)}]`;
  }
  if (typeof value === "object") {
    const keys = Object.keys(value);
    if (depth >= 3) return `{${keys.length} keys}`;
    return `{${keys.map((k) => `${k}: ${shapeOf((value as Record<string, unknown>)[k], depth + 1)}`).join(", ")}}`;
  }
  return typeof value;
}

describe("research latency diagnostic", () => {
  it.skipIf(!configured)("measures how long a real tool-using research call takes", async () => {
    const live = requireConfig(config);
    const transport = new HttpModelStudioTransport(live, () => Date.now());

    report("measuring", {
      ceilingMs: String(DIAGNOSTIC_CEILING_MS),
      note: "Diagnostic ceiling only. Not a configuration change.",
      tools: "web_search, web_extractor",
      thinking: "provider default (research sends no enable_thinking)",
    });

    const outcome = await transport.send({
      path: "/responses",
      timeoutMs: DIAGNOSTIC_CEILING_MS,
      body: {
        model: live.researchModel,
        input: [
          { role: "system", content: RESEARCH_SYSTEM_PROMPT },
          { role: "user", content: buildResearchInstruction(QUESTION) },
        ],
        tools: [{ type: "web_search" }, { type: "web_extractor" }],
      },
    });

    report("result", {
      ok: outcome.ok ? "yes" : "NO",
      durationMs: outcome.durationMs,
      verdict:
        outcome.ok && outcome.durationMs > 30_000
          ? "SLOW BUT WORKING -- 30s was simply too short"
          : outcome.ok
            ? "completed within 30s this time"
            : "did not complete even at the diagnostic ceiling",
      ...(outcome.ok ? { status: outcome.status } : { kind: outcome.kind, message: outcome.message }),
    });

    if (!outcome.ok) {
      throw new Error(`Even at ${String(DIAGNOSTIC_CEILING_MS)}ms: ${outcome.kind} - ${outcome.message}`);
    }

    const body = outcome.body as Record<string, unknown>;
    const output = Array.isArray(body["output"]) ? (body["output"] as Record<string, unknown>[]) : [];

    report("output item types, in order", {
      types: output.map((i) => String(i["type"])).join(" -> ") || "(none)",
      count: String(output.length),
    });

    // The shape of each tool call, which is what the parser depends on.
    for (const item of output) {
      const type = String(item["type"]);
      if (type !== "web_search_call" && type !== "web_extractor_call") continue;
      report(`shape: ${type}`, {
        keys: Object.keys(item).join(", "),
        status: typeof item["status"] === "string" ? item["status"] : "(absent)",
        shape: shapeOf(item, 1),
      });
    }

    const read = readResponsesBody(outcome.body);
    report("parser", {
      sourcesFound: String(read.sources.length),
      searchOperations: String(read.searchOperations),
      extractionOperations: String(read.extractionOperations),
      extractedUrls: String(read.extractedUrls.length),
      textLength: String(read.text.length),
      inputTokens: read.inputTokens ?? "not reported",
      outputTokens: read.outputTokens ?? "not reported",
      failedOperations: read.failedOperations.join(" | ") || "none",
    });

    for (const source of read.sources) {
      report("captured source", {
        url: source.url,
        title: source.title ?? "(none)",
        query: source.searchQuery ?? "(none)",
        rank: String(source.rank ?? "(none)"),
      });
    }

    expect(outcome.status).toBe(200);
  }, 200_000);
});
