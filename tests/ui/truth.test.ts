import { describe, it, expect } from "vitest";
import {
  assistanceProviderBadge,
  inFlightRequestBadge,
  itemStatusBadge,
  offerEvidenceBadge,
  travellerConfirmationBadge,
} from "@/ui/view/truth";

/**
 * The truth presentation rules.
 *
 * These are the assertions that stop the interface quietly overstating what the
 * domain knows. Every one of them describes a way a demo could lie while
 * looking completely normal.
 */
describe("truth badges never overstate", () => {
  it("gives a suggestion a weaker tone than a booking", () => {
    expect(itemStatusBadge("SUGGESTED").tone).toBe("neutral");
    expect(itemStatusBadge("BOOKED").tone).toBe("verified");
    expect(itemStatusBadge("SUGGESTED").tone).not.toBe(itemStatusBadge("BOOKED").tone);
  });

  it("never renders a suggestion as verified", () => {
    const badge = itemStatusBadge("SUGGESTED");
    expect(badge.label.toLowerCase()).not.toContain("verified");
    expect(badge.label.toLowerCase()).not.toContain("confirmed");
    expect(badge.explanation).toContain("Nothing is reserved");
  });

  it("marks anything needing confirmation as pending, not positive", () => {
    expect(itemStatusBadge("NEEDS_CONFIRMATION").tone).toBe("pending");
    expect(itemStatusBadge("UNKNOWN").tone).toBe("unknown");
  });

  it("gives local fixture data no better than a neutral tone", () => {
    // The strongest tone a fixture may ever reach.
    const badge = offerEvidenceBadge("LOCAL_FIXTURE");
    expect(badge.tone).toBe("neutral");
    expect(badge.explanation).toContain("Not real availability");
  });

  it("flags a changed price and a vanished offer as alerts", () => {
    expect(offerEvidenceBadge("PRICE_CHANGED").tone).toBe("alert");
    expect(offerEvidenceBadge("UNAVAILABLE").tone).toBe("alert");
    expect(offerEvidenceBadge("STALE").tone).toBe("pending");
  });

  it("reserves the verified tone for provider-confirmed evidence only", () => {
    expect(offerEvidenceBadge("ATLAS_VERIFIED").tone).toBe("verified");
    for (const state of ["LOCAL_FIXTURE", "RECORDED_ATLAS_SANDBOX", "ATLAS_SANDBOX_SEARCH"] as const) {
      expect(offerEvidenceBadge(state).tone, state).not.toBe("verified");
    }
  });
});

describe("assistance is never shown as provider-confirmed", () => {
  it("keeps the traveller's confirmation separate from the airline's", () => {
    const traveller = travellerConfirmationBadge(true);
    const provider = assistanceProviderBadge("NEEDS_CONFIRMATION");

    // The traveller confirming is real but is NOT an airline confirmation, so
    // it must not carry the verified tone either.
    expect(traveller.tone).toBe("neutral");
    expect(provider.tone).toBe("pending");
    expect(provider.explanation).toContain("not arranged");
  });

  it("only reaches a verified tone when a provider actually said yes", () => {
    expect(assistanceProviderBadge("PROVIDER_CONFIRMED").tone).toBe("verified");
    for (const status of ["NEEDS_CONFIRMATION", "UNKNOWN", "PROVIDER_DECLINED"] as const) {
      expect(assistanceProviderBadge(status).tone, status).not.toBe("verified");
    }
  });

  it("says plainly that no provider is connected when support is unknown", () => {
    expect(assistanceProviderBadge("UNKNOWN").explanation).toContain("no provider connected");
  });

  it("does not let a recorded in-flight request look arranged", () => {
    expect(inFlightRequestBadge("REQUESTED").tone).toBe("neutral");
    expect(inFlightRequestBadge("REQUESTED").explanation).toContain("Nothing has been sent");
    expect(inFlightRequestBadge("NEEDS_PROVIDER_CONFIRMATION").tone).toBe("pending");
  });
});
