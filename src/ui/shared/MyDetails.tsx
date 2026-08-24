"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ConsumerTrip, ConsumerTraveller } from "@/domain/consumerTrip";
import type { MemberView } from "@/core/shared/views";
import { sharedActions } from "./sharedActions";
import { useTripSync } from "./useTripSync";

/**
 * Your own details on a shared trip.
 *
 * ONLY YOURS. There is no traveller picker, no "editing on behalf of", and no
 * organiser override. The server applies these to whoever the session resolved
 * to, so this screen structurally cannot reach anybody else's record.
 *
 * IT IS ALSO THE ONBOARDING. Somebody who has just joined needs to answer the
 * same four questions somebody returning wants to change, so there is one
 * screen rather than a wizard that duplicates it and then drifts. What differs
 * is the framing: a new arrival is walked through what is still missing; a
 * returning traveller sees a form.
 *
 * ORGANISER-ENTERED DRAFTS ARE LABELLED AS SUCH. If Lucas guessed Zen's dates
 * during the conversion, Zen sees "Lucas added this before you joined" with one
 * tap to confirm -- not a pre-filled field pretending to be their own answer.
 */

export function MyDetails({
  trip,
  you,
  version,
  draftFromOrganiser,
}: {
  readonly trip: ConsumerTrip;
  readonly you: MemberView;
  readonly version: number;
  /** True when the organiser entered this person's details before they joined. */
  readonly draftFromOrganiser: boolean;
}) {
  const router = useRouter();
  // Polling keeps this screen current; the version written against is the prop.
  useTripSync(version);
  /**
   * Refresh as soon as the server accepts. Somebody answering four questions in
   * a row must see each answer land, not wait for the next poll.
   */
  const actions = sharedActions(trip.id, version, () => {
    router.refresh();
  });

  const me = trip.travellers.find((traveller) => traveller.id === you.travellerId);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  if (me === undefined) {
    return (
      <div className="empty-panel">
        <h1>Orkestr can&rsquo;t find you on this trip</h1>
        <p className="faint">Ask the organiser to send you a new invite.</p>
      </div>
    );
  }

  const steps = missingSteps(me);
  const done = steps.length === 0;

  async function run(work: Promise<{ ok: boolean; message?: string }>) {
    setBusy(true);
    try {
      const result = await work;
      setNotice(result.ok ? undefined : (result.message ?? "That didn't work."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack gap-3">
      <header className="stack gap-1">
        <p className="eyebrow">
          <Link href={`/trip/${trip.id}`}>{trip.destination}</Link>
        </p>
        <h1 className="trip-title">{done ? `You're all set, ${you.name}` : `Welcome, ${you.name}`}</h1>
        <p className="lede">
          {done
            ? "Orkestr has what it needs from you. Change anything here whenever you like."
            : "Three quick things help Orkestr coordinate the group. Nobody else can answer them for you."}
        </p>
      </header>

      {notice !== undefined && (
        <p className="notice notice-alert" role="alert">
          {notice}
        </p>
      )}

      {draftFromOrganiser && (
        <section className="notice notice-soft">
          <strong>Some of this was filled in before you joined.</strong>
          <p className="faint">
            The organiser added it so the group could get started. Orkestr does not count it as
            your answer until you confirm it.
          </p>
        </section>
      )}

      {!done && (
        <ol className="onboarding-steps">
          {steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      )}

      {/* ---------------------------------------------------- coming ------ */}
      <section className="panel stack gap-2">
        <h2>Are you coming?</h2>
        <div className="choice-row">
          <button
            type="button"
            className={me.comingConfirmed === true ? "chip chip-on" : "chip"}
            disabled={busy}
            onClick={() => void run(actions.setMyAvailability({ coming: true }))}
          >
            Yes, count me in
          </button>
          <button
            type="button"
            className={me.comingConfirmed === false ? "chip chip-on" : "chip"}
            disabled={busy}
            onClick={() => void run(actions.setMyAvailability({ coming: false }))}
          >
            I can&rsquo;t make it
          </button>
        </div>
      </section>

      {/* ------------------------------------------------------ dates ----- */}
      <section className="panel stack gap-2">
        <h2>When can you travel?</h2>
        <p className="faint">
          Orkestr will not assume you are free. If you leave these blank it keeps asking rather
          than guessing.
        </p>
        <div className="field-row">
          <div className="field">
            <label htmlFor="from">Earliest you can leave</label>
            <input
              id="from"
              type="date"
              className="input"
              defaultValue={me.availableFrom ?? ""}
              disabled={busy}
              onChange={(event) => {
                if (event.target.value === "")
                  return;
                void run(
                  actions.setMyAvailability({
                    from: event.target.value as NonNullable<ConsumerTraveller["availableFrom"]>,
                  }),
                );
              }}
            />
          </div>
          <div className="field">
            <label htmlFor="to">Latest you can be back</label>
            <input
              id="to"
              type="date"
              className="input"
              defaultValue={me.availableTo ?? ""}
              disabled={busy}
              onChange={(event) => {
                if (event.target.value === "") return;
                void run(
                  actions.setMyAvailability({
                    to: event.target.value as NonNullable<ConsumerTraveller["availableTo"]>,
                  }),
                );
              }}
            />
          </div>
        </div>
      </section>

      {/* ------------------------------------------------ requirements ---- */}
      <RequirementEditor
        traveller={me}
        busy={busy}
        onAdd={(input) => run(actions.addMyRequirement(input))}
        onRemove={(id) => run(actions.removeMyRequirement(id))}
      />

      {done && (
        <section className="milestone" role="status">
          <span className="milestone-mark" aria-hidden="true">
            ✦
          </span>
          <div>
            <strong>You&rsquo;re ready</strong>
            <p className="faint">
              Orkestr can coordinate your part of the trip. The group sees that you are ready —
              never what you marked private.
            </p>
          </div>
        </section>
      )}

      <Link className="btn btn-primary" href={`/trip/${trip.id}`}>
        See the trip
      </Link>
    </div>
  );
}

/**
 * What is still missing, in the order it is worth asking.
 *
 * The minimum-question principle still applies: a step that is already answered
 * does not appear, and nothing irrelevant is invented to pad the list.
 */
function missingSteps(traveller: ConsumerTraveller): readonly string[] {
  const steps: string[] = [];
  if (traveller.comingConfirmed === undefined) steps.push("Say whether you're coming");
  if (traveller.availableFrom === undefined || traveller.availableTo === undefined) {
    steps.push("Tell Orkestr when you can travel");
  }
  if (traveller.requirements.length === 0) {
    steps.push("Add anything you need — or skip it, if there's nothing");
  }
  return steps;
}

function RequirementEditor({
  traveller,
  busy,
  onAdd,
  onRemove,
}: {
  readonly traveller: ConsumerTraveller;
  readonly busy: boolean;
  readonly onAdd: (input: {
    readonly text: string;
    readonly strength: "REQUIRED" | "PREFERRED";
    readonly isPrivate: boolean;
  }) => void;
  readonly onRemove: (id: string) => void;
}) {
  const [text, setText] = useState("");
  const [strength, setStrength] = useState<"REQUIRED" | "PREFERRED">("PREFERRED");
  const [isPrivate, setIsPrivate] = useState(false);

  return (
    <section className="panel stack gap-2">
      <h2>Anything Orkestr should know?</h2>
      <p className="faint">
        Something you <strong>need</strong> is never traded away. Something you{" "}
        <strong>prefer</strong> is taken into account and can bend if you agree.
      </p>

      {traveller.requirements.length > 0 && (
        <ul className="decision-list">
          {traveller.requirements.map((requirement) => (
            <li key={requirement.id} className="requirement">
              <span className={requirement.strength === "REQUIRED" ? "tag tag-required" : "tag"}>
                {requirement.strength === "REQUIRED" ? "Required" : "Preferred"}
              </span>
              <span>
                {requirement.private && <span aria-hidden="true">🔒 </span>}
                {requirement.text}
              </span>
              <button
                type="button"
                className="linkish danger"
                disabled={busy}
                onClick={() => {
                  onRemove(requirement.id);
                }}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <form
        className="stack gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (text.trim().length === 0) return;
          onAdd({ text: text.trim(), strength, isPrivate });
          setText("");
          setIsPrivate(false);
        }}
      >
        <div className="field">
          <label htmlFor="req">In your own words</label>
          <input
            id="req"
            className="input"
            placeholder="Step-free access the whole way through the airport"
            value={text}
            disabled={busy}
            onChange={(event) => {
              setText(event.target.value);
            }}
          />
        </div>

        <div className="chip-scroll">
          <button
            type="button"
            className={strength === "REQUIRED" ? "chip chip-on" : "chip"}
            onClick={() => {
              setStrength("REQUIRED");
            }}
          >
            I need this
          </button>
          <button
            type="button"
            className={strength === "PREFERRED" ? "chip chip-on" : "chip"}
            onClick={() => {
              setStrength("PREFERRED");
            }}
          >
            I&rsquo;d prefer this
          </button>
          <label className="chip chip-check">
            <input
              type="checkbox"
              checked={isPrivate}
              onChange={(event) => {
                setIsPrivate(event.target.checked);
              }}
            />
            🔒 Keep it private
          </label>
        </div>

        {isPrivate && (
          <p className="faint">
            The group will be told you have a requirement, and never what it says — not even the
            organiser.
          </p>
        )}

        <button className="btn btn-secondary btn-small" type="submit" disabled={busy}>
          Add
        </button>
      </form>
    </section>
  );
}
