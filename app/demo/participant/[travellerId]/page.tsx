import Link from "next/link";
import { buildDemoWorld, compromisesForTraveller } from "@/ui/demo/scenario";
import { readDemoState, demoHref } from "@/ui/demo/params";
import type { RawParams } from "@/ui/demo/params";
import { buildCompromiseAsk } from "@/ui/view/compromise";
import { constraintChipsFor } from "@/ui/view/privacy";
import { FixtureBanner } from "@/ui/components/FixtureBanner";
import { TruthBadge } from "@/ui/components/TruthBadge";
import { assistanceProviderBadge, travellerConfirmationBadge } from "@/ui/view/truth";

/**
 * One traveller's private view.
 *
 * This is the ONLY surface where a person's own figures appear. Everything here
 * is rendered for the OWNER audience, so the privacy selectors return full
 * detail; every other screen gets the unattributed version of the same facts.
 *
 * There is no authentication and none is implied. The page says so plainly
 * rather than dressing a demo route up as a private link, because a capability
 * URL that is not actually a capability is worse than no claim at all.
 */
export default async function ParticipantPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly travellerId: string }>;
  readonly searchParams: Promise<RawParams>;
}) {
  const { travellerId } = await params;
  const state = readDemoState(await searchParams);
  const world = await buildDemoWorld(state);

  const traveller = world.travellers.find((t) => t.id === travellerId);
  if (traveller === undefined) {
    return (
      <>
        <FixtureBanner />
        <main className="shell" style={{ paddingTop: "3rem" }}>
          <h1>No such traveller</h1>
          <p className="lede">Nobody with that id is on this trip.</p>
          <p>
            <Link className="btn btn-secondary" href={demoHref("/demo", state)}>
              Back to the group
            </Link>
          </p>
        </main>
      </>
    );
  }

  const chips = constraintChipsFor(traveller, { kind: "OWNER", travellerId });
  const proposals = compromisesForTraveller(world, travellerId);
  const ask = proposals[0] === undefined ? undefined : buildCompromiseAsk(proposals[0], travellerId);

  return (
    <>
      <FixtureBanner />
      <main className="shell" style={{ paddingTop: "2.5rem" }}>
        <div className="stack gap-3">
          <div className="demobar">
            <p className="eyebrow">Local demo participant view</p>
            <span className="faint">
              No sign-in exists in this build. This page is not a private link.
            </span>
            <Link className="btn btn-secondary btn-small" href={demoHref("/demo", state)}>
              Back to the group
            </Link>
          </div>

          <header className="stack gap-1">
            <p className="eyebrow">Your trip</p>
            <h1>Hello, {traveller.displayName}</h1>
            <p className="lede">
              This is what Orkestr has recorded for you. Only you see the details on this page.
            </p>
          </header>

          <section className="card stack gap-2">
            <h2>What you told us</h2>
            {chips.length === 0 ? (
              <p className="muted">You have not set any requirements yet.</p>
            ) : (
              <ul className="stack gap-1" style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {chips.map((chip, index) => (
                  <li key={index} className="row">
                    <span className="badge badge-neutral">{chip.strengthLabel}</span>
                    <span>{chip.label}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {traveller.assistanceNeeds.length > 0 && (
            <section className="card stack gap-2">
              <h2>Assistance</h2>
              {traveller.assistanceNeeds.map((need) => (
                <div key={need.id} className="stack gap-1">
                  <strong style={{ textTransform: "capitalize" }}>
                    {need.type.toLowerCase().replace(/_/g, " ")}
                  </strong>
                  <div className="row">
                    <TruthBadge model={travellerConfirmationBadge(need.confirmedByOwner)} />
                    <TruthBadge model={assistanceProviderBadge(need.operationalStatus)} />
                  </div>
                  <p className="faint">
                    You have confirmed you need this. No airline has confirmed it can be provided,
                    and none is connected yet to ask.
                  </p>
                </div>
              ))}
            </section>
          )}

          {ask !== undefined && (
            <section
              className="card stack gap-2 animate-in"
              style={{ borderLeft: "4px solid var(--tone-pending)" }}
              aria-label="A question for you"
            >
              <p className="eyebrow">A question, just for you</p>
              <h2>{ask.magnitudeSentence}</h2>

              <div className="row" style={{ gap: "2rem" }}>
                <div>
                  <p className="faint">Your usual preference</p>
                  <p style={{ fontWeight: 600 }}>{ask.usualPreference}</p>
                </div>
                <div>
                  <p className="faint">For this trip</p>
                  <p style={{ fontWeight: 600 }}>{ask.forThisTrip}</p>
                </div>
              </div>

              <p className="muted">{ask.scopeSentence}</p>

              <div className="row">
                <button className="btn" type="button">
                  Accept for this trip
                </button>
                <button className="btn btn-secondary" type="button">
                  Keep my limit
                </button>
              </div>

              {/* Literally what the domain does: an acceptance is stored
                  separately and the stated preference is never overwritten. */}
              <p className="faint">{ask.reassurance}</p>
            </section>
          )}
        </div>
      </main>
    </>
  );
}
