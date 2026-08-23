import { describe, it, expect, beforeEach } from "vitest";
import {
  MemoryTripRepository,
  resetMemoryIds,
} from "@/server/shared/memoryRepository";
import { resolveActor, tripsForSession } from "@/server/shared/actor";
import { hashToken, issueToken, redactToken, hashesEqual } from "@/server/shared/tokens";
import {
  can,
  canAcceptCompromiseFor,
  canAnswerFor,
  canEditMember,
  canReadPrivate,
  canRedeem,
  inviteState,
  unknownInvite,
} from "@/core/shared/authority";
import {
  buildGroupForActor,
  buildInboxForActor,
  buildMemberForActor,
  buildMoneyForActor,
  buildShareForActor,
  type PendingQuestion,
} from "@/core/shared/views";
import {
  CONFLICT_MESSAGE,
  DEFAULT_SYNC,
  nextPollDelay,
  shouldRefetch,
  versionMatches,
} from "@/core/shared/concurrency";
import { planMigration, privateCounts, stripPrivateForSharing } from "@/core/shared/migration";
import {
  sessionCookieOptions,
  clearedCookieOptions,
  isLocalhostOrigin,
  SESSION_TTL_SECONDS,
} from "@/server/shared/sessionCookie";
import type { TripActor, TripInvitation, TripMember } from "@/domain/sharedTrip";
import { asIsoDateTime } from "@/domain/time";
import { exampleTrip } from "@/ui/trip/exampleTrip";
import { isSafeUrl, safeUrl } from "@/core/trips/safeUrl";
import { addIdea } from "@/core/trips/mutate";

/**
 * Shared trips: who is who, and who may see what.
 *
 * THE FOUR ACTORS ARE THE POINT. Almost every rule in Stage 3 is only
 * meaningful in the presence of somebody it should NOT apply to, so the suite
 * carries an organiser, two travellers and a complete stranger, and asks each
 * question from all four sides.
 *
 * These run against the in-memory store, which implements the same contract as
 * the Postgres one. That is deliberate: the questions here -- can the organiser
 * read Mum's budget, can Zen answer Mum's question, is a stale write refused --
 * are not questions about SQL, and they should run on every commit in
 * milliseconds without a database.
 */

const NOW = asIsoDateTime("2026-08-23T10:00:00.000Z");
const LATER = asIsoDateTime("2026-08-24T10:00:00.000Z");
const WEEK = asIsoDateTime("2026-08-30T10:00:00.000Z");

let repo: MemoryTripRepository;

beforeEach(() => {
  resetMemoryIds();
  repo = new MemoryTripRepository();
});

/** Organiser Lucas, travellers Mum and Zen. */
async function seed() {
  const created = await repo.createTrip({
    tripId: "trip-seoul",
    payload: { destination: "Seoul" },
    organiser: { travellerId: "t-lucas", name: "Lucas" },
    otherMembers: [
      { travellerId: "t-mum", name: "Mum" },
      { travellerId: "t-zen", name: "Zen" },
    ],
    now: NOW,
  });

  const members = await repo.listMembers("trip-seoul");
  const byName = (name: string): TripMember =>
    members.find((member) => member.name === name)!;

  const lucas = byName("Lucas");
  const mum = byName("Mum");
  const zen = byName("Zen");

  // Mum has a private ceiling. The sentinel value must never leave her.
  await repo.setPrivateData({
    tripId: "trip-seoul",
    memberId: mum.id,
    requirements: [{ id: "pr1", strength: "PREFERRED", text: "No more than 650 a person" }],
    updatedAt: NOW,
  });

  const actor = (member: TripMember): TripActor => ({
    tripId: "trip-seoul",
    memberId: member.id,
    role: member.role,
    sessionId: `ses-${member.name}`,
  });

  return {
    created,
    lucas,
    mum,
    zen,
    organiser: actor(lucas),
    mumActor: actor(mum),
    zenActor: actor(zen),
    members,
  };
}

/* -------------------------------------------------------------------------- */

