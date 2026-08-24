import { describe, it, expect } from "vitest";
import { understandingFailureModel } from "@/ui/view/understanding";
import {
  assistanceStatus,
  buildProvenanceBoard,
  flightInventoryStatus,
  providerCapacityStatus,
  researchStatus,
  understandingStatus,
} from "@/ui/view/provenance";
import type { UnderstandingMode } from "@/domain/extraction";
import type { ResearchMode } from "@/domain/research";

/**
 * Mixed provenance.
 *
 * THE FAILURE THIS PREVENTS: a live badge on one subsystem being read as
 * covering another. It is the single most dangerous thing this interface could
 * do, because it would be true of the part somebody is looking at and false of
 * the part they are about to trust.
 */

const ALL_UNDERSTANDING: readonly UnderstandingMode[] = [
  "LIVE_MODEL",
  "LOCAL_FIXTURE",
  "NOT_CONFIGURED",
];
const ALL_RESEARCH: readonly ResearchMode[] = [
  "LIVE_WEB",
  "RECORDED_WEB",
  "LOCAL_FIXTURE",
  "NOT_CONFIGURED",
];

describe("no subsystem can borrow another's credibility", () => {
  it("keeps flights labelled a local fixture whatever else goes live", () => {
    for (const understanding of ALL_UNDERSTANDING) {
      for (const research of ALL_RESEARCH) {
        const board = buildProvenanceBoard({ understanding, research });
        const flights = board.find((row) => row.subsystem === "Flight inventory");
        expect(flights?.state, `${understanding}/${research}`).toBe("LOCAL_FIXTURE");
        expect(flights?.label).toBe("Local fixture");
        expect(flights?.tone).not.toBe("verified");
      }
    }
  });

  it("keeps provider capacity not connected whatever else goes live", () => {
    for (const understanding of ALL_UNDERSTANDING) {
      for (const research of ALL_RESEARCH) {
        const board = buildProvenanceBoard({ understanding, research });
        const capacity = board.find((row) => row.subsystem === "Provider capacity");
        expect(capacity?.state).toBe("NOT_CONNECTED");
      }
    }
  });

  it("shows every row every time, including the unflattering ones", () => {
    const board = buildProvenanceBoard({ understanding: "LIVE_MODEL", research: "LIVE_WEB" });
    expect(board.map((r) => r.subsystem)).toEqual([
      "Group understanding",
      "Destination research",
      "Flight inventory",
      "Provider capacity",
      "Assistance",
    ]);
  });

  it("puts the two live-capable rows before the two that never are", () => {
    // So a reader never sees a live badge without the fixture rows in the same
    // glance.
    const board = buildProvenanceBoard({ understanding: "LIVE_MODEL", research: "LIVE_WEB" });
    const flightIndex = board.findIndex((r) => r.subsystem === "Flight inventory");
    const understandingIndex = board.findIndex((r) => r.subsystem === "Group understanding");
    expect(understandingIndex).toBeLessThan(flightIndex);
  });

  /**
   * This previously asserted that Atlas is mentioned NOWHERE, which was true
   * until Phase 7 connected it. The premise changed; the property worth keeping
   * did not. A board that was not told about Atlas must not name it, because
   * naming a provider nobody called is the overclaim this row exists to prevent.
   */
  it("names Atlas only when Atlas was actually used", () => {
    const withoutAtlas = buildProvenanceBoard({
      understanding: "LIVE_MODEL",
      research: "LIVE_WEB",
    });
    expect(JSON.stringify(withoutAtlas).toLowerCase()).not.toContain("atlas");

    const withAtlas = buildProvenanceBoard({
      understanding: "LIVE_MODEL",
      research: "LIVE_WEB",
      flights: "ATLAS_SANDBOX",
    });
    expect(JSON.stringify(withAtlas).toLowerCase()).toContain("atlas");
  });

  it("never mentions ATRIP, which is an account system and not a data source", () => {
    for (const flights of ["LOCAL_FIXTURE", "ATLAS_SANDBOX", "RECORDED_ATLAS_SANDBOX"] as const) {
      const board = buildProvenanceBoard({
        understanding: "LIVE_MODEL",
        research: "LIVE_WEB",
        flights,
      });
      expect(JSON.stringify(board).toLowerCase()).not.toContain("atrip");
    }
  });
});

describe("understanding states", () => {
  it("labels a live model as live, and says proposals still await their owner", () => {
    const status = understandingStatus("LIVE_MODEL");
    expect(status.state).toBe("LIVE");
    expect(status.label).toContain("live");
    expect(status.detail).toContain("proposal");
  });

  it("never labels a fixture reading as a model reading", () => {
    const status = understandingStatus("LOCAL_FIXTURE");
    expect(status.state).toBe("LOCAL_FIXTURE");
    expect(status.label.toLowerCase()).toContain("fixture");
    expect(status.detail).toContain("No model was called");
    expect(status.tone).not.toBe("verified");
  });

  it("treats no credential as a state rather than an error", () => {
    const status = understandingStatus("NOT_CONFIGURED");
    expect(status.state).toBe("NOT_CONFIGURED");
    expect(status.tone).toBe("unknown");
  });

  it("reports a failure as a failure, never as a fixture", () => {
    const status = understandingStatus("LIVE_MODEL", true);
    expect(status.state).toBe("FAILED");
    expect(status.tone).toBe("alert");
    expect(status.detail).toContain("Nothing was added");
  });
});

