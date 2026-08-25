import "server-only";
import type {
  BrowserSession,
  MemberPrivateData,
  SharedTripRecord,
  TripEvent,
  TripInvitation,
  TripMember,
  TripRole,
} from "../../domain/sharedTrip";
import type { IsoDateTime } from "../../domain/time";
import { inviteState } from "../../core/shared/authority";
import type {
  CreateTripInput,
  CreatedTrip,
  PayloadWrite,
  PayloadWriteResult,
  RedeemOutcome,
  SharedTripRepository,
} from "./repository";

/**
 * The shared-trip store, in memory.
 *
 * NOT A MOCK. It implements the real contract, including the parts that are
 * easy to get wrong and easy to fake: version checks are actually enforced,
 * redemption is actually one step, and private data actually lives in a
 * separate map that the trip payload has no route to.
 *
 * That is what makes it worth having. The tests that matter for Stage 3 are
 * about authority and privacy -- can the organiser read Mum's budget, can Zen
 * answer Mum's question, does a stale write get refused -- and none of those
 * questions are about SQL. Running them here means they run in milliseconds,
 * on every commit, with no database.
 *
 * The Postgres adapter implements the same interface and is checked against the
 * same suite. What it adds is durability and real transactions; what it must
 * not add is different behaviour.
 */

let counter = 0;
const nextId = (prefix: string): string => {
  counter += 1;
  return `${prefix}_${String(counter).padStart(6, "0")}`;
};

/** Test-only: makes generated ids deterministic across cases. */
export function resetMemoryIds(): void {
  counter = 0;
}

export class MemoryTripRepository implements SharedTripRepository {
  private readonly trips = new Map<string, SharedTripRecord>();
  private readonly members = new Map<string, TripMember>();
  private readonly privates = new Map<string, MemberPrivateData>();
  private readonly invitations = new Map<string, TripInvitation>();
  private readonly sessions = new Map<string, BrowserSession>();
  private readonly memberships = new Map<string, { tripId: string; memberId: string }[]>();
  private readonly events: TripEvent[] = [];

  /* --- trips ------------------------------------------------------------- */

  createTrip(input: CreateTripInput): Promise<CreatedTrip> {
    const trip: SharedTripRecord = {
      id: input.tripId,
      version: 1,
      payload: input.payload,
      createdAt: input.now,
      updatedAt: input.now,
    };
    this.trips.set(trip.id, trip);

    const made: TripMember[] = [];
    const add = (travellerId: string, name: string, role: TripRole): TripMember => {
      const member: TripMember = {
        id: nextId("mem"),
        tripId: trip.id,
        travellerId,
        name,
        role,
        createdAt: input.now,
        // The organiser is present by definition; they did not need an invite.
        ...(role === "ORGANISER" ? { joinedAt: input.now } : {}),
      };
      this.members.set(member.id, member);
      made.push(member);
      return member;
    };

    const organiser = add(input.organiser.travellerId, input.organiser.name, "ORGANISER");
    for (const other of input.otherMembers) add(other.travellerId, other.name, "TRAVELLER");

    return Promise.resolve({ trip, members: made, organiserMemberId: organiser.id });
  }

  getTrip(tripId: string): Promise<SharedTripRecord | undefined> {
    return Promise.resolve(this.trips.get(tripId));
  }

  getTripVersion(tripId: string): Promise<number | undefined> {
    return Promise.resolve(this.trips.get(tripId)?.version);
  }

