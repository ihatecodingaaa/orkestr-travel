import type { DemoStage, DemoState, FareScenario } from "./scenario";
import { INITIAL_DEMO_STATE } from "./scenario";

/**
 * Demo state lives in the URL.
 *
 * WHY: it makes the demo deterministic by construction. Every screen is a pure
 * function of its address, RESET is a link back to the bare path, and any point
 * in the sequence can be reached directly if a live demo needs rescuing. There
 * is no hidden client state to get out of step with what is on screen.
 *
 * Unrecognised values fall back to the baseline rather than throwing, so a
 * mistyped URL degrades to a sensible screen instead of an error page.
 */

const STAGES: readonly DemoStage[] = ["BASELINE", "RYAN_JOINED"];
const FARES: readonly FareScenario[] = [
  "NOT_VERIFIED",
  "UNCHANGED",
  "ACCEPTABLE_RISE",
  "SOFT_BREACH",
  "HARD_BREACH",
  "UNAVAILABLE",
];

export type RawParams = Record<string, string | string[] | undefined>;

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function readDemoState(params: RawParams): DemoState {
  const stage = firstValue(params["stage"]);
  const fare = firstValue(params["fare"]);

  return {
    stage: STAGES.includes(stage as DemoStage) ? (stage as DemoStage) : INITIAL_DEMO_STATE.stage,
    fareScenario: FARES.includes(fare as FareScenario)
      ? (fare as FareScenario)
      : INITIAL_DEMO_STATE.fareScenario,
    // Accepted compromises are not URL state: an acceptance is a real act by a
    // real person, and making it a query parameter would imply anybody holding
    // the link had given it.
    acceptedCompromises: [],
  };
}

/** Build a link that preserves the rest of the demo state. */
export function demoHref(
  path: string,
  state: DemoState,
  overrides: Partial<Pick<DemoState, "stage" | "fareScenario">> = {},
): string {
  const stage = overrides.stage ?? state.stage;
  const fare = overrides.fareScenario ?? state.fareScenario;

  const query = new URLSearchParams();
  if (stage !== INITIAL_DEMO_STATE.stage) query.set("stage", stage);
  if (fare !== INITIAL_DEMO_STATE.fareScenario) query.set("fare", fare);

  const suffix = query.toString();
  return suffix.length === 0 ? path : `${path}?${suffix}`;
}
