"use client";

import { useActionState } from "react";
import type { UnderstandingActionState } from "./state";
import { UnderstandingFailure, UnderstandingReview } from "@/ui/components/UnderstandingReview";
import { SubsystemStatusBoard } from "@/ui/components/SubsystemStatusBoard";
import { buildProvenanceBoard } from "@/ui/view/provenance";

/**
 * The extraction form.
 *
 * A CLIENT COMPONENT THAT KNOWS NOTHING. It imports the action and the view
 * components; it does not import a provider, a config or a domain engine. That
 * is deliberate and structural: an adapter pulled in here would fail the build
 * because of `server-only`, which is what stops a credential ever reaching a
 * browser bundle by accident.
 *
 * State lives in `useActionState`, not in a URL, because a pasted family
 * discussion is private text and a query parameter is a shareable, logged,
 * bookmarkable place to put it.
 */
export function UnderstandForm({
  action,
  initialState,
  sampleDiscussion,
}: {
  readonly action: (
    state: UnderstandingActionState,
    formData: FormData,
  ) => Promise<UnderstandingActionState>;
  readonly initialState: UnderstandingActionState;
  readonly sampleDiscussion: string;
}) {
  const [state, formAction, pending] = useActionState(action, initialState);

  return (
    <div className="stack gap-3">
      <SubsystemStatusBoard
        rows={buildProvenanceBoard({
          understanding: state.mode,
          understandingFailed: state.status === "FAILED",
          // No research has been run on this screen, so it is not configured
          // here regardless of what it could do elsewhere.
          research: "NOT_CONFIGURED",
        })}
      />

      <form action={formAction} className="card stack gap-2">
        <label className="eyebrow" htmlFor="discussion">
          Paste the group discussion
        </label>
        <textarea
          id="discussion"
          name="discussion"
          rows={12}
          defaultValue={sampleDiscussion}
          className="intent-input"
          aria-describedby="discussion-help"
        />
        <p id="discussion-help" className="faint">
          Whatever you paste is treated as text to read, never as instructions. Nothing in it
          can confirm a requirement or change how Orkestr behaves.
        </p>
        <div className="row">
          <button className="btn" type="submit" disabled={pending}>
            {pending ? "Reading..." : "Read this"}
          </button>
          <span className="faint">
            {state.mode === "LIVE_MODEL"
              ? "Sends this text to Alibaba Cloud Model Studio."
              : "No model is configured, so a recorded demo reading is replayed instead."}
          </span>
        </div>
      </form>

      {state.unrecognisedFixtureInput === true && (
        <p className="card badge badge-alert" role="status">
          This build has no model configured, so it replayed its recorded demo reading. What is
          shown below is NOT a reading of the text you just pasted.
        </p>
      )}

      {state.status === "FAILED" && state.failure !== undefined && (
        <UnderstandingFailure model={state.failure} />
      )}

      {state.status === "SUCCESS" && state.model !== undefined && (
        <UnderstandingReview model={state.model} />
      )}

      {state.diagnostics !== undefined && (
        <div className="card stack gap-1">
          <p className="eyebrow">What actually ran</p>
          <p className="faint">
            {state.diagnostics.providerName} &middot; model {state.diagnostics.model} &middot;
            prompt {state.diagnostics.promptVersion} &middot; {state.diagnostics.durationMs}ms
            {state.diagnostics.inputTokens === undefined
              ? ""
              : ` · ${String(state.diagnostics.inputTokens)} in / ${String(state.diagnostics.outputTokens ?? 0)} out tokens`}
          </p>
        </div>
      )}
    </div>
  );
}
