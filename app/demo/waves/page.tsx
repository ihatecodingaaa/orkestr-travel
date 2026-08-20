import { buildDemoWorld } from "@/ui/demo/scenario";
import { readDemoState } from "@/ui/demo/params";
import type { RawParams } from "@/ui/demo/params";
import { buildJourneyWaves } from "@/ui/view/waves";
import { buildRepairModel } from "@/ui/view/repair";
import { DemoChrome, DemoControls } from "@/ui/components/DemoChrome";
import { WaveFlow, WhyThisWorks } from "@/ui/components/WaveFlow";
import { ChangeList, PreservationSummary } from "@/ui/components/PreservationSummary";

/**
 * Travel groups: the signature screen.
 *
 * Legs render generically from JourneyLeg[], so the outbound and return
 * journeys use the same component and a third leg would need no new code.
 *
 * When Ryan has joined, the repair panel appears alongside. It is the real
 * Phase 3 output, so "Wave A unchanged" is a fact the engine reported rather
 * than a line written into the page.
 */
export default async function WavesPage({
  searchParams,
}: {
  readonly searchParams: Promise<RawParams>;
}) {
  const state = readDemoState(await searchParams);
  const world = await buildDemoWorld(state);
  const legs = buildJourneyWaves(world.journey, world.travellers);
  const repair = world.repair === undefined ? undefined : buildRepairModel(world.repair, world.travellers);

  return (
    <DemoChrome state={state} current="waves">
      <section className="stack gap-4" style={{ paddingTop: "2rem" }}>
        <DemoControls state={state} path="/demo/waves" />

        {repair !== undefined && (
          <section className="stack gap-3 animate-in" aria-label="What changed when Ryan joined">
            <header className="stack gap-1">
              <p className="eyebrow">Ryan joined</p>
              <h2>{repair.headline}</h2>
              <p className="lede">{repair.impactLabel}.</p>
            </header>
            <div className="split">
              <ChangeList rows={repair.changes} />
              <div className="stack gap-2">
                <PreservationSummary model={repair.preservation} />
                {repair.reverificationLabels.length > 0 && (
                  <div className="card stack gap-1">
                    <h3>Needs re-checking</h3>
                    <p>{repair.reverificationLabels.join(", ")}</p>
                    {/* Never says a seat exists, because nobody has checked. */}
                    <p className="faint">
                      Ryan fits this flight&apos;s requirements. Whether a seat is available has
                      not been checked with any airline.
                    </p>
                  </div>
                )}
                {repair.questionCount === 0 && (
                  <p className="faint">Nobody needs to answer anything.</p>
                )}
              </div>
            </div>
          </section>
        )}

        {legs.map((leg) => (
          <div className="split" key={leg.legId}>
            <WaveFlow model={leg} />
            <WhyThisWorks model={leg} />
          </div>
        ))}
      </section>
    </DemoChrome>
  );
}
