"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ConsumerTrip } from "@/domain/consumerTrip";
import { answer, recognise, toAction } from "@/core/trips/commands";
import type { Answer } from "@/core/trips/commands";
import { addIdea, addTraveller } from "@/core/trips/mutate";
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
  save,
}: {
  readonly trip: ConsumerTrip;
  readonly base: string;
  readonly save: (trip: ConsumerTrip) => void;
}) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [reply, setReply] = useState<Answer | undefined>(undefined);
  const [refusal, setRefusal] = useState<{ reason: string; examples: readonly string[] } | undefined>(
    undefined,
  );
  const [done, setDone] = useState<string | undefined>(undefined);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setReply(undefined);
    setRefusal(undefined);
    setDone(undefined);

    const recognised = recognise(text);
    if (!recognised.ok) {
      setRefusal({ reason: recognised.reason, examples: recognised.examples });
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
        save(addTraveller(trip, action.name, ctx));
        setDone(`${action.name} was added.`);
        break;
      case "SAVE_IDEA":
        save(addIdea(trip, { title: action.title, category: "FUN" }, ctx));
        setDone(`Saved “${action.title}”. You can change the category on Explore.`);
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
            placeholder="Ask Orkestr — why are there two travel groups?"
            value={text}
            onChange={(e) => setText(e.target.value)}
            autoComplete="off"
          />
          <button className="btn btn-primary btn-small" type="submit">
            Ask
          </button>
        </div>
      </form>

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
