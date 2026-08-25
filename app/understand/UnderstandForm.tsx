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
          <button className="btn btn-primary" type="submit" disabled={pending}>
            {pending ? "Reading…" : "Understand this"}
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

      {/*
        TWENTY-FIVE SECONDS IS A LONG TIME TO LOOK AT A DISABLED BUTTON.

        What it deliberately does NOT do is tick items off on a timer. The server
        sends no progress events, so a list that advanced every few seconds would
        be animating a story about work it cannot see -- which is the same class
        of thing as a fake percentage.

        So it says what is actually happening, all of it at once and honestly,
        and how long this usually takes. The wait stops feeling like a hang
        without anybody being told something untrue.
      */}
      {pending && (
        <div className="card stack gap-1" role="status" aria-live="polite">
          <h2>Reading your group…</h2>
          <p className="faint">
            Orkestr is working out who is going, what matters to each of them, and what still
            needs somebody to confirm it.
          </p>
          <p className="faint">This usually takes around half a minute.</p>
        </div>
      )}

      {state.status === "FAILED" && state.failure !== undefined && (
        <UnderstandingFailure model={state.failure} />
      )}

      {state.status === "SUCCESS" && state.model !== undefined && (
        <UnderstandingReview model={state.model} />
      )}

      {/*
        THE TECHNICAL TRUTH MOVES DOWN, IT DOES NOT GO AWAY.

        A provenance matrix used to sit ABOVE the box somebody had come to type
        in: five rows about fixtures, provider capacity and booking state, before
        the product had done anything for them. That is the hierarchy of an
        internal console, and it made a capable feature read like a diagnostic.

        Everything is still here, unedited -- which subsystem ran, what it is
        allowed to claim, the model, the prompt version, the tokens and the
        duration. It is one disclosure, closed by default, underneath the answer
        it explains. Somebody who wants to check can; somebody who wants to plan
        a trip is not made to read it first.
      */}
      <details className="card stack gap-1 worked-out">
        <summary>
          <span className="rules-summary-title">How Orkestr worked this out</span>
          <span className="faint"> — what ran, and what it is allowed to claim</span>
        </summary>

        <div className="stack gap-2 worked-out-body">
        <SubsystemStatusBoard
          rows={buildProvenanceBoard({
            understanding: state.mode,
            understandingFailed: state.status === "FAILED",
            /**
             * This screen reads a discussion; it does no research.
             *
             * It used to pass NOT_CONFIGURED, which renders as "no Model Studio
             * credential is set" -- and that was observed in production directly
             * beneath a live extraction that had just run with a credential that
             * plainly existed. Saying a subsystem was not asked is true; saying
             * it has no credential was not.
             */
            research: "NOT_CONFIGURED",
            researchAsked: false,
          })}
        />
          {state.diagnostics !== undefined && (
            <p className="faint">
              {state.diagnostics.providerName} &middot; model {state.diagnostics.model} &middot;
              prompt {state.diagnostics.promptVersion} &middot; {state.diagnostics.durationMs}ms
              {state.diagnostics.inputTokens === undefined
                ? ""
                : ` · ${String(state.diagnostics.inputTokens)} in / ${String(state.diagnostics.outputTokens ?? 0)} out tokens`}
            </p>
          )}
        </div>
      </details>
    </div>
  );
}