describe("research states", () => {
  it("distinguishes live from recorded, in the label and not only in the data", () => {
    const live = researchStatus("LIVE_WEB");
    const recorded = researchStatus("RECORDED_WEB");
    expect(live.state).toBe("LIVE");
    expect(recorded.state).toBe("RECORDED");
    expect(recorded.label.toLowerCase()).toContain("recorded");
    expect(recorded.label.toLowerCase()).not.toContain("live");
    expect(recorded.detail).toContain("did not run now");
  });

  it("gives a recorded result no verified tone", () => {
    expect(researchStatus("RECORDED_WEB").tone).not.toBe("verified");
    expect(researchStatus("LOCAL_FIXTURE").tone).not.toBe("verified");
  });

  it("says that live sources were actually retrieved", () => {
    expect(researchStatus("LIVE_WEB").detail).toContain("actually retrieved");
  });
});

describe("assistance is two facts, never one", () => {
  it("says provider confirmation is still missing even once the traveller confirms", () => {
    const status = assistanceStatus(true);
    expect(status.label).toContain("Traveller confirmed");
    expect(status.label).toContain("provider pending");
    expect(status.detail).toContain("No operator has confirmed");
    // Never a tick. Nobody has confirmed it can be met.
    expect(status.tone).not.toBe("verified");
  });

  it("does not imply anything is arranged when nothing is", () => {
    const status = assistanceStatus(false);
    expect(status.tone).not.toBe("verified");
    expect(status.detail).toContain("not confirmed");
  });
});

describe("the fixture and capacity rows say what they mean", () => {
  it("says flights are not real availability and nothing is booked", () => {
    const status = flightInventoryStatus();
    expect(status.detail).toContain("nothing is booked");
    expect(status.detail).toContain("Nothing came from an airline");
  });

  it("says a fitting traveller is compatible, never confirmed", () => {
    const status = providerCapacityStatus();
    expect(status.detail).toContain("logically compatible");
    expect(status.detail).not.toContain("seat is available");
  });
});

/**
 * Phase 7. The flight row can now say Atlas, which makes it the row most able
 * to mislead: a sandbox fare is test data, and somebody reading "live" beside a
 * price will believe it is a price.
 */
describe("the flight inventory row after Atlas", () => {
  it("says sandbox in every Atlas label, because sandbox fares are not buyable", () => {
    for (const mode of ["ATLAS_SANDBOX", "RECORDED_ATLAS_SANDBOX"] as const) {
      const row = flightInventoryStatus(mode);
      expect(row.label.toLowerCase()).toContain("sandbox");
      expect(row.detail.toLowerCase()).toContain("test data");
      expect(row.detail.toLowerCase()).toContain("nothing is booked");
    }
  });

  it("distinguishes a live sandbox call from a replayed one", () => {
    expect(flightInventoryStatus("ATLAS_SANDBOX").state).toBe("LIVE");
    expect(flightInventoryStatus("RECORDED_ATLAS_SANDBOX").state).toBe("RECORDED");
    // A recording must never carry a live tone.
    expect(flightInventoryStatus("RECORDED_ATLAS_SANDBOX").detail).toMatch(/captured earlier/i);
  });

  it("renders an Atlas failure as a failure, never as fixture data", () => {
    const row = flightInventoryStatus("ATLAS_FAILED");
    expect(row.state).toBe("FAILED");
    expect(row.detail).toMatch(/nothing is shown in its place/i);
    expect(row.label.toLowerCase()).not.toContain("fixture");
  });

  it("defaults to the fixture row, so Atlas cannot be claimed by omission", () => {
    expect(flightInventoryStatus().state).toBe("LOCAL_FIXTURE");
    const board = buildProvenanceBoard({ understanding: "LIVE_MODEL", research: "LIVE_WEB" });
    const flights = board.find((row) => row.subsystem === "Flight inventory");
    expect(flights?.state).toBe("LOCAL_FIXTURE");
  });

  it("keeps flights independent of everything else that went live", () => {
    const board = buildProvenanceBoard({
      understanding: "LIVE_MODEL",
      research: "RECORDED_WEB",
      flights: "ATLAS_SANDBOX",
    });
    // Three subsystems, three different provenances, one page. No global badge.
    const states = new Map(board.map((row) => [row.subsystem, row.state] as const));
    expect(states.get("Group understanding")).toBe("LIVE");
    expect(states.get("Destination research")).toBe("RECORDED");
    expect(states.get("Flight inventory")).toBe("LIVE");
    expect(states.get("Provider capacity")).toBe("NOT_CONNECTED");
  });

  it("still says no seat is reserved, even with Atlas connected", () => {
    const board = buildProvenanceBoard({
      understanding: "LIVE_MODEL",
      research: "LIVE_WEB",
      flights: "ATLAS_SANDBOX",
    });
    const capacity = board.find((row) => row.subsystem === "Provider capacity");
    expect(capacity?.state).toBe("NOT_CONNECTED");
    // Searching is not ordering, and the row must not blur them.
    expect(capacity?.detail).toMatch(/does not create orders/i);
  });
});

