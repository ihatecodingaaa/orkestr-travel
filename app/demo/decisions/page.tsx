import Link from "next/link";
import { buildDemoWorld } from "@/ui/demo/scenario";
import { readDemoState, demoHref } from "@/ui/demo/params";
import type { RawParams } from "@/ui/demo/params";
import { buildDecisions } from "@/ui/view/decisions";
import { buildGroupCompromise, affectedTravellerNames } from "@/ui/view/compromise";
import { DemoChrome, DemoControls } from "@/ui/components/DemoChrome";
import { DecisionCard } from "@/ui/components/DecisionCard";

/**
 * What still needs attention.
 *
 * Principle 4 made into a screen. Rather than asking somebody to read a
 * thirty-item itinerary looking for gaps, this is the short list of what
 * actually needs a person or a provider, taken straight from the package.
 */
export default async function DecisionsPage({
  searchParams,
}: {
  readonly searchParams: Promise<RawParams>;
}) {
  const state = readDemoState(await searchParams);
  const world = await buildDemoWorld(state);
  const decisions = buildDecisions(world.journeyPackage, world.travellers);
  const groupCompromise = buildGroupCompromise(world.compromises);
  const affected = affectedTravellerNames(world.compromises, world.travellers);

  return (
    <DemoChrome state={state} current="decisions">
      <section className="stack gap-3" style={{ paddingTop: "2rem" }}>
        <DemoControls state={state} path="/demo/decisions" />

        <header className="stack gap-1">
          <p className="eyebrow">Needs attention</p>
          <h1>{decisions.total} things need a person</h1>
          <p className="lede">{decisions.summarySentence}</p>
        </header>

        {groupCompromise !== undefined && (
          <div className="card stack gap-2" style={{ borderLeft: "4px solid var(--tone-pending)" }}>
            <h3>Someone has been asked a question</h3>
            {/* Group-facing wording: names nobody, quotes no figure. */}
            <p>{groupCompromise.sentence}</p>
            <p className="faint">
              Only the person it affects sees the detail. The rest of the group sees that a
              question exists.
            </p>
            {affected.length > 0 && (
              <p>
                <Link
                  className="btn btn-secondary btn-small"
                  href={demoHref(`/demo/participant/${world.compromises[0]?.affectedTravellerIds[0] ?? ""}`, state)}
                >
                  Open {affected[0]}&apos;s private view
                </Link>
              </p>
            )}
          </div>
        )}

        <div className="stack gap-2">
          {decisions.cards.map((card, index) => (
            <DecisionCard key={index} model={card} />
          ))}
        </div>

        <p className="faint">
          Every item here comes from the plan itself. Orkestr does not add reminders it invented.
        </p>
      </section>
    </DemoChrome>
  );
}
