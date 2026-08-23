import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { PostgresTripRepository } from "@/server/shared/postgresRepository";
import { closePool, query } from "@/server/shared/db";
import { resolveActor } from "@/server/shared/actor";
import { issueToken } from "@/server/shared/tokens";
import { buildMemberForActor, buildShareForActor } from "@/core/shared/views";
import type { TripActor, TripMember } from "@/domain/sharedTrip";
import { asIsoDateTime } from "@/domain/time";

/**
 * The PostgreSQL adapter, against a real PostgreSQL.
 *
 * REQUIRES A DATABASE AND FAILS WITHOUT ONE. Run with `npm run test:db`. It is
 * deliberately not part of `npm test` or `npm run verify`, both of which must
 * work on a clean checkout with nothing configured.
 *
 * It is also deliberately NOT skipped when `DATABASE_URL` is missing. The
 * Stage 2.5 browser-bundle checks were skipped in exactly that situation and
 * silently stopped protecting anything while still reporting green. If you ask
 * for the database tests, you get the database tests or you get a failure.
 *
 * WHAT THIS ADDS over the in-memory suite: proof that the SQL does what the
 * contract says -- particularly the two operations that are transactions
 * because they have to be. Everything about *authority* is already proven in
 * `sharedTrips.test.ts`; this is about whether the adapter behaves the same.
 *
 * CLEANS UP AFTER ITSELF. Every row it creates hangs off trips whose ids carry
 * a known prefix, deleted at the end. It never touches a row it did not make.
 */

const PREFIX = "itest-";
const NOW = asIsoDateTime("2026-08-23T10:00:00.000Z");
const WEEK = asIsoDateTime("2026-08-30T10:00:00.000Z");
const PAST = asIsoDateTime("2026-08-01T10:00:00.000Z");

const repo = new PostgresTripRepository();
const madeTrips: string[] = [];

function tripId(): string {
  const id = `${PREFIX}${randomUUID()}`;
  madeTrips.push(id);
  return id;
}

async function seedTrip() {
  const id = tripId();
  const created = await repo.createTrip({
    tripId: id,
    payload: { destination: "Seoul", note: "v1" },
    organiser: { travellerId: "t-lucas", name: "Lucas" },
    otherMembers: [
      { travellerId: "t-mum", name: "Mum" },
      { travellerId: "t-zen", name: "Zen" },
    ],
    now: NOW,
  });

  const members = await repo.listMembers(id);
  const by = (name: string): TripMember => members.find((m) => m.name === name)!;
  return { id, created, members, lucas: by("Lucas"), mum: by("Mum"), zen: by("Zen") };
}

beforeAll(() => {
  if (process.env.DATABASE_URL === undefined || process.env.DATABASE_URL.trim() === "") {
    throw new Error(
      "DATABASE_URL is not set. These tests exist to exercise a real database; " +
        "they fail rather than skip so a green run always means they ran.",
    );
  }
});

afterAll(async () => {
  // ON DELETE CASCADE removes members, invitations, private data and events.
  for (const id of madeTrips) {
    await query("DELETE FROM shared_trip WHERE id = $1", [id]).catch(() => undefined);
  }
  await query("DELETE FROM browser_session WHERE token_hash LIKE $1", [`${PREFIX}%`]).catch(
    () => undefined,
  );
  await closePool();
});

