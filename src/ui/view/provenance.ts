import type { TruthTone } from "./truth";
import type { UnderstandingMode } from "../../domain/extraction";
import type { ResearchMode } from "../../domain/research";

/**
 * The subsystem status surface.
 *
 * WHAT THIS REPLACES AND WHY: Phase 5 had one banner saying "demo mode, local
 * fixture data", which was true when everything came from one place. From Phase
 * 6 it is not: group understanding may be a live model while flight inventory is
 * still a fixture in this repository.
 *
 * ONE GLOBAL "LIVE" LABEL WOULD NOW BE A LIE. It is the single most dangerous
 * thing this interface could do, because it would be true of the part somebody
 * is looking at and false of the part they are about to trust. So provenance is
 * per subsystem, always, and the flight row says LOCAL FIXTURE no matter how
 * live anything else becomes.
 *
 * PURE. Takes modes, returns rows. No component decides its own label.
 */

export type SubsystemState =
  /** A live external call really happened. */
  | "LIVE"
  /** A real earlier result, replayed. Never described as live. */
  | "RECORDED"
  /** Data written by hand in this repository. */
  | "LOCAL_FIXTURE"
  /** No credentials, so nothing was called. Not an error. */
  | "NOT_CONFIGURED"
  /** There is no integration at all. */
  | "NOT_CONNECTED"
  /** It was called and it failed. */
  | "FAILED";

export interface SubsystemStatus {
  /** What part of the product this is, e.g. "Group understanding". */
  readonly subsystem: string;
  readonly state: SubsystemState;
  /** The short label shown beside the subsystem name. */
  readonly label: string;
  /** One sentence stating exactly what the state means. */
  readonly detail: string;
  readonly tone: TruthTone;
}

/**
 * The tone for each state.
 *
 * `verified` is reachable only from LIVE, and even then only for a subsystem
 * whose live-ness means an external system really answered. Nothing local ever
 * gets a tick.
 */
function toneFor(state: SubsystemState): TruthTone {
  switch (state) {
    case "LIVE":
      return "verified";
    case "RECORDED":
    case "LOCAL_FIXTURE":
      return "neutral";
    case "NOT_CONFIGURED":
    case "NOT_CONNECTED":
      return "unknown";
    case "FAILED":
      return "alert";
  }
}

export function understandingStatus(mode: UnderstandingMode, failed = false): SubsystemStatus {
  if (failed) {
    return {
      subsystem: "Group understanding",
      state: "FAILED",
      label: "Failed",
      detail: "The reading did not complete. Nothing was added to the trip.",
      tone: toneFor("FAILED"),
    };
  }
  switch (mode) {
    case "LIVE_MODEL":
      return {
        subsystem: "Group understanding",
        state: "LIVE",
        label: "Qwen - live",
        detail:
          "A live call to Alibaba Cloud Model Studio read the discussion. Everything it produced is a proposal awaiting its owner.",
        tone: toneFor("LIVE"),
      };
    case "LOCAL_FIXTURE":
      return {
        subsystem: "Group understanding",
        state: "LOCAL_FIXTURE",
        label: "Demo fixture extraction",
        detail:
          "A recorded reading from this repository, replayed through the real validation pipeline. No model was called.",
        tone: toneFor("LOCAL_FIXTURE"),
      };
    case "NOT_CONFIGURED":
      return {
        subsystem: "Group understanding",
        state: "NOT_CONFIGURED",
        label: "Not configured",
        detail: "No Model Studio credential is set, so no model call can be made.",
        tone: toneFor("NOT_CONFIGURED"),
      };
  }
}

export function researchStatus(mode: ResearchMode, failed = false): SubsystemStatus {
  if (failed) {
    return {
      subsystem: "Destination research",
      state: "FAILED",
      label: "Failed",
      detail: "The research did not complete. No claim below came from it.",
      tone: toneFor("FAILED"),
    };
  }
  switch (mode) {
    case "LIVE_WEB":
      return {
        subsystem: "Destination research",
        state: "LIVE",
        label: "Model Studio web - live",
        detail:
          "Live web search and page extraction through Model Studio. Every source listed was actually retrieved.",
        tone: toneFor("LIVE"),
      };
    case "RECORDED_WEB":
      return {
        subsystem: "Destination research",
        state: "RECORDED",
        label: "Recorded Model Studio result",
        detail:
          "A structured result captured earlier and replayed. The source links are real pages; the search did not run now.",
        tone: toneFor("RECORDED"),
      };
    case "LOCAL_FIXTURE":
      return {
        subsystem: "Destination research",
        state: "LOCAL_FIXTURE",
        label: "Local fixture",
        detail: "Research data written by hand in this repository. Nothing was retrieved.",
        tone: toneFor("LOCAL_FIXTURE"),
      };
    case "NOT_CONFIGURED":
      return {
        subsystem: "Destination research",
        state: "NOT_CONFIGURED",
        label: "Not configured",
        detail: "No Model Studio credential is set, so no research call can be made.",
        tone: toneFor("NOT_CONFIGURED"),
      };
  }
}

