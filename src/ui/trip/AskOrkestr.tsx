"use client";

import { useState } from "react";
import type { ActionOutcome, TripActions } from "@/ui/trip/actions";
import { useRouter } from "next/navigation";
import type { AskAnswer } from "@/core/ask/intents";
import { askOrkestr } from "~/trip/[tripId]/ask/actions";
import type { ConsumerTrip } from "@/domain/consumerTrip";
import { answer, recognise, suggestedCommands, toAction } from "@/core/trips/commands";
import type { Answer } from "@/core/trips/commands";
import { addTraveller } from "@/core/trips/mutate";
import { newId, nowIso } from "./TripsClient";

/**
 * Ask Orkestr.
 *
 * A box that says what it cannot do.
 *
 * The temptation with a surface like this is to accept every sentence and
 * answer plausibly. That would be the fastest possible way to destroy a product
 * whose entire claim is that it does not make things up. So an unrecognised
 * request is refused by name -- and the refusal names things that WOULD work,
 * because "I don't understand" on its own is a dead end.
 *
 * Recognition, answering and acting are three separate steps in
 * `core/trips/commands.ts`. This component only wires them to an input.
 */
export function AskOrkestr({
  trip,
  base,
  actions,
  save,
}: {
  readonly trip: ConsumerTrip;
  readonly base: string;
  readonly actions: TripActions;
  /**
   * Local-only writes, absent in shared mode.
   *
   * The deterministic command layer can add a traveller straight to the device.
   * A shared trip has no such thing -- people arrive through invitations -- so
   * those intents simply are not offered there rather than being wired to
   * something that would half-work.
   */
  readonly save?: (trip: ConsumerTrip) => void;
}) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [reply, setReply] = useState<Answer | undefined>(undefined);
  const [refusal, setRefusal] = useState<{ reason: string; examples: readonly string[] } | undefined>(
    undefined,
  );
  const [done, setDone] = useState<string | undefined>(undefined);
  /**
   * The answer that came back when the fast path did not recognise the
   * question. Kept separately from `reply` so the deterministic answers stay
   * instant and unchanged.
   */
  const [thinking, setThinking] = useState(false);
  const [asked, setAsked] = useState<AskAnswer | undefined>(undefined);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    run(text);
  }

  /**
   * Classify, then answer from state.
   *
   * The model picks one intent from a fixed list; software computes the answer
   * and any proposal from the trip itself. A misclassification therefore costs a
   * wrong answer, never a wrong action -- nothing here writes.
   */
  async function ask(input: string) {
    setThinking(true);
    setAsked(undefined);
    try {
      const result = await askOrkestr({ tripId: trip.id, rawTrip: trip, question: input });
      setAsked(result.answer);
      setText("");
    } catch {
      setAsked({
        headline: "I couldn't think that through just now.",
        lines: ["Everything about your trip is still here."],
      });
    } finally {
      setThinking(false);
    }
  }

  function run(input: string) {
    setReply(undefined);
    setRefusal(undefined);
    setDone(undefined);

    const recognised = recognise(input);
    if (!recognised.ok) {
      /*
        THE FAST PATH DID NOT RECOGNISE IT, WHICH IS NOT THE END.

        This used to be where Ask refused and described its own architecture.
        The deterministic answers above are still instant and still first --
        paying a model to count empty days would be slower and worse -- but a
        question it does not have a pattern for now goes to one that can read it.
      */
      void ask(input);
      return;
    }

    const said = answer(recognised.intent, trip, base);
    if (said !== undefined) {
      setReply(said);
      setText("");
      return;
    }

    const action = toAction(recognised.intent, base);
    if (action === undefined) return;

    /**
     * Actions are applied HERE, not inside the command layer.
     *
     * That layer produces a description of what should happen; this decides
     * whether to do it. When a model eventually produces the same descriptions,
     * it will meet the same gate rather than a shortcut around it.
     */
    const ctx = { now: nowIso(), newId };
    switch (action.kind) {
      case "ADD_TRAVELLER":
        /*
          Local only, and deliberately so. In a shared trip people arrive
          through an invitation, which is what ties a person to a session and a
          set of private answers. Adding a row on somebody's behalf would create
          a member nobody can be.
        */
        if (save === undefined) {
          setDone("Invite them from the Group screen so they get their own view.");
          break;
        }
        save(addTraveller(trip, action.name, ctx));
        setDone(`${action.name} was added.`);
        break;
      case "SAVE_IDEA":
        /* Saving has a shared equivalent, so it goes through the boundary. */
        void actions
          .addIdea({ title: action.title, category: "FUN" })
          .then((outcome) => {
            setDone(
              outcome.ok
                ? `Saved “${action.title}”. You can change the category on Explore.`
                : (outcome.message ?? "That didn't work."),
            );
          });
        break;
      case "NAVIGATE":
        router.push(action.href);
        break;
    }
    setText("");
  }

  return (
    <section className="ask">
      <form onSubmit={submit} role="search">
        <label className="visually-hidden" htmlFor="ask">
          Ask Orkestr
        </label>
        <div className="ask-row">
          <span className="ask-mark" aria-hidden="true">
            ⌘
          </span>
          <input
            id="ask"
            className="ask-input"
            /*
              Short enough to survive 390px. The old placeholder was a whole
              question and clipped mid-sentence on a phone, which reads as a
              broken input rather than a suggestion. The examples underneath
              already show what can be asked.
            */
            placeholder="Ask Orkestr"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
            }}
            autoComplete="off"
          />
          <button className="btn btn-primary btn-small" type="submit">
            Ask
          </button>
        </div>
      </form>

      {/*
        What the box can actually do, drawn from this trip's state. A free-text
        input that answers eight things and refuses the rest is only usable if
        somebody can see what the eight are -- two refusals in a row and people
        decide the feature is broken. Every chip is checked by a test to be
        something `recognise` accepts.
      */}
      {reply === undefined && refusal === undefined && done === undefined && (
        <div className="ask-chips">
          {suggestedCommands(trip).map((chip) => (
            <button
              key={chip}
              type="button"
              className="chip"
              onClick={() => {
                setText(chip);
                run(chip);
              }}
            >
              {chip}
            </button>
          ))}
        </div>
      )}

      {reply !== undefined && (
        <div className="ask-reply" role="status">
          <p>{reply.text}</p>
          {reply.points.length > 0 && (
            <ul>
              {reply.points.map((point) => (
                <li key={point}>{point}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {done !== undefined && (
        <p className="ask-reply" role="status">
          {done}
        </p>
      )}

      {thinking && (
        <p className="faint" role="status" aria-live="polite">
          Reading your trip…
        </p>
      )}

      {asked !== undefined && (
        <div className="panel stack gap-1 ask-answer" role="status">
          <strong>{asked.headline}</strong>
          {asked.lines.length > 0 && (
            <ul className="tick-list">
              {asked.lines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )}
          {asked.proposal !== undefined && (
            <div className="choice-row">
              {/*
                A PROPOSAL, NOT AN ACTION ALREADY TAKEN. Nothing typed into a box
                changes the trip until somebody presses this.
              */}
              <button
                type="button"
                className="btn btn-primary btn-small"
                onClick={() => {
                  const proposal = asked.proposal;
                  if (proposal === undefined) return;
                  if (proposal.kind === "SET_GROUP_SIZE" && proposal.size !== undefined) {
                    /*
                      THROUGH THE ACTIONS BOUNDARY, in both modes.

                      This used to write straight to the device. In a shared trip
                      that would have been a second source of truth: the number
                      would change on the organiser's screen and nowhere else,
                      and nobody would be told.
                    */
                    const size = proposal.size;
                    void actions.setDeclaredGroupSize(size).then((outcome: ActionOutcome) => {
                      setAsked(undefined);
                      setDone(
                        outcome.ok
                          ? `Orkestr is planning for ${String(size)} travellers.`
                          : (outcome.message ?? "That didn't work."),
                      );
                    });
                    return;
                  }
                  router.push(`${base}/plan`);
                }}
              >
                {asked.proposal.confirm}
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-small"
                onClick={() => setAsked(undefined)}
              >
                Not now
              </button>
            </div>
          )}
        </div>
      )}

      {refusal !== undefined && (
        <div className="ask-reply ask-refusal" role="status">
          {/*
            Says plainly that this is a local build with a fixed set of
            answers. Implying a general intelligence that is not connected
            would be the one lie this whole product is built to avoid.
          */}
          <p>{refusal.reason}</p>
          <p className="faint">Things it can answer:</p>
          <ul>
            {refusal.examples.map((example) => (
              <li key={example}>
                <button className="linkish" type="button" onClick={() => setText(example)}>
                  {example}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
