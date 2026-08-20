import Link from "next/link";
import { buildDemoWorld } from "@/ui/demo/scenario";
import { readDemoState, demoHref } from "@/ui/demo/params";
import type { RawParams } from "@/ui/demo/params";
import { buildJourneyPackageModel } from "@/ui/view/journey";
import { buildGroupCompromise } from "@/ui/view/compromise";
import { buildFareCheck } from "@/ui/view/repair";
import { DemoChrome, DemoControls } from "@/ui/components/DemoChrome";
import { JourneyDay } from "@/ui/components/JourneyTimeline";
import { TruthBadge } from "@/ui/components/TruthBadge";

/**
 * The whole journey.
 *
 * Day by day, with each day naming who is actually present. Day 1 of a split
 * arrival belongs to one travel group, and the interface makes that obvious
 * rather than leaving it as a detail somebody might miss.
 *
 * The fare panel appears once a verification has been run. What the new price
 * MEANS is decided by the repair engine; this page only renders the verdict.
 */
export default async function JourneyPage({
  searchParams,
}: {
  readonly searchParams: Promise<RawParams>;
}) {
  const state = readDemoState(await searchParams);
  const world = await buildDemoWorld(state);

  const waveCount =
    (world.outboundPlan?.waveCount ?? 0) + (world.returnPlan?.waveCount ?? 0);
  const model = buildJourneyPackageModel(
    world.journeyPackage,
    world.travellers,
    "Tokyo",
    waveCount,
  );
  const groupCompromise = buildGroupCompromise(world.compromises);
  const fareCheck =
    world.fare === undefined
      ? undefined
      : buildFareCheck({
          previousMinor: world.fare.previousMinor,
          newMinor: world.fare.newMinor,
          currency: world.fare.currency,
          minorUnitScale: 2,
          unchanged: world.fare.unchanged,
          unavailable: world.fare.unavailable,
          repairStatus: world.fare.repair.status,
          groupSentence: groupCompromise?.sentence,
        });

  return (
    <DemoChrome state={state} current="journey">
      <section className="stack gap-3" style={{ paddingTop: "2rem" }}>
        <DemoControls state={state} path="/demo/journey" />

        <header className="stack gap-1">
          <p className="eyebrow">{model.destinationLabel}</p>
          <h1>The journey</h1>
          <p className="lede">
            {model.durationLabel} · {model.travellerCount} travellers · {model.waveCount} travel
            groups across the whole trip
          </p>
          <div className="row">
            <span className={`badge badge-${model.statusTone}`}>{model.statusLabel}</span>
            <Link className="btn btn-secondary btn-small" href={demoHref("/demo/decisions", state)}>
              {model.decisionCount} need attention
            </Link>
            <span className="faint">{model.itemCount} items in the plan</span>
          </div>
        </header>

        {fareCheck !== undefined && (
          <div
            className="card stack gap-2 animate-in"
            style={{ borderLeft: `4px solid var(--tone-${fareCheck.tone})` }}
            aria-label="Fare check"
          >
            <p className="eyebrow">Fare check</p>
            <h2>{fareCheck.headline}</h2>
            <p className="muted">{fareCheck.detail}</p>
            <p>{fareCheck.verdict}</p>
            <p className="faint">{fareCheck.sourceNote}</p>
          </div>
        )}

        <div className="stack gap-3">
          {model.days.map((day) => (
            <JourneyDay key={day.dayNumber} model={day} />
          ))}
        </div>

        {model.inFlightRequests.length > 0 && (
          <section className="card stack gap-2">
            <h2>On-board requests</h2>
            {model.inFlightRequests.map((request, index) => (
              <div key={index} className="row" style={{ justifyContent: "space-between" }}>
                <div>
                  <strong>{request.travellerName}</strong>
                  <p className="faint">{request.detail}</p>
                </div>
                <div className="stack gap-1" style={{ alignItems: "flex-end" }}>
                  <TruthBadge model={request.badge} />
                  <span className="faint">{request.capabilityNote}</span>
                </div>
              </div>
            ))}
          </section>
        )}
      </section>
    </DemoChrome>
  );
}
