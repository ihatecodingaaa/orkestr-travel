import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { PostgresTripRepository } from "@/server/shared/postgresRepository";
import { closePool, query } from "@/server/shared/db";
import { applySharedMutation } from "@/server/shared/applyMutation";
import { buildActorTrip } from "@/core/shared/actorTrip";
import { parseTrip } from "@/core/trips/store";
import type { TripActor, TripMember } from "@/domain/sharedTrip";
import { asIsoDate, asIsoDateTime } from "@/domain/time";

/**
 * Shared mutations, against a real database.
 *
 * The in-memory suite proves the RULES: who may change what, and what a stale
 * write does. This proves the same rules survive the round trip through
 * PostgreSQL -- that a private requirement really lands in owner-only storage,
 * that a refused mutation really leaves the trip alone, and that a version
 * conflict really comes from the database rather than from a check the code
 * performed on itself.
 *
 * Requires a database and FAILS without one, for the reason given in
 * `postgresRepository.test.ts`.
 */

const PREFIX = "mtest-";
const NOW = asIsoDateTime("2026-08-24T10:00:00.000Z");
const SENTINEL = "no more than 650 a person";

const repo = new PostgresTripRepository();
const made: string[] = [];

async function seed() {
  const id = `${PREFIX}${randomUUID()}`;
  made.push(id);

  await repo.createTrip({
    tripId: id,
    payload: {
      schemaVersion: 2,
      id,
      destination: "Seoul",
      startDate: "2026-09-05",
      endDate: "2026-09-12",
      createdAt: NOW,
      updatedAt: NOW,
      travellers: [
        {
          id: "t-lucas",
          name: "Lucas",
          isOrganiser: true,
          comingConfirmed: true,
          requirements: [],
          mustTravelWith: [],
        },
        { id: "t-zen", name: "Zen", isOrganiser: false, requirements: [], mustTravelWith: [] },
      ],
      updates: [],
      ideas: [],
      plan: [],
      budget: { lines: [] },
      autopilot: { flagStaleFacts: true, suggestRepairs: true, preserveFixedItems: true },
    },
    organiser: { travellerId: "t-lucas", name: "Lucas" },
    otherMembers: [{ travellerId: "t-zen", name: "Zen" }],
    now: NOW,
  });

  const members = await repo.listMembers(id);
  const by = (name: string): TripMember => members.find((m) => m.name === name)!;
  const actor = (m: TripMember): TripActor => ({
    tripId: id,
    memberId: m.id,
    role: m.role,
    sessionId: `s-${m.name}`,
  });

  return {
    id,
    members,
    organiser: actor(by("Lucas")),
    zen: actor(by("Zen")),
    zenMember: by("Zen"),
  };
}

const versionOf = async (id: string): Promise<number> =>
  (await repo.getTripVersion(id)) ?? 0;

const tripOf = async (id: string) => {
  const record = await repo.getTrip(id);
  const parsed = parseTrip(record?.payload);
  if (!parsed.ok) throw new Error("stored trip is unreadable");
  return parsed.trip;
};

beforeAll(() => {
  if (process.env.DATABASE_URL === undefined || process.env.DATABASE_URL.trim() === "") {
    throw new Error("DATABASE_URL is not set. These tests fail rather than skip.");
  }
});

afterAll(async () => {
  for (const id of made) {
    await query("DELETE FROM shared_trip WHERE id = $1", [id]).catch(() => undefined);
  }
  await closePool();
});

describe("anybody on the trip contributes ideas", () => {
  it("a traveller can add one, and it is attributed to them", async () => {
    const { id, zen } = await seed();

    const result = await applySharedMutation(repo, zen, {
      mutation: { kind: "ADD_IDEA", title: "Hongdae at night", category: "NIGHT" },
      expectedVersion: await versionOf(id),
      now: NOW,
    });
    expect(result.ok).toBe(true);

    const trip = await tripOf(id);
    const idea = trip.ideas.find((candidate) => candidate.title === "Hongdae at night");
    expect(idea?.addedBy).toBe("t-zen");
    // Adding something counts as wanting it.
    expect(idea?.savedBy).toContain("t-zen");
  });

  it("a traveller cannot remove somebody else's idea", async () => {
    const { id, organiser, zen } = await seed();

    await applySharedMutation(repo, organiser, {
      mutation: { kind: "ADD_IDEA", title: "Organiser's pick", category: "FOOD" },
      expectedVersion: await versionOf(id),
      now: NOW,
    });

    const trip = await tripOf(id);
    const ideaId = trip.ideas[0]!.id;

    const refused = await applySharedMutation(repo, zen, {
      mutation: { kind: "REMOVE_IDEA", ideaId },
      expectedVersion: await versionOf(id),
      now: NOW,
    });

    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.message).toMatch(/only remove ideas you added/i);
    expect((await tripOf(id)).ideas).toHaveLength(1);
  });
});

