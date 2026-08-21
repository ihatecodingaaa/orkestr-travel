"use server";

import { resolveProviders } from "@/adapters/registry";
import { logExtraction } from "@/adapters/diagnostics";
import { buildUnderstandingModel, understandingFailureModel } from "@/ui/view/understanding";
import type { UnderstandingActionState } from "./state";
import { asIsoDateTime } from "@/domain/time";

/**
 * The extraction server action.
 *
 * SERVER SIDE ONLY. The provider adapters, the credential and the raw model
 * response never leave this function. What crosses back to the browser is a view
 * model: labels, counts and the traveller's own quotes. That boundary is the
 * whole reason this is an action rather than a client fetch.
 *
 * The clock is read HERE, at the server boundary, and passed down. Everything
 * below is pure and takes the timestamp as an argument, which is what makes the
 * pipeline testable at exact values.
 */

/** Cap on pasted text. A discussion, not a novel, and a bound on what we send. */
const MAX_DISCUSSION = 12_000;

export async function extractIntentAction(
  _previous: UnderstandingActionState,
  formData: FormData,
): Promise<UnderstandingActionState> {
  const raw = formData.get("discussion");
  const discussion = typeof raw === "string" ? raw.trim() : "";

  const providers = resolveProviders();
  const mode = providers.understanding.mode;

  if (discussion.length === 0) {
    return { status: "IDLE", mode };
  }

  const requestId = `REQ-${String(Date.now())}`;
  const now = asIsoDateTime(new Date().toISOString().replace("Z", "+00:00"));

  const result = await providers.understanding.extractIntent({
    discussion: discussion.slice(0, MAX_DISCUSSION),
    now,
    requestId,
  });

  // Counts and durations only. The pasted text and the reading never go to a log.
  logExtraction(result.diagnostics, result.outcome);

  const diagnostics = {
    providerName: result.diagnostics.providerName,
    model: result.diagnostics.model,
    promptVersion: result.diagnostics.promptVersion,
    durationMs: result.diagnostics.durationMs,
    ...(result.diagnostics.inputTokens === undefined
      ? {}
      : { inputTokens: result.diagnostics.inputTokens }),
    ...(result.diagnostics.outputTokens === undefined
      ? {}
      : { outputTokens: result.diagnostics.outputTokens }),
  };

  if (result.outcome === "FAILED") {
    return {
      status: "FAILED",
      mode,
      failure: understandingFailureModel(result.code),
      diagnostics,
    };
  }

  /**
   * The fixture provider replays a recorded reading of its own discussion.
   *
   * If somebody pastes something else, the reading shown is of the fixture text
   * and not of what they typed. Saying so is the whole difference between a
   * labelled demo and a lie, so the flag is set and the screen prints it.
   */
  const { fixtureRecognises } = await import("@/adapters/fixture/fixtureLanguageUnderstanding");
  const unrecognised = mode === "LOCAL_FIXTURE" && !fixtureRecognises(discussion);

  return {
    status: "SUCCESS",
    mode,
    model: buildUnderstandingModel(result.intent, result.mapped),
    diagnostics,
    ...(unrecognised ? { unrecognisedFixtureInput: true } : {}),
  };
}