describe("invite tokens", () => {
  it("issues 256 bits of randomness and stores only a hash", () => {
    const a = issueToken();
    const b = issueToken();

    expect(a.raw).not.toBe(b.raw);
    // base64url of 32 bytes is 43 characters with no padding.
    expect(a.raw).toHaveLength(43);
    expect(a.raw).toMatch(/^[A-Za-z0-9_-]+$/);

    // The stored value must not be the token, and must be derivable from it.
    expect(a.hash).not.toBe(a.raw);
    expect(a.hash).toBe(hashToken(a.raw));
    expect(a.hash).toHaveLength(64);
  });

  it("compares hashes without leaking length or content", () => {
    const { raw, hash } = issueToken();
    expect(hashesEqual(hash, hashToken(raw))).toBe(true);
    expect(hashesEqual(hash, hashToken("something else"))).toBe(false);
    expect(hashesEqual(hash, "short")).toBe(false);
  });

  it("redacts a token so it can never be logged whole", () => {
    const { raw } = issueToken();
    const redacted = redactToken(raw);
    expect(redacted).not.toContain(raw);
    expect(redacted.length).toBeLessThan(raw.length);
  });
});

/* -------------------------------------------------------------------------- */

describe("actor resolution", () => {
  it("refuses a request with no session", async () => {
    const result = await resolveActor(repo, {
      sessionToken: undefined,
      tripId: "trip-seoul",
      now: NOW,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("NO_SESSION");
  });

  it("gives a stranger with a valid session the same answer as no session", async () => {
    await seed();
    const token = issueToken();
    await repo.createSession({ tokenHash: token.hash, now: NOW, expiresAt: WEEK });

    const result = await resolveActor(repo, {
      sessionToken: token.raw,
      tripId: "trip-seoul",
      now: NOW,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("NOT_A_MEMBER");
      // A trip that exists and one that does not must be indistinguishable,
      // or trip ids become worth guessing.
      const missing = await resolveActor(repo, {
        sessionToken: token.raw,
        tripId: "trip-does-not-exist",
        now: NOW,
      });
      expect(missing.ok).toBe(false);
      if (!missing.ok) expect(missing.message).toBe(result.message);
    }
  });

  it("resolves a member from their session, never from client input", async () => {
    const { zen } = await seed();
    const session = issueToken();
    const created = await repo.createSession({
      tokenHash: session.hash,
      now: NOW,
      expiresAt: WEEK,
    });

    const invite = issueToken();
    await repo.createInvitation({
      tripId: "trip-seoul",
      memberId: zen.id,
      tokenHash: invite.hash,
      createdBy: "organiser",
      now: NOW,
      expiresAt: WEEK,
    });
    await repo.redeemInvitation({
      tokenHash: invite.hash,
      sessionId: created.id,
      now: NOW,
    });

    const result = await resolveActor(repo, {
      sessionToken: session.raw,
      tripId: "trip-seoul",
      now: LATER,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.actor.memberId).toBe(zen.id);
      expect(result.actor.role).toBe("TRAVELLER");
    }
  });

  it("refuses an expired session and a revoked one, with different words", async () => {
    const { zen } = await seed();
    const session = issueToken();
    const created = await repo.createSession({
      tokenHash: session.hash,
      now: NOW,
      expiresAt: LATER,
    });
    const invite = issueToken();
    await repo.createInvitation({
      tripId: "trip-seoul",
      memberId: zen.id,
      tokenHash: invite.hash,
      createdBy: "o",
      now: NOW,
      expiresAt: WEEK,
    });
    await repo.redeemInvitation({ tokenHash: invite.hash, sessionId: created.id, now: NOW });

    const expired = await resolveActor(repo, {
      sessionToken: session.raw,
      tripId: "trip-seoul",
      now: WEEK,
    });
    expect(expired.ok).toBe(false);
    if (!expired.ok) expect(expired.reason).toBe("SESSION_EXPIRED");

    await repo.revokeSession(created.id, NOW);
    const revoked = await resolveActor(repo, {
      sessionToken: session.raw,
      tripId: "trip-seoul",
      now: NOW,
    });
    expect(revoked.ok).toBe(false);
    if (!revoked.ok) expect(revoked.reason).toBe("SESSION_REVOKED");
  });

  it("lets one browser hold memberships in several trips", async () => {
    const { zen } = await seed();
    await repo.createTrip({
      tripId: "trip-bali",
      payload: { destination: "Bali" },
      organiser: { travellerId: "t-zen", name: "Zen" },
      otherMembers: [],
      now: NOW,
    });

    const session = issueToken();
    const created = await repo.createSession({
      tokenHash: session.hash,
      now: NOW,
      expiresAt: WEEK,
    });

    const invite = issueToken();
    await repo.createInvitation({
      tripId: "trip-seoul",
      memberId: zen.id,
      tokenHash: invite.hash,
      createdBy: "o",
      now: NOW,
      expiresAt: WEEK,
    });
    await repo.redeemInvitation({ tokenHash: invite.hash, sessionId: created.id, now: NOW });

    const trips = await tripsForSession(repo, { sessionToken: session.raw, now: NOW });
    expect(trips.map((entry) => entry.tripId)).toEqual(["trip-seoul"]);

    // And a stranger's session sees nothing at all.
    expect(await tripsForSession(repo, { sessionToken: "nonsense", now: NOW })).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */

describe("privacy: what each actor receives", () => {
  it("gives Mum her own private requirement in full", async () => {
    const { mum, mumActor } = await seed();
    const data = await repo.getPrivateData("trip-seoul", mum.id);
    const view = buildMemberForActor(mumActor, mum, data);

    expect(view.privateRequirements?.[0]?.text).toContain("650");
    expect(view.privateCount).toBe(1);
    expect(view.isYou).toBe(true);
  });

  it("does NOT give the organiser Mum's private value — only that it exists", async () => {
    const { mum, organiser } = await seed();
    const data = await repo.getPrivateData("trip-seoul", mum.id);
    const view = buildMemberForActor(organiser, mum, data);

    expect(view.privateRequirements).toBeUndefined();
    expect(view.privateCount).toBe(1);
    expect(JSON.stringify(view)).not.toContain("650");
  });

  it("does NOT give another traveller Mum's private value", async () => {
    const { mum, zenActor } = await seed();
    const data = await repo.getPrivateData("trip-seoul", mum.id);
    const view = buildMemberForActor(zenActor, mum, data);

    expect(view.privateRequirements).toBeUndefined();
    expect(JSON.stringify(view)).not.toContain("650");
  });

  it("keeps the sentinel out of the whole serialised group view for everyone but its owner", async () => {
    const { members, organiser, mumActor, zenActor, mum } = await seed();
    const privates = new Map([
      [mum.id, (await repo.getPrivateData("trip-seoul", mum.id))!],
    ]);

    for (const actor of [organiser, zenActor]) {
      const group = buildGroupForActor(actor, members, privates);
      expect(JSON.stringify(group), `${actor.memberId} received the private value`).not.toContain(
        "650",
      );
    }

    const hers = buildGroupForActor(mumActor, members, privates);
    expect(JSON.stringify(hers)).toContain("650");
  });

  it("counts private money holders without revealing any amount", async () => {
    const { organiser, mumActor, mum } = await seed();
    const privates = new Map([
      [mum.id, (await repo.getPrivateData("trip-seoul", mum.id))!],
    ]);

    const forOrganiser = buildMoneyForActor(organiser, privates);
    expect(forOrganiser.privateHolders).toBe(1);
    expect(forOrganiser.yourPrivate).toEqual([]);
    expect(JSON.stringify(forOrganiser)).not.toContain("650");

    const forMum = buildMoneyForActor(mumActor, privates);
    expect(forMum.yourPrivate[0]?.text).toContain("650");
  });
});

/* -------------------------------------------------------------------------- */

describe("authority", () => {
  it("lets the organiser run the trip but not become other people", async () => {
    const { organiser, mum } = await seed();

    expect(can(organiser, "EDIT_TRIP")).toBe(true);
    expect(can(organiser, "MANAGE_INVITES")).toBe(true);
    expect(can(organiser, "EDIT_PLAN")).toBe(true);

    // The rules that do not bend for a role.
    expect(canEditMember(organiser, mum.id)).toBe(false);
    expect(canAnswerFor(organiser, mum.id)).toBe(false);
    expect(canReadPrivate(organiser, mum.id)).toBe(false);
    expect(canAcceptCompromiseFor(organiser, mum.id)).toBe(false);
  });

  it("lets a traveller contribute but not run the trip", async () => {
    const { zenActor, mum, zen } = await seed();

    expect(can(zenActor, "CONTRIBUTE_IDEAS")).toBe(true);
    expect(can(zenActor, "EDIT_PLAN")).toBe(false);
    expect(can(zenActor, "MANAGE_INVITES")).toBe(false);
    expect(can(zenActor, "ADD_MEMBER")).toBe(false);
    expect(can(zenActor, "APPLY_GROUP_CHANGE")).toBe(false);

    expect(canEditMember(zenActor, zen.id)).toBe(true);
    expect(canEditMember(zenActor, mum.id)).toBe(false);
    expect(canAnswerFor(zenActor, mum.id)).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */

describe("invite lifecycle", () => {
  const invite = (over: Partial<TripInvitation> = {}): TripInvitation => ({
    id: "inv1",
    tripId: "trip-seoul",
    memberId: "mem1",
    tokenHash: "hash",
    createdAt: NOW,
    expiresAt: WEEK,
    ...over,
  });

  it("is ready, then used, and cannot be used twice", () => {
    expect(inviteState(invite(), NOW)).toBe("READY");
    expect(canRedeem(invite(), NOW).ok).toBe(true);

    const used = invite({ redeemedAt: LATER });
    expect(inviteState(used, LATER)).toBe("REDEEMED");
    const refusal = canRedeem(used, LATER);
    expect(refusal.ok).toBe(false);
    if (!refusal.ok) expect(refusal.message).toMatch(/already been used/i);
  });

  it("treats revoked as dead regardless of anything else", () => {
    const revokedAndUsed = invite({ revokedAt: LATER, redeemedAt: LATER });
    expect(inviteState(revokedAndUsed, LATER)).toBe("REVOKED");
  });

  it("expires", () => {
    expect(inviteState(invite({ expiresAt: NOW }), LATER)).toBe("EXPIRED");
    const refusal = canRedeem(invite({ expiresAt: NOW }), LATER);
    expect(refusal.ok).toBe(false);
    if (!refusal.ok) expect(refusal.message).toMatch(/expired/i);
  });

  it("says the same thing for an unknown token as for a revoked one", () => {
    const revoked = canRedeem(invite({ revokedAt: LATER }), LATER);
    expect(revoked.ok).toBe(false);
    if (!revoked.ok) {
      // Otherwise the difference tells somebody trying tokens which ones existed.
      expect(unknownInvite().message).toBe(revoked.message);
    }
  });

  it("refuses a second redemption at the store, not just in the rules", async () => {
    const { zen } = await seed();
    const token = issueToken();
    await repo.createInvitation({
      tripId: "trip-seoul",
      memberId: zen.id,
      tokenHash: token.hash,
      createdBy: "o",
      now: NOW,
      expiresAt: WEEK,
    });

    const s1 = await repo.createSession({ tokenHash: "h1", now: NOW, expiresAt: WEEK });
    const s2 = await repo.createSession({ tokenHash: "h2", now: NOW, expiresAt: WEEK });

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

    // And the second browser got nothing.
    expect(await repo.membershipFor(s2.id, "trip-seoul")).toBeUndefined();
  });

  it("refuses a revoked invitation at the store", async () => {
    const { zen } = await seed();
    const token = issueToken();
    const created = await repo.createInvitation({
      tripId: "trip-seoul",
      memberId: zen.id,
      tokenHash: token.hash,
      createdBy: "o",
      now: NOW,
      expiresAt: WEEK,
    });
    await repo.revokeInvitation(created.id, NOW);

    const session = await repo.createSession({ tokenHash: "h", now: NOW, expiresAt: WEEK });
    expect(
      await repo.redeemInvitation({ tokenHash: token.hash, sessionId: session.id, now: NOW }),
    ).toBeUndefined();
  });

  it("shows the organiser each member's invite status and never a token", async () => {
    const { members, zen } = await seed();
    const token = issueToken();
    await repo.createInvitation({
      tripId: "trip-seoul",
      memberId: zen.id,
      tokenHash: token.hash,
      createdBy: "o",
      now: NOW,
      expiresAt: WEEK,
    });

    const view = buildShareForActor(members, await repo.listInvitations("trip-seoul"), NOW);
    const serialised = JSON.stringify(view);

    expect(view.find((row) => row.name === "Lucas")?.status).toBe("JOINED");
    expect(view.find((row) => row.name === "Zen")?.status).toBe("INVITE_READY");
    expect(view.find((row) => row.name === "Mum")?.status).toBe("NOT_INVITED");

    expect(serialised).not.toContain(token.raw);
    expect(serialised).not.toContain(token.hash);
  });
});

/* -------------------------------------------------------------------------- */

describe("the inbox belongs to a person", () => {
  const questions = (mumId: string, zenId: string): readonly PendingQuestion[] => [
    {
      id: "q-zen-dates",
      ownerMemberId: zenId,
      question: "When can you travel?",
      why: "It decides whether the group needs a second flight.",
      isPrivate: false,
    },
    {
      id: "q-mum-budget",
      ownerMemberId: mumId,
      question: "This option is 42 above your limit of 650. Is that okay?",
      why: "Only you can decide this.",
      isPrivate: true,
    },
  ];

  it("marks a person's own questions as theirs to answer", async () => {
    const { zenActor, mum, zen } = await seed();
    const inbox = buildInboxForActor(zenActor, questions(mum.id, zen.id), await repo.listMembers("trip-seoul"));

    const own = inbox.find((item) => item.id === "q-zen-dates");
    expect(own?.ownership).toBe("YOURS");
    expect(own?.question).toBe("When can you travel?");
  });

  it("never shows a private question's text to anybody but its owner", async () => {
    const { organiser, zenActor, mumActor, mum, zen } = await seed();
    const members = await repo.listMembers("trip-seoul");
    const pending = questions(mum.id, zen.id);

    for (const actor of [organiser, zenActor]) {
      const inbox = buildInboxForActor(actor, pending, members);
      const item = inbox.find((entry) => entry.id === "q-mum-budget")!;

      expect(item.ownership).toBe("THEIRS");
      // The QUESTION itself gives the value away, so it is replaced entirely.
      expect(item.question).toBe("Mum has a private question to answer");
      expect(JSON.stringify(inbox)).not.toContain("650");
    }

    const hers = buildInboxForActor(mumActor, pending, members);
    expect(hers.find((entry) => entry.id === "q-mum-budget")?.question).toContain("650");
  });

  it("says plainly that you cannot answer for somebody else", async () => {
    const { organiser, mum, zen } = await seed();
    const inbox = buildInboxForActor(
      organiser,
      questions(mum.id, zen.id),
      await repo.listMembers("trip-seoul"),
    );
    const theirs = inbox.filter((item) => item.ownership === "THEIRS");
    expect(theirs).toHaveLength(2);
  });
});

/* -------------------------------------------------------------------------- */

describe("concurrency", () => {
  it("refuses a stale write instead of overwriting", async () => {
    await seed();

    const first = await repo.writePayload({
      tripId: "trip-seoul",
      expectedVersion: 1,
      mutate: () => ({ destination: "Seoul", note: "from A" }),
      now: LATER,
    });
    expect(first.ok).toBe(true);

    // B still believes it is editing version 1.
    const stale = await repo.writePayload({
      tripId: "trip-seoul",
      expectedVersion: 1,
      mutate: () => ({ destination: "Seoul", note: "from B" }),
      now: LATER,
    });

    expect(stale.ok).toBe(false);
    if (!stale.ok && stale.reason === "VERSION_CONFLICT") {
      expect(stale.actualVersion).toBe(2);
    }

    // A's write survived; B's did not silently replace it.
    const trip = await repo.getTrip("trip-seoul");
    expect((trip?.payload as { note: string }).note).toBe("from A");
  });

  it("treats a version from the future as a conflict too", () => {
    expect(versionMatches(3, 3)).toBe(true);
    expect(versionMatches(4, 3)).toBe(false);
    expect(versionMatches(2, 3)).toBe(false);
  });

  it("explains a conflict without blaming the person", () => {
    expect(CONFLICT_MESSAGE).toMatch(/refreshed/i);
    expect(CONFLICT_MESSAGE).not.toMatch(/error|invalid|failed/i);
  });

  it("only refetches when the server version actually moved", () => {
    expect(shouldRefetch(5, 5)).toBe(false);
    expect(shouldRefetch(5, 6)).toBe(true);
    expect(shouldRefetch(5, 4)).toBe(false);
  });

  it("stops polling when nobody is looking", () => {
    expect(nextPollDelay(DEFAULT_SYNC, false)).toBe(DEFAULT_SYNC.visibleIntervalMs);
    expect(nextPollDelay(DEFAULT_SYNC, true)).toBeUndefined();
  });
});

/* -------------------------------------------------------------------------- */

describe("session cookie", () => {
  it("is HttpOnly, Lax and Secure in production", () => {
    const options = sessionCookieOptions({ isProduction: true, isLocalhost: false });
    expect(options.httpOnly).toBe(true);
    expect(options.sameSite).toBe("lax");
    expect(options.secure).toBe(true);
    expect(options.maxAge).toBe(SESSION_TTL_SECONDS);
    expect(options.maxAge).toBeGreaterThan(0);
  });

  it("stays Secure in production even when the origin looks like localhost", () => {
    // There is no configuration path that produces an insecure production cookie.
    const options = sessionCookieOptions({ isProduction: true, isLocalhost: true });
    expect(options.secure).toBe(true);
  });

  it("allows an insecure cookie only on plain-http localhost in development", () => {
    expect(sessionCookieOptions({ isProduction: false, isLocalhost: true }).secure).toBe(false);
    expect(sessionCookieOptions({ isProduction: false, isLocalhost: false }).secure).toBe(true);
  });

  it("clears with the same flags and no lifetime", () => {
    const cleared = clearedCookieOptions({ isProduction: true, isLocalhost: false });
    expect(cleared.httpOnly).toBe(true);
    expect(cleared.secure).toBe(true);
    expect(cleared.maxAge).toBe(0);
  });

  it("recognises only genuine plain-http localhost origins", () => {
    expect(isLocalhostOrigin("http://localhost:3000")).toBe(true);
    expect(isLocalhostOrigin("http://127.0.0.1:3000")).toBe(true);
    expect(isLocalhostOrigin("https://localhost:3000")).toBe(false);
    expect(isLocalhostOrigin("http://localhost.evil.com")).toBe(false);
    expect(isLocalhostOrigin(undefined)).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */

describe("local to shared migration", () => {
  it("keeps the organiser's own answers and downgrades everyone else's to drafts", () => {
    const trip = exampleTrip();
    const organiserId = trip.travellers[0]!.id;
    const plan = planMigration(trip, organiserId);

    const organiser = plan.members.find((member) => member.travellerId === organiserId)!;
    expect(organiser.role).toBe("ORGANISER");
    expect(organiser.authority).toBe("CONFIRMED_BY_OWNER");

    for (const member of plan.members.filter((m) => m.travellerId !== organiserId)) {
      // The organiser typed these on their behalf; that is not an answer.
      expect(member.authority).toBe("ORGANISER_DRAFT");
    }
  });

  it("warns the organiser before anything moves", () => {
    const trip = exampleTrip();
    const plan = planMigration(trip, trip.travellers[0]!.id);
    expect(plan.warnings.join(" ")).toMatch(/until they confirm/i);
    expect(plan.warnings.join(" ")).toMatch(/backup/i);
  });

  it("removes every private requirement from the payload that goes to the group", () => {
    const trip = exampleTrip();
    const before = privateCounts(trip);
    expect([...before.values()].reduce((a, b) => a + b, 0)).toBeGreaterThan(0);

    const shared = stripPrivateForSharing(trip);

    for (const traveller of shared.travellers) {
      expect(traveller.requirements.every((requirement) => !requirement.private)).toBe(true);
    }
    // The sentinel from the Tokyo example must not survive into the shared payload.
    expect(JSON.stringify(shared)).not.toContain("650");
  });

  it("keeps the existence of a private requirement so the group is not confused", () => {
    const trip = exampleTrip();
    const counts = privateCounts(trip);
    expect(counts.size).toBeGreaterThan(0);
    for (const count of counts.values()) expect(count).toBeGreaterThan(0);
  });

  it("moves private details the organiser entered for someone else without exposing them", () => {
    const trip = exampleTrip();
    const organiserId = trip.travellers[0]!.id;
    const plan = planMigration(trip, organiserId);

    const forOthers = plan.members.filter((member) => member.privateEnteredByOrganiser);
    if (forOthers.length > 0) {
      expect(plan.warnings.join(" ")).toMatch(/move to their own private area/i);
      // They are carried so the owner still has them -- as that owner's data.
      for (const member of forOthers) {
        expect(member.privateRequirements.length).toBeGreaterThan(0);
        expect(member.authority).toBe("ORGANISER_DRAFT");
      }
    }
  });
});

/* -------------------------------------------------------------------------- */

describe("pasted links", () => {
  it("refuses every scheme that can execute", () => {
    for (const dangerous of [
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      "  javascript:alert(1)  ",
      "data:text/html,<script>alert(1)</script>",
      "vbscript:msgbox(1)",
      "blob:https://example.com/abc",
      "file:///etc/passwd",
    ]) {
      expect(safeUrl(dangerous), `${dangerous} was accepted`).toBeUndefined();
      expect(isSafeUrl(dangerous)).toBe(false);
    }
  });

  it("keeps ordinary links, and assumes https for a bare host", () => {
    expect(safeUrl("https://example.com/a")).toBe("https://example.com/a");
    expect(safeUrl("http://example.com/a")).toBe("http://example.com/a");
    // People paste "gwangjang.market" and mean a website.
    expect(safeUrl("gwangjang.market")).toBe("https://gwangjang.market/");
  });

  it("drops nonsense rather than storing it", () => {
    expect(safeUrl(undefined)).toBeUndefined();
    expect(safeUrl("   ")).toBeUndefined();
    // No host at all. (`http:///nohost` is NOT this case -- the URL parser
    // normalises it to host "nohost", which is a real, safe http URL.)
    expect(safeUrl("https://")).toBeUndefined();
    expect(safeUrl("http://")).toBeUndefined();
  });

  it("never stores a dangerous link on an idea", () => {
    const trip = exampleTrip();
    const ctx = { now: NOW, newId: () => "idea-probe" };
    const next = addIdea(
      trip,
      { title: "Somewhere", category: "FOOD", url: "javascript:alert(1)" },
      ctx,
    );

    const idea = next.ideas.find((candidate) => candidate.id === "idea-probe")!;
    expect(idea.url).toBeUndefined();
    // Without a usable link it is not a link idea, and must not claim to be.
    expect(idea.source).toBe("USER_ADDED");
    expect(JSON.stringify(next)).not.toContain("javascript:");
  });
});

/* -------------------------------------------------------------------------- */

describe("cross-trip isolation", () => {
  it("does not let a member of one trip touch another", async () => {
    const { zen } = await seed();
    await repo.createTrip({
      tripId: "trip-other",
      payload: { destination: "Bali" },
      organiser: { travellerId: "t-someone", name: "Someone" },
      otherMembers: [],
      now: NOW,
    });

    const session = issueToken();
    const created = await repo.createSession({
      tokenHash: session.hash,
      now: NOW,
      expiresAt: WEEK,
    });
    const invite = issueToken();
    await repo.createInvitation({
      tripId: "trip-seoul",
      memberId: zen.id,
      tokenHash: invite.hash,
      createdBy: "o",
      now: NOW,
      expiresAt: WEEK,
    });
    await repo.redeemInvitation({ tokenHash: invite.hash, sessionId: created.id, now: NOW });

    const own = await resolveActor(repo, {
      sessionToken: session.raw,
      tripId: "trip-seoul",
      now: NOW,
    });
    expect(own.ok).toBe(true);

    const other = await resolveActor(repo, {
      sessionToken: session.raw,
      tripId: "trip-other",
      now: NOW,
    });
    expect(other.ok).toBe(false);
    if (!other.ok) expect(other.reason).toBe("NOT_A_MEMBER");
  });
});
