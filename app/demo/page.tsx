import { buildDemoWorld } from "@/ui/demo/scenario";
import { readDemoState } from "@/ui/demo/params";
import type { RawParams } from "@/ui/demo/params";
import { buildGroupBoard } from "@/ui/view/group";
import { DemoChrome, DemoControls } from "@/ui/components/DemoChrome";
import { TravellerCard } from "@/ui/components/TravellerCard";

/**
 * The group board.
 *
 * Rendered for the GROUP audience, so every private constraint appears as its
 * category and never as its value. The privacy selectors do that filtering
 * before this file sees the data.
 */
export default async function GroupPage({
  searchParams,
}: {
  readonly searchParams: Promise<RawParams>;
}) {
  const state = readDemoState(await searchParams);
  const world = await buildDemoWorld(state);
  const board = buildGroupBoard(world.travellers, { kind: "GROUP" }, 7);

  return (
    <DemoChrome state={state} current="group">
      <section className="stack gap-3" style={{ paddingTop: "2rem" }}>
        <DemoControls state={state} path="/demo" />

        <header className="stack gap-1">
          <p className="eyebrow">Tokyo · five days</p>
          <h1>Who is going</h1>
          <p className="lede">
            {board.joinedCount} of {board.expectedCount ?? board.joinedCount} expected travellers
            have joined so far
            {board.invitedCount > 0 ? `, and ${board.invitedCount} has not replied yet.` : "."}{" "}
            {board.needsConfirmationCount > 0 && (
              <>{board.needsConfirmationCount} things still need confirming.</>
            )}
          </p>
        </header>

        {/* The group sees that somebody has a budget or availability
            requirement. It never sees the figure, and never who it belongs to
            unless that person chose to share it. */}
        <p className="faint">
          Personal details stay private. The group sees that a requirement exists, not what it
          says.
        </p>

        <div className="grid">
          {board.travellers.map((traveller) => (
            <TravellerCard key={traveller.id} model={traveller} />
          ))}
        </div>
      </section>
    </DemoChrome>
  );
}