describe("schema", () => {
  it("has every table the migration creates", async () => {
    const rows = await query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = ANY($1)`,
      [
        [
          "shared_trip",
          "trip_member",
          "member_private_data",
          "trip_invitation",
          "browser_session",
          "session_membership",
          "trip_event",
        ],
      ],
    );
    expect(rows.map((row) => row.table_name).sort()).toEqual([
      "browser_session",
      "member_private_data",
      "session_membership",
      "shared_trip",
      "trip_event",
      "trip_invitation",
    ].concat("trip_member").sort());
  });
});

describe("trips and members", () => {
  it("creates a trip with an organiser who is already joined", async () => {
    const { id, lucas, mum } = await seedTrip();

    const trip = await repo.getTrip(id);
    expect(trip?.version).toBe(1);
    expect((trip?.payload as { destination: string }).destination).toBe("Seoul");

    // The organiser needed no invite; everybody else does.
    expect(lucas.role).toBe("ORGANISER");
    expect(lucas.joinedAt).toBeDefined();
    expect(mum.joinedAt).toBeUndefined();
  });

  it("returns the version on its own, for polling", async () => {
    const { id } = await seedTrip();
    expect(await repo.getTripVersion(id)).toBe(1);
    expect(await repo.getTripVersion(`${PREFIX}missing`)).toBeUndefined();
  });
});

describe("optimistic concurrency", () => {
  it("applies the first write and refuses the stale one", async () => {
    const { id } = await seedTrip();

    const first = await repo.writePayload({
      tripId: id,
      expectedVersion: 1,
      mutate: (current) => ({ ...(current as object), note: "from A" }),
      now: NOW,
    });
    expect(first.ok).toBe(true);

    const stale = await repo.writePayload({
      tripId: id,
      expectedVersion: 1,
      mutate: (current) => ({ ...(current as object), note: "from B" }),
      now: NOW,
    });

    expect(stale.ok).toBe(false);
    if (!stale.ok && stale.reason === "VERSION_CONFLICT") {
      expect(stale.actualVersion).toBe(2);
    }

    const trip = await repo.getTrip(id);
    expect((trip?.payload as { note: string }).note).toBe("from A");
    expect(trip?.version).toBe(2);
  });

  it("lets two concurrent writers produce exactly one winner", async () => {
    const { id } = await seedTrip();

    /**
     * The real race, not a simulated one. Both writes are issued before either
     * resolves, so the database is what decides -- which is the whole reason
     * the version lives in the WHERE clause.
     */
    const [a, b] = await Promise.all([
      repo.writePayload({
        tripId: id,
        expectedVersion: 1,
        mutate: () => ({ destination: "Seoul", winner: "A" }),
        now: NOW,
      }),
      repo.writePayload({
        tripId: id,
        expectedVersion: 1,
        mutate: () => ({ destination: "Seoul", winner: "B" }),
        now: NOW,
      }),
    ]);

    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    expect(await repo.getTripVersion(id)).toBe(2);
  });

  it("reports a missing trip rather than creating one", async () => {
    const result = await repo.writePayload({
      tripId: `${PREFIX}nope`,
      expectedVersion: 1,
      mutate: () => ({}),
      now: NOW,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("NOT_FOUND");
  });
});

describe("private data", () => {
  it("stores an owner's requirements and returns them only by member", async () => {
    const { id, mum } = await seedTrip();
    await repo.setPrivateData({
      tripId: id,
      memberId: mum.id,
      requirements: [{ id: "pr1", strength: "PREFERRED", text: "No more than 650 a person" }],
      updatedAt: NOW,
    });

    const hers = await repo.getPrivateData(id, mum.id);
    expect(hers?.requirements[0]?.text).toContain("650");
  });

  it("counts private requirements without the query being able to return one", async () => {
    const { id, mum, zen } = await seedTrip();
    await repo.setPrivateData({
      tripId: id,
      memberId: mum.id,
      requirements: [{ id: "pr1", strength: "PREFERRED", text: "No more than 650 a person" }],
      updatedAt: NOW,
    });

    const counts = await repo.privateCounts(id);
    expect(counts.get(mum.id)).toBe(1);
    expect(counts.get(zen.id)).toBeUndefined();
    // The value is not in the result at all, at any depth.
    expect(JSON.stringify([...counts.entries()])).not.toContain("650");
  });

  it("never gives the organiser the value through a view", async () => {
    const { id, mum, lucas } = await seedTrip();
    await repo.setPrivateData({
      tripId: id,
      memberId: mum.id,
      requirements: [{ id: "pr1", strength: "PREFERRED", text: "No more than 650 a person" }],
      updatedAt: NOW,
    });

    const organiser: TripActor = {
      tripId: id,
      memberId: lucas.id,
      role: "ORGANISER",
      sessionId: "s",
    };
    const view = buildMemberForActor(organiser, mum, await repo.getPrivateData(id, mum.id));

    expect(view.privateCount).toBe(1);
    expect(view.privateRequirements).toBeUndefined();
    expect(JSON.stringify(view)).not.toContain("650");
  });
});

describe("invitations", () => {
  it("redeems once and refuses the second attempt", async () => {
    const { id, zen } = await seedTrip();
    const token = issueToken();
    await repo.createInvitation({
      tripId: id,
      memberId: zen.id,
      tokenHash: token.hash,
      createdBy: "organiser",
      now: NOW,
      expiresAt: WEEK,
    });

    const s1 = await repo.createSession({
      tokenHash: `${PREFIX}${randomUUID()}`,
      now: NOW,
      expiresAt: WEEK,
    });
    const s2 = await repo.createSession({
      tokenHash: `${PREFIX}${randomUUID()}`,
      now: NOW,
      expiresAt: WEEK,
    });

    const first = await repo.redeemInvitation({
      tokenHash: token.hash,
      sessionId: s1.id,
      now: NOW,
    });
    const second = await repo.redeemInvitation({
      tokenHash: token.hash,
      sessionId: s2.id,
      now: NOW,
    });

    expect(first?.memberId).toBe(zen.id);
    expect(second).toBeUndefined();
    expect(await repo.membershipFor(s2.id, id)).toBeUndefined();

    const members = await repo.listMembers(id);
    expect(members.find((m) => m.id === zen.id)?.joinedAt).toBeDefined();
  });

  it("lets two simultaneous redemptions produce exactly one join", async () => {
    const { id, zen } = await seedTrip();
    const token = issueToken();
    await repo.createInvitation({
      tripId: id,
      memberId: zen.id,
      tokenHash: token.hash,
      createdBy: "o",
      now: NOW,
      expiresAt: WEEK,
    });

    const sessions = await Promise.all([
      repo.createSession({ tokenHash: `${PREFIX}${randomUUID()}`, now: NOW, expiresAt: WEEK }),
      repo.createSession({ tokenHash: `${PREFIX}${randomUUID()}`, now: NOW, expiresAt: WEEK }),
    ]);

    const results = await Promise.all(
      sessions.map((session) =>
        repo.redeemInvitation({ tokenHash: token.hash, sessionId: session.id, now: NOW }),
      ),
    );

    expect(results.filter((result) => result !== undefined)).toHaveLength(1);
  });

  it("refuses a revoked invitation", async () => {
    const { id, zen } = await seedTrip();
    const token = issueToken();
    const invite = await repo.createInvitation({
      tripId: id,
      memberId: zen.id,
      tokenHash: token.hash,
      createdBy: "o",
      now: NOW,
      expiresAt: WEEK,
    });
    await repo.revokeInvitation(invite.id, NOW);

    const session = await repo.createSession({
      tokenHash: `${PREFIX}${randomUUID()}`,
      now: NOW,
      expiresAt: WEEK,
    });
    expect(
      await repo.redeemInvitation({ tokenHash: token.hash, sessionId: session.id, now: NOW }),
    ).toBeUndefined();
  });

  it("refuses an expired invitation", async () => {
    const { id, zen } = await seedTrip();
    const token = issueToken();
    await repo.createInvitation({
      tripId: id,
      memberId: zen.id,
      tokenHash: token.hash,
      createdBy: "o",
      now: PAST,
      expiresAt: PAST,
    });

    const session = await repo.createSession({
      tokenHash: `${PREFIX}${randomUUID()}`,
      now: NOW,
      expiresAt: WEEK,
    });
    expect(
      await repo.redeemInvitation({ tokenHash: token.hash, sessionId: session.id, now: NOW }),
    ).toBeUndefined();
  });

  it("shows the organiser statuses and never a token", async () => {
    const { id, members, zen } = await seedTrip();
    const token = issueToken();
    await repo.createInvitation({
      tripId: id,
      memberId: zen.id,
      tokenHash: token.hash,
      createdBy: "o",
      now: NOW,
      expiresAt: WEEK,
    });

    const view = buildShareForActor(members, await repo.listInvitations(id), NOW);
    const serialised = JSON.stringify(view);
    expect(serialised).not.toContain(token.raw);
    expect(serialised).not.toContain(token.hash);
    expect(view.find((row) => row.name === "Zen")?.status).toBe("INVITE_READY");
  });
});

describe("sessions and access", () => {
  it("resolves a joined member and refuses a stranger the same way as a missing trip", async () => {
    const { id, zen } = await seedTrip();

    const sessionToken = issueToken();
    const session = await repo.createSession({
      tokenHash: sessionToken.hash,
      now: NOW,
      expiresAt: WEEK,
    });
    const invite = issueToken();
    await repo.createInvitation({
      tripId: id,
      memberId: zen.id,
      tokenHash: invite.hash,
      createdBy: "o",
      now: NOW,
      expiresAt: WEEK,
    });
    await repo.redeemInvitation({ tokenHash: invite.hash, sessionId: session.id, now: NOW });

    const mine = await resolveActor(repo, { sessionToken: sessionToken.raw, tripId: id, now: NOW });
    expect(mine.ok).toBe(true);
    if (mine.ok) expect(mine.actor.memberId).toBe(zen.id);

    const strangerToken = issueToken();
    await repo.createSession({ tokenHash: strangerToken.hash, now: NOW, expiresAt: WEEK });

    const refusedExisting = await resolveActor(repo, {
      sessionToken: strangerToken.raw,
      tripId: id,
      now: NOW,
    });
    const refusedMissing = await resolveActor(repo, {
      sessionToken: strangerToken.raw,
      tripId: `${PREFIX}missing`,
      now: NOW,
    });

    expect(refusedExisting.ok).toBe(false);
    expect(refusedMissing.ok).toBe(false);
    if (!refusedExisting.ok && !refusedMissing.ok) {
      // Identical, or trip ids become worth guessing.
      expect(refusedExisting.message).toBe(refusedMissing.message);
    }
  });

  it("refuses a member of one trip on another", async () => {
    const a = await seedTrip();
    const b = await seedTrip();

    const sessionToken = issueToken();
    const session = await repo.createSession({
      tokenHash: sessionToken.hash,
      now: NOW,
      expiresAt: WEEK,
    });
    const invite = issueToken();
    await repo.createInvitation({
      tripId: a.id,
      memberId: a.zen.id,
      tokenHash: invite.hash,
      createdBy: "o",
      now: NOW,
      expiresAt: WEEK,
    });
    await repo.redeemInvitation({ tokenHash: invite.hash, sessionId: session.id, now: NOW });

    const onOther = await resolveActor(repo, {
      sessionToken: sessionToken.raw,
      tripId: b.id,
      now: NOW,
    });
    expect(onOther.ok).toBe(false);
    if (!onOther.ok) expect(onOther.reason).toBe("NOT_A_MEMBER");
  });

  it("refuses a revoked session", async () => {
    const { id, zen } = await seedTrip();
    const sessionToken = issueToken();
    const session = await repo.createSession({
      tokenHash: sessionToken.hash,
      now: NOW,
      expiresAt: WEEK,
    });
    const invite = issueToken();
    await repo.createInvitation({
      tripId: id,
      memberId: zen.id,
      tokenHash: invite.hash,
      createdBy: "o",
      now: NOW,
      expiresAt: WEEK,
    });
    await repo.redeemInvitation({ tokenHash: invite.hash, sessionId: session.id, now: NOW });

    await repo.revokeSession(session.id, NOW);
    const result = await resolveActor(repo, { sessionToken: sessionToken.raw, tripId: id, now: NOW });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("SESSION_REVOKED");
  });
});

describe("events", () => {
  it("records what happened and never a private value", async () => {
    const { id, mum } = await seedTrip();
    await repo.appendEvent({
      tripId: id,
      at: NOW,
      summary: "Mum answered a private question",
      memberId: mum.id,
    });

    const events = await repo.listEvents(id);
    expect(events).toHaveLength(1);
    expect(JSON.stringify(events)).not.toContain("650");
  });

  it("attaches an event to an accepted write and not to a refused one", async () => {
    const { id } = await seedTrip();

    await repo.writePayload({
      tripId: id,
      expectedVersion: 1,
      mutate: () => ({ destination: "Seoul" }),
      event: { summary: "Lucas changed the plan" },
      now: NOW,
    });

    await repo.writePayload({
      tripId: id,
      expectedVersion: 1, // stale
      mutate: () => ({ destination: "Seoul" }),
      event: { summary: "should not be recorded" },
      now: NOW,
    });

    const events = await repo.listEvents(id);
    expect(events).toHaveLength(1);
    expect(events[0]?.summary).toBe("Lucas changed the plan");
  });
});
