import { describe, it, expect } from "vitest";
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

  it("mentions Atlas nowhere, because no provider is connected", () => {
    const board = buildProvenanceBoard({ understanding: "LIVE_MODEL", research: "LIVE_WEB" });
    const text = JSON.stringify(board).toLowerCase();
    expect(text).not.toContain("atlas");
    expect(text).not.toContain("atrip");
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
