"use client";

import { useActionState } from "react";
import type { ResearchActionState } from "./state";
import {
  ClaimList,
  ResearchFailure,
  ResearchSpend,
  SharedLinkCard,
  SourceList,
  SuggestionCard,
} from "@/ui/components/EvidencePanel";
import { SubsystemStatusBoard } from "@/ui/components/SubsystemStatusBoard";
import { buildProvenanceBoard } from "@/ui/view/provenance";

/**
 * The research screen.
 *
 * Ordered so a reader meets the evidence before the conclusion: the question,
 * then the sources, then the claims those sources support, then what disagrees,
 * and only then the suggestion built on top. A suggestion presented first would
 * be a recommendation with footnotes; this way round it is a conclusion with
 * working shown.
 */
export function ResearchForm({
  action,
  initialState,
}: {
  readonly action: (
    state: ResearchActionState,
    formData: FormData,
  ) => Promise<ResearchActionState>;
  readonly initialState: ResearchActionState;
}) {
  const [state, formAction, pending] = useActionState(action, initialState);

  return (
    <div className="stack gap-3">
      <SubsystemStatusBoard
        rows={buildProvenanceBoard({
          // No extraction runs on this screen.
          understanding: "NOT_CONFIGURED",
          research: state.mode,
          researchFailed: state.status === "FAILED",
          assistanceTravellerConfirmed: true,
        })}
      />

      <form action={formAction} className="card stack gap-2">
        <h2>Ask one bounded question</h2>
        <p className="faint">
          Orkestr does not &ldquo;research Tokyo&rdquo;. It asks a typed question with a stated
          purpose, a source limit and a deadline, so the spend and the claim are both bounded.
        </p>

        <label className="eyebrow" htmlFor="sharedLinks">
          Anything you have already saved (optional)
        </label>
        <textarea
          id="sharedLinks"
          name="sharedLinks"
          rows={2}
          className="intent-input"
          placeholder="Paste public links - a TikTok, a Reddit thread, an article. Read first, before any search."
          aria-describedby="links-help"
        />
        <p id="links-help" className="faint">
          Public pages only. Anything shared is read before any search runs, and a link is never
          treated as a request for the thing in it.
        </p>

        <label className="eyebrow" htmlFor="linkNote">
          Why did you save it? (optional)
        </label>
        <input id="linkNote" name="linkNote" className="intent-input" type="text" />

        <div className="row">
          <button className="btn" type="submit" disabled={pending}>
            {pending ? "Researching..." : "Run the research"}
          </button>
        </div>
      </form>

      {state.questionSummary !== undefined && (
        <div className="card stack gap-1">
          <p className="eyebrow">The question asked</p>
          <p>{state.questionSummary}</p>
        </div>
      )}

      {state.sharedLinks !== undefined && state.sharedLinks.length > 0 && (
        <div className="card stack gap-2">
          <h3>What you shared</h3>
          <ul className="stack gap-2" style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {state.sharedLinks.map((link) => (
              <SharedLinkCard key={link.url} model={link} />
            ))}
          </ul>
        </div>
      )}

      {state.status === "FAILED" && state.failure !== undefined && (
        <ResearchFailure model={state.failure} />
      )}

      {state.sources !== undefined && state.sources.length > 0 && (
        <div className="card stack gap-2">
          <h3>
            {state.sources.length} source{state.sources.length === 1 ? "" : "s"} actually retrieved
          </h3>
          <p className="faint">
            Every URL here was returned by the search or extraction tool. A link that appeared
            only in the model&rsquo;s prose is rejected, not listed.
          </p>
          <SourceList sources={state.sources} />
        </div>
      )}

      {state.rejectedCitations !== undefined && state.rejectedCitations.length > 0 && (
        <div className="card stack gap-1">
          <p className="eyebrow">Citations rejected</p>
          <p className="faint">
            The model cited {state.rejectedCitations.length} page
            {state.rejectedCitations.length === 1 ? "" : "s"} that no search returned. Nothing was
            recorded from {state.rejectedCitations.length === 1 ? "it" : "them"}.
          </p>
          <ul className="unknowns">
            {state.rejectedCitations.map((url) => (
              <li key={url}>
                <code>{url}</code>
              </li>
            ))}
          </ul>
        </div>
      )}

      {state.claims !== undefined && state.claims.length > 0 && (
        <div className="card stack gap-2">
          <h3>What the sources said</h3>
          <ClaimList claims={state.claims} />
        </div>
      )}

      {state.community !== undefined && (
        <div className="card stack gap-2">
          <h3>What visitors said</h3>
          <p className="faint">
            From {state.community.sourcesConsidered} community source
            {state.community.sourcesConsidered === 1 ? "" : "s"} actually read. That is the real
            count, not a rounded-up one.
          </p>
          {state.community.positives.length > 0 && (
            <p>
              <strong>Liked:</strong> {state.community.positives.join(", ")}
            </p>
          )}
          {state.community.negatives.length > 0 && (
            <p>
              <strong>Complained about:</strong> {state.community.negatives.join(", ")}
            </p>
          )}
          {state.community.disagreements.length > 0 && (
            <div className="conflict">
              <strong>They disagreed about:</strong>
              <ul>
                {state.community.disagreements.map((d) => (
                  <li key={d}>{d}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {state.suggestions !== undefined && state.suggestions.length > 0 && (
        <div className="stack gap-2">
          <h3>What Orkestr suggests</h3>
          {state.suggestions.map((suggestion) => (
            <SuggestionCard key={suggestion.title} model={suggestion} />
          ))}
        </div>
      )}

      {state.rejectedSuggestions !== undefined && state.rejectedSuggestions.length > 0 && (
        <div className="card stack gap-1">
          <p className="eyebrow">Suggestions Orkestr refused to place</p>
          <ul className="unknowns">
            {state.rejectedSuggestions.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </div>
      )}

      {state.spend !== undefined && <ResearchSpend model={state.spend} />}
    </div>
  );
}