  /**
   * The whole point of this class existing rather than a stub: the version
   * check happens between the read and the write, with no way for a caller to
   * separate them.
   */
  writePayload(write: PayloadWrite): Promise<PayloadWriteResult> {
    const current = this.trips.get(write.tripId);
    if (current === undefined) {
      return Promise.resolve({ ok: false, reason: "NOT_FOUND" });
    }
    if (current.version !== write.expectedVersion) {
      return Promise.resolve({
        ok: false,
        reason: "VERSION_CONFLICT",
        actualVersion: current.version,
      });
    }

    const next: SharedTripRecord = {
      ...current,
      payload: write.mutate(current.payload),
      version: current.version + 1,
      updatedAt: write.now,
    };
    this.trips.set(next.id, next);

    if (write.event !== undefined) {
      this.events.push({
        id: nextId("evt"),
        tripId: write.tripId,
        at: write.now,
        ...write.event,
      });
    }

    /* The same all-or-nothing shape as the real store, so tests written
       against this one describe behaviour Postgres actually has. */
    let member: TripMember | undefined;
    if (write.addMember !== undefined) {
      member = {
        id: nextId("mem"),
        tripId: write.tripId,
        travellerId: write.addMember.travellerId,
        name: write.addMember.name,
        role: write.addMember.role,
        createdAt: write.now,
      };
      this.members.set(member.id, member);
    }

    return Promise.resolve({
      ok: true,
      trip: next,
      ...(member === undefined ? {} : { member }),
    });
  }

  /* --- members ----------------------------------------------------------- */

  listMembers(tripId: string): Promise<readonly TripMember[]> {
    return Promise.resolve(
      [...this.members.values()]
        .filter((member) => member.tripId === tripId)
        .sort((a, b) => (a.createdAt === b.createdAt ? a.id.localeCompare(b.id) : a.createdAt < b.createdAt ? -1 : 1)),
    );
  }

  addMember(input: {
    tripId: string;
    travellerId: string;
    name: string;
    role: TripRole;
    now: IsoDateTime;
  }): Promise<TripMember> {
    const member: TripMember = {
      id: nextId("mem"),
      tripId: input.tripId,
      travellerId: input.travellerId,
      name: input.name,
      role: input.role,
      createdAt: input.now,
    };
    this.members.set(member.id, member);
    return Promise.resolve(member);
  }

  /* --- private data ------------------------------------------------------ */

  private privateKey(tripId: string, memberId: string): string {
    return `${tripId}::${memberId}`;
  }

  getPrivateData(tripId: string, memberId: string): Promise<MemberPrivateData | undefined> {
    return Promise.resolve(this.privates.get(this.privateKey(tripId, memberId)));
  }

  /**
   * Counts only. There is no code path from here to a requirement's text, which
   * is the property the whole privacy model depends on.
   */
  privateCounts(tripId: string): Promise<ReadonlyMap<string, number>> {
    const counts = new Map<string, number>();
    for (const data of this.privates.values()) {
      if (data.tripId !== tripId) continue;
      if (data.requirements.length > 0) counts.set(data.memberId, data.requirements.length);
    }
    return Promise.resolve(counts);
  }

  setPrivateData(data: MemberPrivateData): Promise<void> {
    this.privates.set(this.privateKey(data.tripId, data.memberId), data);
    return Promise.resolve();
  }

  /* --- invitations ------------------------------------------------------- */

  createInvitation(input: {
    tripId: string;
    memberId: string;
    tokenHash: string;
    createdBy: string;
    now: IsoDateTime;
    expiresAt: IsoDateTime;
  }): Promise<TripInvitation> {
    const invite: TripInvitation = {
      id: nextId("inv"),
      tripId: input.tripId,
      memberId: input.memberId,
      tokenHash: input.tokenHash,
      createdAt: input.now,
      expiresAt: input.expiresAt,
      createdBy: input.createdBy,
    };
    this.invitations.set(invite.id, invite);
    return Promise.resolve(invite);
  }

  listInvitations(tripId: string): Promise<readonly TripInvitation[]> {
    return Promise.resolve(
      [...this.invitations.values()].filter((invite) => invite.tripId === tripId),
    );
  }

  findInvitationByTokenHash(tokenHash: string): Promise<TripInvitation | undefined> {
    return Promise.resolve(
      [...this.invitations.values()].find((invite) => invite.tokenHash === tokenHash),
    );
  }

  revokeInvitation(inviteId: string, now: IsoDateTime): Promise<void> {
    const invite = this.invitations.get(inviteId);
    if (invite !== undefined) {
      this.invitations.set(inviteId, { ...invite, revokedAt: now });
    }
    return Promise.resolve();
  }

