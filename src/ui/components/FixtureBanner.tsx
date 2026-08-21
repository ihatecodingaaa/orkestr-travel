import { SubsystemStatusBoard } from "./SubsystemStatusBoard";
import { buildDemoProvenanceBoard } from "../view/provenance";

/**
 * The data-source surface for the fixture-backed demo trip.
 *
 * Phase 5 shipped this as ONE banner saying "demo mode, local fixture data",
 * which was true when everything in the product came from one place. Phase 6
 * connected a language model and a web search, so that is no longer true of the
 * application as a whole, and a single label would now be the wrong shape even
 * on the screens where it is still accurate.
 *
 * So it is the same per-subsystem board used everywhere else, filled in for what
 * these screens actually are: a trip whose group, activities and flights are all
 * fixtures in this repository. Always visible, never a tooltip, so somebody
 * watching a demo can see at any moment that none of it is real.
 */
export function FixtureBanner() {
  return <SubsystemStatusBoard rows={buildDemoProvenanceBoard()} />;
}