/**
 * Flight inventory.
 *
 * FIXED AT LOCAL_FIXTURE, with no parameter to change it. Phase 6 connected a
 * language model and a web search; it connected no airline. This row exists
 * precisely so that a live badge elsewhere on the page cannot be read as
 * covering the flights, which are still hand-written data in this repository.
 */
export function flightInventoryStatus(): SubsystemStatus {
  return {
    subsystem: "Flight inventory",
    state: "LOCAL_FIXTURE",
    label: "Local fixture",
    detail:
      "Flights, prices and availability are demo data compiled into this build. Nothing came from an airline and nothing is booked.",
    tone: toneFor("LOCAL_FIXTURE"),
  };
}

/** Provider capacity. No provider exists, so there is nothing to ask. */
export function providerCapacityStatus(): SubsystemStatus {
  return {
    subsystem: "Provider capacity",
    state: "NOT_CONNECTED",
    label: "Not connected",
    detail:
      "No flight provider is connected, so no seat has been checked. A traveller who fits a flight is logically compatible, never confirmed.",
    tone: toneFor("NOT_CONNECTED"),
  };
}

/**
 * Assistance.
 *
 * Two separate facts in one row, deliberately joined by "but": the traveller
 * confirming a need and the operator confirming it can be met are confirmed by
 * different parties, and a row that showed only the first would read as arranged.
 */
export function assistanceStatus(travellerConfirmed: boolean): SubsystemStatus {
  return {
    subsystem: "Assistance",
    state: "NOT_CONNECTED",
    label: travellerConfirmed ? "Traveller confirmed, provider pending" : "Not confirmed",
    detail: travellerConfirmed
      ? "The traveller has confirmed the requirement is real. No operator has confirmed it can be met, and none is connected to ask."
      : "The requirement has been recorded but its owner has not confirmed it, and no operator has been asked.",
    tone: toneFor("NOT_CONNECTED"),
  };
}

export interface ProvenanceBoardInput {
  readonly understanding: UnderstandingMode;
  readonly understandingFailed?: boolean;
  readonly research: ResearchMode;
  readonly researchFailed?: boolean;
  readonly assistanceTravellerConfirmed?: boolean;
}

/**
 * The whole board.
 *
 * Order matters: the two subsystems that CAN be live come first, and the two
 * that cannot come immediately after, so a reader never sees a live badge
 * without the fixture rows in the same glance.
 */
export function buildProvenanceBoard(input: ProvenanceBoardInput): readonly SubsystemStatus[] {
  return [
    understandingStatus(input.understanding, input.understandingFailed ?? false),
    researchStatus(input.research, input.researchFailed ?? false),
    flightInventoryStatus(),
    providerCapacityStatus(),
    assistanceStatus(input.assistanceTravellerConfirmed ?? false),
  ];
}

/**
 * The one-line summary shown above the board.
 *
 * Never says "live". It says what mixed provenance means, because that is the
 * true statement about every screen in this build.
 */
export const MIXED_PROVENANCE_NOTE =
  "Different parts of this page come from different places. Each row below says which, and nothing here is booked.";

/**
 * The board for the fixture-backed demo trip.
 *
 * The demo group, its constraints, its activities and its flights are ALL
 * fixtures in this repository. Nothing on those screens came from a model, a
 * search or an airline, and Phase 6 changed none of that.
 *
 * A separate builder rather than the general one because the honest answer here
 * is not "not configured": these subsystems did not fail to run, they were never
 * asked. The trip is a fixture end to end, and the board should say exactly that
 * rather than implying a missing credential is the only thing between this
 * screen and a live one.
 */
export function buildDemoProvenanceBoard(): readonly SubsystemStatus[] {
  return [
    {
      subsystem: "Group understanding",
      state: "LOCAL_FIXTURE",
      label: "Local fixture",
      detail:
        "This group and its requirements are demo data from this build. No discussion was read and no model was called.",
      tone: "neutral",
    },
    {
      subsystem: "Destination research",
      state: "LOCAL_FIXTURE",
      label: "Local fixture",
      detail:
        "Every activity here is fixture-supplied and cited to the fixture. Nothing was researched and no source was retrieved.",
      tone: "neutral",
    },
    flightInventoryStatus(),
    providerCapacityStatus(),
    // The demo family includes one traveller who confirmed a step-free
    // requirement for themselves. No operator has confirmed anything.
    assistanceStatus(true),
  ];
}
