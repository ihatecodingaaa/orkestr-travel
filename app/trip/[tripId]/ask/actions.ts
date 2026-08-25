"use server";

import { readModelStudioConfig } from "@/adapters/modelStudio/config";
import { HttpModelStudioTransport } from "@/adapters/modelStudio/transport";
import { tripForActor } from "@/server/shared/tripForActor";
import {
  ASK_INTENTS,
  answerFromTrip,
  readAskRequest,
  type AskAnswer,
} from "@/core/ask/intents";

/**
 * Ask Orkestr, connected to the actual trip.
 *
 * WHAT IT REPLACES accepted free text and answered a fixed list of phrasings,
 * then explained its own architecture when it did not recognise one. The box
 * promised a conversation and delivered a command line.
 *
 * THE MODEL CHOOSES ONE WORD. It is given the question and a list of intents,
 * and it returns one of them. It never names a function, never receives an id,
 * and never gets anything it could query with -- so the classifier being wrong
 * costs a wrong answer, not a wrong action. `readAskRequest` then checks even
 * that word against a list this software owns.
 *
 * SOFTWARE ANSWERS. Every answer is computed from trip state by
 * `answerFromTrip`, which is pure. The model decides what was being asked; it
 * does not decide what is true.
 *
 * NOTHING IS WRITTEN HERE. A proposal comes back for a person to confirm, and
 * the confirmation runs through the same TripActions everything else uses.
 */

export interface AskResult {
  readonly answer: AskAnswer;
  /** True when a model was consulted. Used only for honest UI wording. */
  readonly usedModel: boolean;
}

const SYSTEM_PROMPT = `You classify one question somebody asked about their group trip. You return JSON only.

Return {"intent": "...", "category": "...", "size": 0}

"intent" must be exactly one of:
- EMPTY_DAYS — which days have nothing planned
- WHAT_IS_MISSING — what is still waiting on a person
- PLACES_BY_CATEGORY — what has the group saved (add "category" when they name a kind: FOOD, SHOPPING, CULTURE, NIGHT, NATURE, FUN, RELAX)
- PLAN_SUMMARY — what is planned, what does the plan look like
- GROUP_SUMMARY — who is coming, how many of us are there
- SET_GROUP_SIZE — they are telling you the group is a different size ("we're actually 8"); add "size" as the number
- BUILD_DRAFT — they want a plan made ("plan the food stuff", "sort out the week")
- UNKNOWN — anything else, including booking, prices, weather, or anything about the world outside this trip

Include "category" only for PLACES_BY_CATEGORY and "size" only for SET_GROUP_SIZE. Omit them otherwise.

Choose UNKNOWN rather than guessing. A wrong classification gives somebody a confident answer to a question they did not ask.

Return the JSON object and nothing else.`;

export async function askOrkestr(input: {
  readonly tripId: string;
  readonly rawTrip: unknown;
  readonly question: string;
}): Promise<AskResult> {
  /**
   * The same rule as the planner: for a shared trip, answer from the database.
   *
   * An assistant that answers from a browser's copy will tell somebody three
   * days are empty seconds after another member filled one -- and it will sound
   * exactly as certain as when it is right.
   */
  const resolved = await tripForActor({ tripId: input.tripId, rawTrip: input.rawTrip });
  if (resolved.kind === "NO_ACCESS") {
    return { answer: { headline: resolved.message, lines: [] }, usedModel: false };
  }
  if (resolved.kind === "UNREADABLE") {
    return {
      answer: { headline: "Orkestr could not read this trip.", lines: [] },
      usedModel: false,
    };
  }
  const parsed = { ok: true as const, trip: resolved.trip };
  const question = input.question.trim().slice(0, 400);
  if (question.length === 0) {
    return {
      answer: { headline: "Ask Orkestr anything about this trip.", lines: [] },
      usedModel: false,
    };
  }

  const config = readModelStudioConfig();
  if (!config.configured) {
    /**
     * §45. Without a model the product is still usable: the deterministic
     * answers are the same ones, and the fallback says what it can do rather
     * than describing why it cannot.
     */
    return {
      answer: answerFromTrip({ trip: parsed.trip, request: { intent: "UNKNOWN" }, question }),
      usedModel: false,
    };
  }

  const transport = new HttpModelStudioTransport(config, () => Date.now());
  const outcome = await transport.send({
    path: "/chat/completions",
    timeoutMs: config.timeoutMs,
    body: {
      model: config.extractionModel,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          /*
            The question is delimited and labelled. It is text somebody typed
            into a box, which makes it the same class of input as a pasted
            caption -- and it cannot widen what the classifier may return,
            because the return is checked against ASK_INTENTS afterwards.
          */
          content: `Intents: ${ASK_INTENTS.join(", ")}\n\n<question>\n${question.replace(/<\/?question>/gi, "[question]")}\n</question>`,
        },
      ],
      response_format: { type: "json_object" },
      temperature: 0,
      enable_thinking: false,
    },
  });

  if (!outcome.ok) {
    return {
      answer: {
        headline: "I couldn't think that through just now.",
        lines: ["Everything about your trip is still here."],
      },
      usedModel: true,
    };
  }

  const body = outcome.body as { choices?: { message?: { content?: unknown } }[] };
  const content = body.choices?.[0]?.message?.content;
  let request = readAskRequest(undefined);
  if (typeof content === "string") {
    try {
      request = readAskRequest(JSON.parse(stripFence(content)));
    } catch {
      request = readAskRequest(undefined);
    }
  }

  return {
    answer: answerFromTrip({ trip: parsed.trip, request, question }),
    usedModel: true,
  };
}

function stripFence(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("```")) return trimmed;
  const withoutOpen = trimmed.replace(/^```[a-zA-Z]*\s*\n?/, "");
  const close = withoutOpen.lastIndexOf("```");
  return (close === -1 ? withoutOpen : withoutOpen.slice(0, close)).trim();
}