describe("a board never states something false about its own configuration", () => {
  /**
   * OBSERVED IN PRODUCTION. The /understand screen showed a live extraction
   * that had just run -- alibaba-model-studio, qwen3.7-plus, orkestr-intent-v2
   * -- and, directly beneath it, "Destination research - Not configured - No
   * Model Studio credential is set."
   *
   * Both rows were about the same deployment. One of them was wrong.
   *
   * The two failures were unrelated: the extraction genuinely timed out, and
   * the research row was a hard-coded placeholder that reused NOT_CONFIGURED
   * because the screen does no research. "Not asked" is true; "no credential
   * exists" was not, and a board that says one untrue thing devalues every
   * other row on it.
   */
  it("says a subsystem was not asked, rather than claiming no credential", () => {
    const board = buildProvenanceBoard({
      understanding: "LIVE_MODEL",
      research: "NOT_CONFIGURED",
      researchAsked: false,
    });

    const research = board.find((row) => row.subsystem === "Destination research");
    expect(research?.state).toBe("NOT_RUN");
    expect(research?.detail).not.toMatch(/credential/i);
    expect(research?.detail).toMatch(/does not research/i);
  });

  it("never claims a credential is missing on a board where a live call ran", () => {
    const board = buildProvenanceBoard({
      understanding: "LIVE_MODEL",
      research: "NOT_CONFIGURED",
      researchAsked: false,
    });

    const liveRan = board.some((row) => row.state === "LIVE");
    expect(liveRan).toBe(true);
    for (const row of board) {
      expect(
        row.detail,
        `${row.subsystem} claims no credential while a live call ran on the same board`,
      ).not.toMatch(/No Model Studio credential is set/i);
    }
  });

  it("still says NOT_CONFIGURED where that is genuinely true", () => {
    // The claim is correct when research WAS asked and there is no credential.
    const board = buildProvenanceBoard({
      understanding: "NOT_CONFIGURED",
      research: "NOT_CONFIGURED",
    });
    const research = board.find((row) => row.subsystem === "Destination research");
    expect(research?.state).toBe("NOT_CONFIGURED");
    expect(research?.detail).toMatch(/credential/i);
  });

  it("a failed extraction does not change what the research row says", () => {
    /**
     * The two are independent subsystems. A timeout in one must not be
     * described as, or alongside, a configuration problem in the other.
     */
    const board = buildProvenanceBoard({
      understanding: "LIVE_MODEL",
      understandingFailed: true,
      research: "NOT_CONFIGURED",
      researchAsked: false,
    });

    const understanding = board.find((row) => row.subsystem === "Group understanding");
    const research = board.find((row) => row.subsystem === "Destination research");

    expect(understanding?.state).toBe("FAILED");
    expect(research?.state).toBe("NOT_RUN");
    expect(research?.detail).not.toMatch(/credential|failed|timeout/i);
  });
});

describe("a timeout says which kind of timeout it was", () => {
  /**
   * OBSERVED IN PRODUCTION, and the reason this distinction exists. The same
   * request took 9s from a laptop and hit the 30s ceiling from the deployed
   * runtime, every time, with a SMALLER input and no retries.
   *
   * "The model took too long" is true of both a provider that never answered
   * and one that answered and was slow to finish -- and those are a
   * connectivity problem and a model problem, with opposite fixes. A person
   * staring at the screen cannot tell them apart, and the transport can.
   */
  it("carries the provider's own note when there is one", () => {
    const model = understandingFailureModel(
      "MODEL_TIMEOUT",
      "The provider did not answer at all within 30000ms.",
    );
    expect(model.title).toBe("The model took too long");
    expect(model.providerNote).toMatch(/did not answer at all/i);
  });

  it("says nothing extra when the transport had nothing to add", () => {
    const model = understandingFailureModel("MODEL_TIMEOUT");
    expect(model.providerNote).toBeUndefined();
    expect(model.title).toBe("The model took too long");
  });

  it("ignores an empty note rather than rendering a blank line", () => {
    expect(understandingFailureModel("MODEL_TIMEOUT", "   ").providerNote).toBeUndefined();
  });

  it("works for every failure code, not just timeouts", () => {
    const model = understandingFailureModel("MODEL_UNAVAILABLE", "The provider could not be reached.");
    expect(model.providerNote).toBe("The provider could not be reached.");
  });
});