describe("the itinerary belongs to the organiser", () => {
  it("the organiser can add a plan item", async () => {
    const { id, organiser } = await seed();

    const result = await applySharedMutation(repo, organiser, {
      mutation: {
        kind: "ADD_PLAN_ITEM",
        day: asIsoDate("2026-09-06"),
        title: "Dinner at Gwangjang",
        itemKind: "FOOD",
      },
      expectedVersion: await versionOf(id),
      now: NOW,
    });
    expect(result.ok).toBe(true);
    expect((await tripOf(id)).plan.map((item) => item.title)).toContain("Dinner at Gwangjang");
  });

  it("a traveller cannot, and is told what to do instead", async () => {
    const { id, zen } = await seed();

    const refused = await applySharedMutation(repo, zen, {
      mutation: { kind: "ADD_PLAN_ITEM", day: asIsoDate("2026-09-06"), title: "Mine", itemKind: "FOOD" },
      expectedVersion: await versionOf(id),
      now: NOW,
    });

    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.message).toMatch(/save it as an idea/i);
    expect((await tripOf(id)).plan).toHaveLength(0);
  });

  it("nothing can be marked booked, by anyone", async () => {
    const { id, organiser } = await seed();
    await applySharedMutation(repo, organiser, {
      mutation: { kind: "ADD_PLAN_ITEM", day: asIsoDate("2026-09-06"), title: "Flight", itemKind: "FLIGHT" },
      expectedVersion: await versionOf(id),
      now: NOW,
    });
    const itemId = (await tripOf(id)).plan[0]!.id;

    const refused = await applySharedMutation(repo, organiser, {
      mutation: { kind: "SET_PLAN_ITEM_STATUS", itemId, status: "BOOKED" },
      expectedVersion: await versionOf(id),
      now: NOW,
    });

    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.message).toMatch(/can't book anything/i);
    expect((await tripOf(id)).plan[0]?.status).not.toBe("BOOKED");
  });
});

describe("a private requirement never enters the shared payload", () => {
  it("is stored in owner-only storage and is absent from the trip", async () => {
    const { id, zen } = await seed();

    const result = await applySharedMutation(repo, zen, {
      mutation: {
        kind: "ADD_MY_REQUIREMENT",
        text: SENTINEL,
        strength: "PREFERRED",
        isPrivate: true,
      },
      expectedVersion: await versionOf(id),
      now: NOW,
    });
    expect(result.ok).toBe(true);

    // The group-visible payload, exactly as stored.
    const record = await repo.getTrip(id);
    expect(JSON.stringify(record?.payload)).not.toContain("650");

    // And it really is in owner-only storage.
    const own = await repo.getPrivateData(id, zen.memberId);
    expect(own?.requirements[0]?.text).toBe(SENTINEL);
  });

  it("bumps the version so the group learns the count changed", async () => {
    const { id, zen } = await seed();
    const before = await versionOf(id);

    await applySharedMutation(repo, zen, {
      mutation: { kind: "ADD_MY_REQUIREMENT", text: SENTINEL, strength: "PREFERRED", isPrivate: true },
      expectedVersion: before,
      now: NOW,
    });

    expect(await versionOf(id)).toBe(before + 1);
  });

  it("reaches its owner and nobody else, through the actor trip", async () => {
    const { id, organiser, zen, members } = await seed();

    await applySharedMutation(repo, zen, {
      mutation: { kind: "ADD_MY_REQUIREMENT", text: SENTINEL, strength: "PREFERRED", isPrivate: true },
      expectedVersion: await versionOf(id),
      now: NOW,
    });

    const payload = await tripOf(id);
    const counts = await repo.privateCounts(id);

    const forZen = buildActorTrip({
      payload,
      members,
      actorMemberId: zen.memberId,
      ownPrivate: (await repo.getPrivateData(id, zen.memberId))?.requirements ?? [],
      privateCounts: counts,
    });
    expect(JSON.stringify(forZen)).toContain("650");

    const forOrganiser = buildActorTrip({
      payload,
      members,
      actorMemberId: organiser.memberId,
      ownPrivate: (await repo.getPrivateData(id, organiser.memberId))?.requirements ?? [],
      privateCounts: counts,
    });
    expect(JSON.stringify(forOrganiser)).not.toContain("650");

    // The organiser still learns that a constraint exists.
    const zenAsSeen = forOrganiser.travellers.find((t) => t.id === "t-zen");
    expect(zenAsSeen?.hiddenPrivateCount).toBe(1);
  });

  it("a NON-private requirement does go into the shared payload", async () => {
    const { id, zen } = await seed();

    await applySharedMutation(repo, zen, {
      mutation: {
        kind: "ADD_MY_REQUIREMENT",
        text: "Step-free access",
        strength: "REQUIRED",
        isPrivate: false,
      },
      expectedVersion: await versionOf(id),
      now: NOW,
    });

    const trip = await tripOf(id);
    const zenTraveller = trip.travellers.find((t) => t.id === "t-zen");
    expect(zenTraveller?.requirements.map((r) => r.text)).toContain("Step-free access");
    expect(zenTraveller?.requirements[0]?.private).toBe(false);
  });
});

