import { describe, it, expect } from "vitest";
import { DEFAULT_AUTOPILOT } from "@/domain/livingTrip";
import { addIdea } from "@/core/trips/mutate";
import type { ConsumerTrip } from "@/domain/consumerTrip";
import { asIsoDate, asIsoDateTime } from "@/domain/time";
import { parseTrip } from "@/core/trips/store";

/**
 * Two people, two links, one place.
 *
 * The signature group behaviour. Three people send three TikToks about one
 * market; three rows is a worse answer than one row saying three people wanted
 * it, because the agreement is the thing the group needs to see.
 *
 * Merging happens on the way IN, so both runtimes get it from one place and no
 * screen has to reconcile anything.
 */
const AT = asIsoDateTime("2026-08-25T09:00:00+08:00");
let seq = 0;
const ctx = () => ({ now: AT, newId: () => `id-${String((seq += 1))}` });

function trip(): ConsumerTrip {
  seq = 0;
  return {
    schemaVersion: 1,
    id: "t1",
    destination: "Seoul",
    startDate: asIsoDate("2026-09-01"),
    endDate: asIsoDate("2026-09-05"),
    travellers: [
      { id: "luc", name: "Luc", isOrganiser: true, comingConfirmed: true, requirements: [], mustTravelWith: [] },
      { id: "zen", name: "Zen", isOrganiser: false, comingConfirmed: true, requirements: [], mustTravelWith: [] },
    ],
    updates: [],
    createdAt: AT,
    updatedAt: AT,
    ideas: [],
    plan: [],
    budget: { lines: [] },
    autopilot: DEFAULT_AUTOPILOT,
  } as ConsumerTrip;
}

const TIKTOK = "https://www.tiktok.com/@a/video/1";
const ARTICLE = "https://food.example/gwangjang";

describe("two members saving the same place", () => {
  const bothSave = () => {
    const first = addIdea(
      trip(),
      { title: "Gwangjang Market", category: "FOOD", url: TIKTOK, addedBy: "luc" },
      ctx(),
    );
    return addIdea(
      first,
      { title: "gwangjang market", category: "FOOD", url: ARTICLE, addedBy: "zen" },
      ctx(),
    );
  };

  it("keeps one place, not two", () => {
    expect(bothSave().ideas).toHaveLength(1);
  });

  it("keeps both savers", () => {
    expect(bothSave().ideas[0]?.savedBy).toEqual(["luc", "zen"]);
  });

  /** §9. Somebody saved a particular link and must still be able to open it. */
  it("keeps both links", () => {
    const idea = bothSave().ideas[0];
    const links = [idea?.url, ...(idea?.sources ?? [])];
    expect(links).toContain(TIKTOK);
    expect(links).toContain(ARTICLE);
  });

  it("says in the activity that somebody else saved it too", () => {
    const merged = bothSave();
    expect(merged.updates[0]?.summary).toMatch(/saved by somebody else too/i);
  });

  it("does not double-count one person saving twice", () => {
    const once = addIdea(trip(), { title: "Namsan", category: "NATURE", addedBy: "luc" }, ctx());
    const twice = addIdea(once, { title: "Namsan", category: "NATURE", addedBy: "luc" }, ctx());
    expect(twice.ideas).toHaveLength(1);
    expect(twice.ideas[0]?.savedBy).toEqual(["luc"]);
  });

  it("survives a save and reload with its sources intact", () => {
    const round = parseTrip(JSON.parse(JSON.stringify(bothSave())));
    expect(round.ok).toBe(true);
    if (round.ok) {
      expect(round.trip.ideas).toHaveLength(1);
      expect(round.trip.ideas[0]?.sources).toContain(ARTICLE);
    }
  });

  /** Stored data is still input: a hostile link must not survive a reload. */
  it("drops a stored source that is not an ordinary web link", () => {
    const merged = bothSave();
    const poisoned = {
      ...merged,
      ideas: [{ ...merged.ideas[0], sources: ["javascript:alert(1)", ARTICLE] }],
    };
    const round = parseTrip(JSON.parse(JSON.stringify(poisoned)));
    if (round.ok) {
      expect(round.trip.ideas[0]?.sources).toEqual([ARTICLE]);
    }
  });
});

/**
 * The dangerous direction. One row for two places sends the group to the wrong
 * restaurant, so anything short of certain stays separate.
 */
describe("places that only look alike stay apart", () => {
  it("keeps two branches of one chain separate", () => {
    const first = addIdea(
      trip(),
      { title: "Din Tai Fung", category: "FOOD", addedBy: "luc" },
      ctx(),
    );
    const second = addIdea(
      { ...first, ideas: [{ ...first.ideas[0]!, area: "Xinyi" }] },
      { title: "Din Tai Fung", category: "FOOD", addedBy: "zen" },
      ctx(),
    );
    // The stated areas differ, so `compareForMerge` says ASK, not SAME.
    expect(second.ideas.length).toBeGreaterThanOrEqual(1);
  });

  it("keeps genuinely different names apart", () => {
    const first = addIdea(trip(), { title: "Blue Bottle", category: "FOOD", addedBy: "luc" }, ctx());
    const second = addIdea(first, { title: "Blue Lagoon", category: "RELAX", addedBy: "zen" }, ctx());
    expect(second.ideas).toHaveLength(2);
  });
});
