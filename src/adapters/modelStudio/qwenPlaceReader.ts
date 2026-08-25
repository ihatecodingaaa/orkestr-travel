import "server-only";
import type { ModelStudioConfig } from "./config";
import type { ModelStudioTransport } from "./transport";
import { PLACE_SYSTEM_PROMPT, buildPlaceUserMessage } from "./prompts/placeV1";
import { segmentDiscussion } from "../../core/intent/spans";
import { readPlaceResponse, type PlaceReading } from "../../core/inspiration/placeReading";

/**
 * Asking the model which place a link is about.
 *
 * ONE CALL, AND ONLY WHEN THERE IS SOMETHING TO READ. The caller checks that the
 * source produced usable evidence first, because sending a bare domain name to a
 * paid model buys a confident guess from no evidence -- which is the exact
 * failure the whole evidence architecture exists to prevent.
 *
 * `enable_thinking: false`, for the same reason extraction uses it: this is a
 * bounded transformation of short text, not a problem that improves with
 * reasoning, and a thinking phase on a non-streaming request is paid for in
 * seconds a person spends watching a spinner.
 *
 * NOTHING HERE WRITES ANYTHING. It returns candidates. Saving one is a separate,
 * deliberate act by a person.
 */

export interface PlaceReaderResult {
  readonly reading: PlaceReading;
  readonly durationMs: number;
}

export class QwenPlaceReader {
  constructor(
    private readonly config: ModelStudioConfig,
    private readonly transport: ModelStudioTransport,
  ) {}

  async readPlaces(input: {
    /** The text actually obtained from the link. Never the whole page. */
    readonly evidence: string;
    readonly destination: string;
    readonly provider: string;
  }): Promise<PlaceReaderResult> {
    const spans = segmentDiscussion(input.evidence);

    const outcome = await this.transport.send({
      path: "/chat/completions",
      timeoutMs: this.config.timeoutMs,
      body: {
        model: this.config.extractionModel,
        messages: [
          { role: "system", content: PLACE_SYSTEM_PROMPT },
          {
            role: "user",
            content: buildPlaceUserMessage({
              spans,
              destination: input.destination,
              provider: input.provider,
            }),
          },
        ],
        response_format: { type: "json_object" },
        temperature: 0,
        enable_thinking: false,
      },
    });

    if (!outcome.ok) {
      return {
        reading: { kind: "FAILED", reason: outcome.message },
        durationMs: outcome.durationMs,
      };
    }

    const body = outcome.body as {
      choices?: { message?: { content?: unknown } }[];
    };
    const content = body.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      return {
        reading: { kind: "FAILED", reason: "The reply had no content." },
        durationMs: outcome.durationMs,
      };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(stripFence(content));
    } catch {
      return {
        reading: { kind: "FAILED", reason: "The reply was not valid JSON." },
        durationMs: outcome.durationMs,
      };
    }

    return { reading: readPlaceResponse(parsed, spans), durationMs: outcome.durationMs };
  }
}

/**
 * Models asked for JSON sometimes wrap it in a markdown fence.
 *
 * A formatting habit rather than a malformed answer, and refusing it would fail
 * a reading that is otherwise fine. Nothing else is repaired.
 */
function stripFence(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("```")) return trimmed;
  const withoutOpen = trimmed.replace(/^```[a-zA-Z]*\s*\n?/, "");
  const close = withoutOpen.lastIndexOf("```");
  return (close === -1 ? withoutOpen : withoutOpen.slice(0, close)).trim();
}
