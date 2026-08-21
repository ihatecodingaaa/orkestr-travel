import "server-only";
import type {
  ExtractionDiagnostics,
  ExtractionRequest,
  ExtractionResult,
  LanguageUnderstandingProvider,
} from "../../domain/extraction";
import type { ModelStudioConfig } from "./config";
import type { ModelStudioTransport } from "./transport";
import { runExtractionPipeline } from "../../core/intent/pipeline";
import {
  INTENT_JSON_SCHEMA,
  INTENT_PROMPT_VERSION,
  INTENT_SYSTEM_PROMPT,
  buildIntentUserMessage,
} from "./prompts/intentV1";

/**
 * Structured extraction through Alibaba Cloud Model Studio.
 *
 * This adapter is the ONLY place in the application that knows a request to Qwen
 * looks like an OpenAI chat completion. Everything above it depends on
 * `LanguageUnderstandingProvider`, so replacing the provider is one file.
 *
 * The adapter's job stops at getting a string back. It does not decide whether
 * the string is trustworthy: that is `runExtractionPipeline`, which is pure and
 * heavily tested. Keeping the network code and the trust decision in separate
 * modules is what makes it possible to test every failure mode without a
 * network, and it means a change to the request shape cannot accidentally
 * weaken a validation rule.
 */

/** What the OpenAI-compatible chat completions endpoint returns, as we read it. */
interface ChatCompletionShape {
  readonly choices?: readonly {
    readonly message?: { readonly content?: unknown };
    readonly finish_reason?: unknown;
  }[];
  readonly usage?: {
    readonly prompt_tokens?: unknown;
    readonly completion_tokens?: unknown;
  };
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export class QwenLanguageUnderstandingProvider implements LanguageUnderstandingProvider {
  readonly name = "alibaba-model-studio";
  readonly mode = "LIVE_MODEL" as const;
  readonly model: string;

  constructor(
    private readonly config: ModelStudioConfig,
    private readonly transport: ModelStudioTransport,
  ) {
    this.model = config.extractionModel;
  }

  async extractIntent(request: ExtractionRequest): Promise<ExtractionResult> {
    const baseDiagnostics: Omit<
      ExtractionDiagnostics,
      "travellerCount" | "proposalCount" | "ambiguityCount"
    > = {
      requestId: request.requestId,
      operation: "EXTRACT_INTENT",
      providerName: this.name,
      model: this.model,
      promptVersion: INTENT_PROMPT_VERSION,
      durationMs: 0,
      startedAt: request.now,
    };

    const outcome = await this.transport.send({
      path: "/chat/completions",
      timeoutMs: this.config.timeoutMs,
      body: {
        model: this.config.extractionModel,
        messages: [
          { role: "system", content: INTENT_SYSTEM_PROMPT },
          { role: "user", content: buildIntentUserMessage(request.discussion) },
        ],
        // Structured output. The word JSON appears in the system prompt, which
        // json_object mode requires.
        response_format:
          this.config.structuredOutputMode === "json_schema"
            ? { type: "json_schema", json_schema: INTENT_JSON_SCHEMA }
            : { type: "json_object" },
        // Deterministic as the provider will allow. A group's trip should not
        // change because a model was sampled at a different temperature.
        temperature: 0,
        // No max_tokens, deliberately. Capping output under structured output
        // truncates the JSON mid-object, which arrives as MALFORMED_JSON and
        // looks like a model failure rather than the configuration error it is.
      },
    });

    if (!outcome.ok) {
      const code =
        outcome.kind === "TIMEOUT" ? ("MODEL_TIMEOUT" as const) : ("MODEL_UNAVAILABLE" as const);
      return {
        outcome: "FAILED",
        code,
        problems: [{ code, path: "$", detail: outcome.message }],
        diagnostics: {
          ...baseDiagnostics,
          durationMs: outcome.durationMs,
          travellerCount: 0,
          proposalCount: 0,
          ambiguityCount: 0,
        },
      };
    }

    const body = outcome.body as ChatCompletionShape;
    const content = body.choices?.[0]?.message?.content;
    const inputTokens = readNumber(body.usage?.prompt_tokens);
    const outputTokens = readNumber(body.usage?.completion_tokens);
    const usage = {
      ...(inputTokens === undefined ? {} : { inputTokens }),
      ...(outputTokens === undefined ? {} : { outputTokens }),
    };

    const diagnostics = { ...baseDiagnostics, durationMs: outcome.durationMs, ...usage };

    if (typeof content !== "string" || content.trim().length === 0) {
      return {
        outcome: "FAILED",
        code: "MALFORMED_JSON",
        problems: [
          {
            code: "MALFORMED_JSON",
            path: "choices[0].message.content",
            detail: "The provider returned no message content to read.",
          },
        ],
        diagnostics: { ...diagnostics, travellerCount: 0, proposalCount: 0, ambiguityCount: 0 },
      };
    }

    return runExtractionPipeline({
      rawResponse: content,
      discussion: request.discussion,
      mapping: {
        now: request.now,
        idPrefix: request.requestId,
        extractedBy: `${this.name}:${this.model}:${INTENT_PROMPT_VERSION}`,
      },
      diagnostics,
    });
  }
}