describe("speaking for yourself", () => {
  it("a self-mutation always lands on the actor, never on anybody else", async () => {
    const { id, zen } = await seed();

    await applySharedMutation(repo, zen, {
      mutation: { kind: "SET_MY_AVAILABILITY", from: asIsoDate("2026-09-07"), coming: true },
      expectedVersion: await versionOf(id),
      now: NOW,
    });

    const trip = await tripOf(id);
    expect(trip.travellers.find((t) => t.id === "t-zen")?.availableFrom).toBe("2026-09-07");
    // Lucas is untouched: the mutation names nobody, so it cannot reach him.
    expect(trip.travellers.find((t) => t.id === "t-lucas")?.availableFrom).toBeUndefined();
  });
});

describe("concurrency through the mutation path", () => {
  it("refuses a stale change and leaves the earlier one standing", async () => {
    const { id, organiser } = await seed();
    const v = await versionOf(id);

    const first = await applySharedMutation(repo, organiser, {
      mutation: { kind: "ADD_IDEA", title: "First", category: "FOOD" },
      expectedVersion: v,
      now: NOW,
    });
    expect(first.ok).toBe(true);

    const stale = await applySharedMutation(repo, organiser, {
      mutation: { kind: "ADD_IDEA", title: "Second", category: "FOOD" },
      expectedVersion: v,
      now: NOW,
    });

    expect(stale.ok).toBe(false);
    if (!stale.ok && stale.reason === "CONFLICT") {
      expect(stale.actualVersion).toBe(v + 1);
      expect(stale.message).toMatch(/refreshed/i);
    }

    const titles = (await tripOf(id)).ideas.map((idea) => idea.title);
    expect(titles).toContain("First");
    expect(titles).not.toContain("Second");
  });

  it("records an event for an accepted change and none for a refused one", async () => {
    const { id, organiser, zen } = await seed();

    await applySharedMutation(repo, organiser, {
      mutation: { kind: "ADD_IDEA", title: "Kept", category: "FOOD" },
      expectedVersion: await versionOf(id),
      now: NOW,
    });
    await applySharedMutation(repo, zen, {
      mutation: { kind: "ADD_PLAN_ITEM", day: asIsoDate("2026-09-06"), title: "Refused", itemKind: "FOOD" },
      expectedVersion: await versionOf(id),
      now: NOW,
    });

    const events = await repo.listEvents(id);
    const summaries = events.map((event) => event.summary).join(" | ");
    expect(summaries).toContain("Kept");
    expect(summaries).not.toContain("Refused");
  });

  it("never puts a private value in an event", async () => {
    const { id, zen } = await seed();

    await applySharedMutation(repo, zen, {
      mutation: { kind: "ADD_MY_REQUIREMENT", text: SENTINEL, strength: "PREFERRED", isPrivate: true },
      expectedVersion: await versionOf(id),
      now: NOW,
    });

    const events = await repo.listEvents(id);
    expect(JSON.stringify(events)).not.toContain("650");
    expect(events.map((e) => e.summary).join(" ")).toMatch(/something private/i);
  });
});