  /**
   * One step, deliberately.
   *
   * Checking redeemability and marking it redeemed as separate calls would let
   * the same link be redeemed twice by two requests that both passed the check
   * before either wrote.
   */
  redeemInvitation(input: {
    tokenHash: string;
    sessionId: string;
    now: IsoDateTime;
  }): Promise<RedeemOutcome | undefined> {
    const invite = [...this.invitations.values()].find(
      (candidate) => candidate.tokenHash === input.tokenHash,
    );
    if (invite === undefined) return Promise.resolve(undefined);
    if (inviteState(invite, input.now) !== "READY") return Promise.resolve(undefined);

    const member = this.members.get(invite.memberId);
    if (member === undefined) return Promise.resolve(undefined);

    this.invitations.set(invite.id, { ...invite, redeemedAt: input.now });
    this.members.set(member.id, { ...member, joinedAt: member.joinedAt ?? input.now });

    const existing = this.memberships.get(input.sessionId) ?? [];
    if (!existing.some((entry) => entry.tripId === invite.tripId)) {
      existing.push({ tripId: invite.tripId, memberId: invite.memberId });
    }
    this.memberships.set(input.sessionId, existing);

    return Promise.resolve({
      tripId: invite.tripId,
      memberId: invite.memberId,
      role: member.role,
    });
  }

  /* --- sessions ---------------------------------------------------------- */

  createSession(input: {
    tokenHash: string;
    now: IsoDateTime;
    expiresAt: IsoDateTime;
  }): Promise<BrowserSession> {
    const session: BrowserSession = {
      id: nextId("ses"),
      tokenHash: input.tokenHash,
      createdAt: input.now,
      lastSeenAt: input.now,
      expiresAt: input.expiresAt,
    };
    this.sessions.set(session.id, session);
    return Promise.resolve(session);
  }

  findSessionByTokenHash(tokenHash: string): Promise<BrowserSession | undefined> {
    return Promise.resolve(
      [...this.sessions.values()].find((session) => session.tokenHash === tokenHash),
    );
  }

  touchSession(sessionId: string, now: IsoDateTime): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session !== undefined) this.sessions.set(sessionId, { ...session, lastSeenAt: now });
    return Promise.resolve();
  }

  revokeSession(sessionId: string, now: IsoDateTime): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session !== undefined) this.sessions.set(sessionId, { ...session, revokedAt: now });
    return Promise.resolve();
  }

  membershipsForSession(
    sessionId: string,
  ): Promise<readonly { tripId: string; memberId: string }[]> {
    return Promise.resolve(this.memberships.get(sessionId) ?? []);
  }

  membershipFor(
    sessionId: string,
    tripId: string,
  ): Promise<{ memberId: string; role: TripRole } | undefined> {
    const entry = (this.memberships.get(sessionId) ?? []).find(
      (candidate) => candidate.tripId === tripId,
    );
    if (entry === undefined) return Promise.resolve(undefined);
    const member = this.members.get(entry.memberId);
    if (member === undefined) return Promise.resolve(undefined);
    return Promise.resolve({ memberId: member.id, role: member.role });
  }

  attachOrganiserSession(input: {
    sessionId: string;
    tripId: string;
    memberId: string;
    now: IsoDateTime;
  }): Promise<void> {
    const existing = this.memberships.get(input.sessionId) ?? [];
    if (!existing.some((entry) => entry.tripId === input.tripId)) {
      existing.push({ tripId: input.tripId, memberId: input.memberId });
    }
    this.memberships.set(input.sessionId, existing);
    return Promise.resolve();
  }

  /* --- events ------------------------------------------------------------ */

  appendEvent(event: Omit<TripEvent, "id">): Promise<TripEvent> {
    const stored: TripEvent = { id: nextId("evt"), ...event };
    this.events.push(stored);
    return Promise.resolve(stored);
  }

  listEvents(tripId: string, limit = 50): Promise<readonly TripEvent[]> {
    return Promise.resolve(
      this.events
        .filter((event) => event.tripId === tripId)
        .sort((a, b) => (a.at < b.at ? 1 : -1))
        .slice(0, limit),
    );
  }
}
