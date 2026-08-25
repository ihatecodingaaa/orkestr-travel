import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { PostgresTripRepository } from "@/server/shared/postgresRepository";
import { closePool, query } from "@/server/shared/db";
import { applySharedMutation } from "@/server/shared/applyMutation";
import { parseTrip } from "@/core/trips/store";
import type { TripActor, TripMember } from "@/domain/sharedTrip";
import { asIsoDateTime } from "@/domain/time";

/**
 * Joining a trip that is already shared, against a real database.
 *
 * THE PROPERTY THIS FILE EXISTS FOR is that a person exists in two places at
 * once -- a `trip_member` row that owns their membership, and a traveller in the
 * payload the planner reads -- and that those two can never disagree. Every
 * other guarantee about a late joiner rests on it: a member with no traveller
 * resolves a session to somebody who is not on the trip, and a traveller with no
 * member is a person nobody can ever be.
 *
 * Requires a database and FAILS without one, for the reason given in
 * `postgresRepository.test.ts`.
 */

const PREFIX = "ltest-";
const NOW = asIsoDateTime("2026-08-25T10:00:00.000Z");

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
      destination: "Beijing",
      startDate: "2026-09-01",
      endDate: "2026-09-05",
      createdAt: NOW,
      updatedAt: NOW,
      declaredGroupSize: 3,
      travellers: [
        {
          id: "t-luc",
          name: "Luc",
          isOrganiser: true,
          comingConfirmed: true,
          availableFrom: "2026-09-01",
          availableTo: "2026-09-05",
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
    organiser: { travellerId: "t-luc", name: "Luc" },
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

  return { id, organiser: actor(by("Luc")), zen: actor(by("Zen")) };
}

const versionOf = async (id: string): Promise<number> => (await repo.getTripVersion(id)) ?? 0;

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

describe("adding somebody after the trip is already shared", () => {
  it("creates a traveller and a membership that point at each other", async () => {
    const { id, organiser } = await seed();

    const result = await applySharedMutation(repo, organiser, {
      mutation: { kind: "ADD_TRAVELLER", name: "Ryan" },
      expectedVersion: await versionOf(id),
      now: NOW,
    });
    expect(result.ok).toBe(true);

    const trip = await tripOf(id);
    const ryan = trip.travellers.find((one) => one.name === "Ryan");
    expect(ryan).toBeDefined();

    const members = await repo.listMembers(id);
    const membership = members.find((m) => m.name === "Ryan");
    expect(membership).toBeDefined();
    expect(membership?.travellerId).toBe(ryan?.id);
    expect(membership?.role).toBe("TRAVELLER");
    /* Not joined until they open an invite. Being added is not being present. */
    expect(membership?.joinedAt).toBeUndefined();
  });

  it("bumps the version exactly once", async () => {
    const { id, organiser } = await seed();
    const before = await versionOf(id);

    await applySharedMutation(repo, organiser, {
      mutation: { kind: "ADD_TRAVELLER", name: "Ryan" },
      expectedVersion: before,
      now: NOW,
    });

    expect(await versionOf(id)).toBe(before + 1);
  });

  it("adds them with no answers of their own", async () => {
    const { id, organiser } = await seed();
    await applySharedMutation(repo, organiser, {
      mutation: { kind: "ADD_TRAVELLER", name: "Ryan", note: "he can only join from Wednesday" },
      expectedVersion: await versionOf(id),
      now: NOW,
    });

    const ryan = (await tripOf(id)).travellers.find((one) => one.name === "Ryan");
    expect(ryan?.availableFrom).toBeUndefined();
    expect(ryan?.comingConfirmed).toBeUndefined();
  });

  /**
   * The organiser's guess survives the round trip AS A GUESS, attributed, with
   * a day read from the trip's own calendar. 2 Sep 2026 is the Wednesday.
   */
  it("keeps the organiser's note as an attributed draft", async () => {
    const { id, organiser } = await seed();
    await applySharedMutation(repo, organiser, {
      mutation: { kind: "ADD_TRAVELLER", name: "Ryan", note: "he can only join from Wednesday" },
      expectedVersion: await versionOf(id),
      now: NOW,
    });

    const ryan = (await tripOf(id)).travellers.find((one) => one.name === "Ryan");
    expect(ryan?.draft?.byName).toBe("Luc");
    expect(ryan?.draft?.note).toBe("he can only join from Wednesday");
    expect(ryan?.draft?.proposedFrom).toBe("2026-09-02");
  });

  it("refuses a name already on the trip", async () => {
    const { id, organiser } = await seed();
    const before = await versionOf(id);

    const result = await applySharedMutation(repo, organiser, {
      mutation: { kind: "ADD_TRAVELLER", name: "zen" },
      expectedVersion: before,
      now: NOW,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("REFUSED");
    expect(await versionOf(id)).toBe(before);
    expect((await repo.listMembers(id))).toHaveLength(2);
  });

  it("refuses a blank name", async () => {
    const { id, organiser } = await seed();
    const before = await versionOf(id);

    const result = await applySharedMutation(repo, organiser, {
      mutation: { kind: "ADD_TRAVELLER", name: "   " },
      expectedVersion: before,
      now: NOW,
    });

    expect(result.ok).toBe(false);
    expect(await versionOf(id)).toBe(before);
  });
});

describe("who may add somebody", () => {
  it("an ordinary traveller cannot, and is told who can", async () => {
    const { id, zen } = await seed();
    const before = await versionOf(id);

    const result = await applySharedMutation(repo, zen, {
      mutation: { kind: "ADD_TRAVELLER", name: "Ryan" },
      expectedVersion: before,
      now: NOW,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("REFUSED");
      expect(result.message).toMatch(/only the organiser/i);
    }
    expect(await versionOf(id)).toBe(before);
  });

  /** Refused before anything is written, so no orphan membership is left behind. */
  it("a refused traveller creates no membership row", async () => {
    const { id, zen } = await seed();
    await applySharedMutation(repo, zen, {
      mutation: { kind: "ADD_TRAVELLER", name: "Ryan" },
      expectedVersion: await versionOf(id),
      now: NOW,
    });

    const members = await repo.listMembers(id);
    expect(members.map((m) => m.name).sort()).toEqual(["Luc", "Zen"]);
  });

  it("an organiser of another trip cannot reach this one", async () => {
    const mine = await seed();
    const theirs = await seed();

    const result = await applySharedMutation(
      repo,
      { ...theirs.organiser, tripId: mine.id },
      {
        mutation: { kind: "ADD_TRAVELLER", name: "Ryan" },
        expectedVersion: await versionOf(mine.id),
        now: NOW,
      },
    );

    expect(result.ok).toBe(false);
    expect((await repo.listMembers(mine.id))).toHaveLength(2);
  });
});

describe("adding somebody from a version that has moved on", () => {
  /**
   * §22. The whole reason membership and payload share one transaction: a stale
   * addition must leave NEITHER behind, not a member row whose traveller was
   * never written.
   */
  it("is refused, and creates no traveller and no member", async () => {
    const { id, organiser } = await seed();
    const stale = await versionOf(id);

    /* Somebody else moves the trip on. */
    await applySharedMutation(repo, organiser, {
      mutation: { kind: "ADD_IDEA", title: "Temple of Heaven", category: "CULTURE" },
      expectedVersion: stale,
      now: NOW,
    });

    const result = await applySharedMutation(repo, organiser, {
      mutation: { kind: "ADD_TRAVELLER", name: "Ryan" },
      expectedVersion: stale,
      now: NOW,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("CONFLICT");

    const trip = await tripOf(id);
    expect(trip.travellers.some((one) => one.name === "Ryan")).toBe(false);
    expect((await repo.listMembers(id)).some((m) => m.name === "Ryan")).toBe(false);
  });

  it("succeeds once the caller catches up", async () => {
    const { id, organiser } = await seed();
    const stale = await versionOf(id);
    await applySharedMutation(repo, organiser, {
      mutation: { kind: "ADD_IDEA", title: "Qianmen", category: "FOOD" },
      expectedVersion: stale,
      now: NOW,
    });

    const result = await applySharedMutation(repo, organiser, {
      mutation: { kind: "ADD_TRAVELLER", name: "Ryan" },
      expectedVersion: await versionOf(id),
      now: NOW,
    });

    expect(result.ok).toBe(true);
    expect((await repo.listMembers(id)).some((m) => m.name === "Ryan")).toBe(true);
  });
});

describe("the person a note was written about answering it", () => {
  /**
   * Applied to whoever the session resolved to. The mutation carries no target,
   * so it is structurally incapable of reaching anybody else's record.
   */
  it("confirming turns the note into their own answer", async () => {
    const { id, organiser } = await seed();
    await applySharedMutation(repo, organiser, {
      mutation: { kind: "ADD_TRAVELLER", name: "Ryan", note: "arriving Wednesday" },
      expectedVersion: await versionOf(id),
      now: NOW,
    });

    const ryanMember = (await repo.listMembers(id)).find((m) => m.name === "Ryan")!;
    const ryanActor: TripActor = {
      tripId: id,
      memberId: ryanMember.id,
      role: "TRAVELLER",
      sessionId: "s-Ryan",
    };

    const result = await applySharedMutation(repo, ryanActor, {
      mutation: { kind: "CONFIRM_MY_DRAFT" },
      expectedVersion: await versionOf(id),
      now: NOW,
    });
    expect(result.ok).toBe(true);

    const ryan = (await tripOf(id)).travellers.find((one) => one.name === "Ryan");
    expect(ryan?.availableFrom).toBe("2026-09-02");
    expect(ryan?.comingConfirmed).toBe(true);
    expect(ryan?.draft).toBeUndefined();
  });

  it("the organiser confirming their own draft does not touch Ryan's", async () => {
    const { id, organiser } = await seed();
    await applySharedMutation(repo, organiser, {
      mutation: { kind: "ADD_TRAVELLER", name: "Ryan", note: "arriving Wednesday" },
      expectedVersion: await versionOf(id),
      now: NOW,
    });

    await applySharedMutation(repo, organiser, {
      mutation: { kind: "CONFIRM_MY_DRAFT" },
      expectedVersion: await versionOf(id),
      now: NOW,
    });

    const ryan = (await tripOf(id)).travellers.find((one) => one.name === "Ryan");
    expect(ryan?.draft?.proposedFrom).toBe("2026-09-02");
    expect(ryan?.comingConfirmed).toBeUndefined();
  });

  it("dismissing leaves them unanswered rather than not coming", async () => {
    const { id, organiser } = await seed();
    await applySharedMutation(repo, organiser, {
      mutation: { kind: "ADD_TRAVELLER", name: "Ryan", note: "arriving Wednesday" },
      expectedVersion: await versionOf(id),
      now: NOW,
    });

    const ryanMember = (await repo.listMembers(id)).find((m) => m.name === "Ryan")!;
    await applySharedMutation(
      repo,
      { tripId: id, memberId: ryanMember.id, role: "TRAVELLER", sessionId: "s-Ryan" },
      { mutation: { kind: "DISMISS_MY_DRAFT" }, expectedVersion: await versionOf(id), now: NOW },
    );

    const ryan = (await tripOf(id)).travellers.find((one) => one.name === "Ryan");
    expect(ryan?.draft).toBeUndefined();
    expect(ryan?.comingConfirmed).toBeUndefined();
  });
});

describe("what the activity feed is told", () => {
  it("records the name, and never the organiser's note about them", async () => {
    const { id, organiser } = await seed();
    await applySharedMutation(repo, organiser, {
      mutation: {
        kind: "ADD_TRAVELLER",
        name: "Ryan",
        note: "he can only join from Wednesday",
      },
      expectedVersion: await versionOf(id),
      now: NOW,
    });

    const events = await repo.listEvents(id);
    const summaries = events.map((event) => event.summary).join(" | ");
    expect(summaries).toMatch(/Luc added Ryan to the trip/);
    expect(summaries).not.toMatch(/Wednesday/);
  });
});
