import "server-only";
import { randomUUID } from "node:crypto";
import type { PoolClient, QueryResultRow } from "pg";
import type {
  BrowserSession,
  MemberPrivateData,
  PrivateRequirement,
  SharedTripRecord,
  TripEvent,
  TripInvitation,
  TripMember,
  TripRole,
} from "../../domain/sharedTrip";
import type { IsoDateTime } from "../../domain/time";
import { query, transaction } from "./db";
import type {
  CreateTripInput,
  CreatedTrip,
  PayloadWrite,
  PayloadWriteResult,
  RedeemOutcome,
  SharedTripRepository,
} from "./repository";

/**
 * The shared-trip store, in PostgreSQL.
 *
 * SAME CONTRACT AS THE IN-MEMORY ONE, and checked against the same suite. What
 * this adds is durability and real transactions. What it must not add is
 * different behaviour -- if the two disagree, the tests that describe the
 * product's privacy and authority rules stop meaning anything.
 *
 * TWO OPERATIONS ARE TRANSACTIONS AND HAVE TO BE.
 *
 * `writePayload` reads the version and writes the payload in one statement with
 * the version in the WHERE clause, so two writers racing produce one winner and
 * one conflict rather than one silent loss.
 *
 * `redeemInvitation` touches three tables. Doing that in three statements means
 * a crash between them can mark an invitation used by somebody who never got
 * access -- and the fix for that is a new invitation, issued by an organiser
 * who has no idea why the first one failed.
 */

const iso = (value: Date | string): IsoDateTime =>
  (value instanceof Date ? value.toISOString() : new Date(value).toISOString()) as IsoDateTime;

/* -------------------------------------------------------------------------- */
/*  Row shapes                                                                */
/* -------------------------------------------------------------------------- */

interface TripRow extends QueryResultRow {
  id: string;
  version: number;
  payload: unknown;
  created_at: Date;
  updated_at: Date;
}

interface MemberRow extends QueryResultRow {
  id: string;
  trip_id: string;
  traveller_id: string;
  name: string;
  role: TripRole;
  joined_at: Date | null;
  created_at: Date;
}

interface InviteRow extends QueryResultRow {
  id: string;
  trip_id: string;
  member_id: string;
  token_hash: string;
  created_at: Date;
  expires_at: Date;
  redeemed_at: Date | null;
  revoked_at: Date | null;
  created_by: string | null;
}

interface SessionRow extends QueryResultRow {
  id: string;
  token_hash: string;
  created_at: Date;
  last_seen_at: Date;
  expires_at: Date;
  revoked_at: Date | null;
}

interface EventRow extends QueryResultRow {
  id: string;
  trip_id: string;
  at: Date;
  summary: string;
  member_id: string | null;
  detail: string | null;
}

const toTrip = (row: TripRow): SharedTripRecord => ({
  id: row.id,
  version: row.version,
  payload: row.payload,
  createdAt: iso(row.created_at),
  updatedAt: iso(row.updated_at),
});

const toMember = (row: MemberRow): TripMember => ({
  id: row.id,
  tripId: row.trip_id,
  travellerId: row.traveller_id,
  name: row.name,
  role: row.role,
  createdAt: iso(row.created_at),
  ...(row.joined_at === null ? {} : { joinedAt: iso(row.joined_at) }),
});

const toInvite = (row: InviteRow): TripInvitation => ({
  id: row.id,
  tripId: row.trip_id,
  memberId: row.member_id,
  tokenHash: row.token_hash,
  createdAt: iso(row.created_at),
  expiresAt: iso(row.expires_at),
  ...(row.redeemed_at === null ? {} : { redeemedAt: iso(row.redeemed_at) }),
  ...(row.revoked_at === null ? {} : { revokedAt: iso(row.revoked_at) }),
  ...(row.created_by === null ? {} : { createdBy: row.created_by }),
});

const toSession = (row: SessionRow): BrowserSession => ({
  id: row.id,
  tokenHash: row.token_hash,
  createdAt: iso(row.created_at),
  lastSeenAt: iso(row.last_seen_at),
  expiresAt: iso(row.expires_at),
  ...(row.revoked_at === null ? {} : { revokedAt: iso(row.revoked_at) }),
});

const toEvent = (row: EventRow): TripEvent => ({
  id: row.id,
  tripId: row.trip_id,
  at: iso(row.at),
  summary: row.summary,
  ...(row.member_id === null ? {} : { memberId: row.member_id }),
  ...(row.detail === null ? {} : { detail: row.detail }),
});

/* -------------------------------------------------------------------------- */

export class PostgresTripRepository implements SharedTripRepository {
  /* --- trips ------------------------------------------------------------- */

  async createTrip(input: CreateTripInput): Promise<CreatedTrip> {
    return transaction(async (client): Promise<CreatedTrip> => {
      const tripRows = await client.query<TripRow>(
        `INSERT INTO shared_trip (id, version, payload, created_at, updated_at)
         VALUES ($1, 1, $2, $3, $3)
         RETURNING *`,
        [input.tripId, JSON.stringify(input.payload), input.now],
      );
      const trip = toTrip(tripRows.rows[0]!);

      const insertMember = async (
        travellerId: string,
        name: string,
        role: TripRole,
      ): Promise<TripMember> => {
        const rows = await client.query<MemberRow>(
          `INSERT INTO trip_member (id, trip_id, traveller_id, name, role, joined_at, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING *`,
          [
            randomUUID(),
            input.tripId,
            travellerId,
            name,
            role,
            // The organiser is present by definition; they needed no invite.
            role === "ORGANISER" ? input.now : null,
            input.now,
          ],
        );
        return toMember(rows.rows[0]!);
      };

      const organiser = await insertMember(
        input.organiser.travellerId,
        input.organiser.name,
        "ORGANISER",
      );
      const others: TripMember[] = [];
      for (const other of input.otherMembers) {
        others.push(await insertMember(other.travellerId, other.name, "TRAVELLER"));
      }

      return { trip, members: [organiser, ...others], organiserMemberId: organiser.id };
    });
  }

  async getTrip(tripId: string): Promise<SharedTripRecord | undefined> {
    const rows = await query<TripRow>("SELECT * FROM shared_trip WHERE id = $1", [tripId]);
    return rows[0] === undefined ? undefined : toTrip(rows[0]);
  }

  async getTripVersion(tripId: string): Promise<number | undefined> {
    const rows = await query<{ version: number }>(
      "SELECT version FROM shared_trip WHERE id = $1",
      [tripId],
    );
    return rows[0]?.version;
  }

  /**
   * The version lives in the WHERE clause.
   *
   * `UPDATE … WHERE id = $1 AND version = $2` either affects one row or none,
   * atomically. No read-then-write window exists for a second writer to slip
   * into, so a stale edit is refused rather than applied on top.
   */
  async writePayload(write: PayloadWrite): Promise<PayloadWriteResult> {
    return transaction(async (client): Promise<PayloadWriteResult> => {
      const current = await client.query<TripRow>(
        "SELECT * FROM shared_trip WHERE id = $1 FOR UPDATE",
        [write.tripId],
      );
      const row = current.rows[0];
      if (row === undefined) return { ok: false, reason: "NOT_FOUND" };
      if (row.version !== write.expectedVersion) {
        return { ok: false, reason: "VERSION_CONFLICT", actualVersion: row.version };
      }

      const nextPayload = write.mutate(row.payload);
      const updated = await client.query<TripRow>(
        `UPDATE shared_trip
            SET payload = $2, version = version + 1, updated_at = $3
          WHERE id = $1 AND version = $4
          RETURNING *`,
        [write.tripId, JSON.stringify(nextPayload), write.now, write.expectedVersion],
      );

      const next = updated.rows[0];
      if (next === undefined) {
        return { ok: false, reason: "VERSION_CONFLICT", actualVersion: row.version };
      }

      if (write.event !== undefined) {
        await this.insertEvent(client, {
          tripId: write.tripId,
          at: write.now,
          ...write.event,
        });
      }

      return { ok: true, trip: toTrip(next) };
    });
  }

  /* --- members ----------------------------------------------------------- */

  async listMembers(tripId: string): Promise<readonly TripMember[]> {
    const rows = await query<MemberRow>(
      "SELECT * FROM trip_member WHERE trip_id = $1 ORDER BY created_at, id",
      [tripId],
    );
    return rows.map(toMember);
  }

  async addMember(input: {
    tripId: string;
    travellerId: string;
    name: string;
    role: TripRole;
    now: IsoDateTime;
  }): Promise<TripMember> {
    const rows = await query<MemberRow>(
      `INSERT INTO trip_member (id, trip_id, traveller_id, name, role, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [randomUUID(), input.tripId, input.travellerId, input.name, input.role, input.now],
    );
    return toMember(rows[0]!);
  }

  /* --- private data ------------------------------------------------------ */

  async getPrivateData(
    tripId: string,
    memberId: string,
  ): Promise<MemberPrivateData | undefined> {
    const rows = await query<{
      trip_id: string;
      member_id: string;
      requirements: PrivateRequirement[];
      updated_at: Date;
    }>(
      "SELECT * FROM member_private_data WHERE trip_id = $1 AND member_id = $2",
      [tripId, memberId],
    );
    const row = rows[0];
    if (row === undefined) return undefined;
    return {
      tripId: row.trip_id,
      memberId: row.member_id,
      requirements: row.requirements,
      updatedAt: iso(row.updated_at),
    };
  }

  /**
   * Counts only. The requirements column is never selected here, so this query
   * physically cannot return a private value regardless of what a caller does
   * with the result.
   */
  async privateCounts(tripId: string): Promise<ReadonlyMap<string, number>> {
    const rows = await query<{ member_id: string; n: string }>(
      `SELECT member_id, jsonb_array_length(requirements) AS n
         FROM member_private_data
        WHERE trip_id = $1 AND jsonb_array_length(requirements) > 0`,
      [tripId],
    );
    return new Map(rows.map((row) => [row.member_id, Number(row.n)]));
  }

  async setPrivateData(data: MemberPrivateData): Promise<void> {
    await query(
      `INSERT INTO member_private_data (trip_id, member_id, requirements, updated_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (trip_id, member_id)
       DO UPDATE SET requirements = EXCLUDED.requirements, updated_at = EXCLUDED.updated_at`,
      [data.tripId, data.memberId, JSON.stringify(data.requirements), data.updatedAt],
    );
  }

  /* --- invitations ------------------------------------------------------- */

  async createInvitation(input: {
    tripId: string;
    memberId: string;
    tokenHash: string;
    createdBy: string;
    now: IsoDateTime;
    expiresAt: IsoDateTime;
  }): Promise<TripInvitation> {
    const rows = await query<InviteRow>(
      `INSERT INTO trip_invitation
         (id, trip_id, member_id, token_hash, created_at, expires_at, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        randomUUID(),
        input.tripId,
        input.memberId,
        input.tokenHash,
        input.now,
        input.expiresAt,
        input.createdBy,
      ],
    );
    return toInvite(rows[0]!);
  }

  async listInvitations(tripId: string): Promise<readonly TripInvitation[]> {
    const rows = await query<InviteRow>(
      "SELECT * FROM trip_invitation WHERE trip_id = $1 ORDER BY created_at DESC",
      [tripId],
    );
    return rows.map(toInvite);
  }

  async findInvitationByTokenHash(tokenHash: string): Promise<TripInvitation | undefined> {
    const rows = await query<InviteRow>(
      "SELECT * FROM trip_invitation WHERE token_hash = $1",
      [tokenHash],
    );
    return rows[0] === undefined ? undefined : toInvite(rows[0]);
  }

  async revokeInvitation(inviteId: string, now: IsoDateTime): Promise<void> {
    await query("UPDATE trip_invitation SET revoked_at = $2 WHERE id = $1 AND revoked_at IS NULL", [
      inviteId,
      now,
    ]);
  }

  /**
   * One transaction, and the redeemability test is part of the UPDATE.
   *
   * `redeemed_at IS NULL AND revoked_at IS NULL AND expires_at > now` in the
   * WHERE clause means two simultaneous redemptions of the same link produce
   * one winner; the loser updates zero rows and is told the invite was used.
   */
  async redeemInvitation(input: {
    tokenHash: string;
    sessionId: string;
    now: IsoDateTime;
  }): Promise<RedeemOutcome | undefined> {
    return transaction(async (client): Promise<RedeemOutcome | undefined> => {
      const claimed = await client.query<InviteRow>(
        `UPDATE trip_invitation
            SET redeemed_at = $2
          WHERE token_hash = $1
            AND redeemed_at IS NULL
            AND revoked_at IS NULL
            AND expires_at > $2
          RETURNING *`,
        [input.tokenHash, input.now],
      );
      const invite = claimed.rows[0];
      if (invite === undefined) return undefined;

      const memberRows = await client.query<MemberRow>(
        `UPDATE trip_member
            SET joined_at = COALESCE(joined_at, $2)
          WHERE id = $1
          RETURNING *`,
        [invite.member_id, input.now],
      );
      const member = memberRows.rows[0];
      if (member === undefined) return undefined;

      await client.query(
        `INSERT INTO session_membership (session_id, trip_id, member_id, created_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (session_id, trip_id) DO NOTHING`,
        [input.sessionId, invite.trip_id, invite.member_id, input.now],
      );

      return { tripId: invite.trip_id, memberId: invite.member_id, role: member.role };
    });
  }

  /* --- sessions ---------------------------------------------------------- */

  async createSession(input: {
    tokenHash: string;
    now: IsoDateTime;
    expiresAt: IsoDateTime;
  }): Promise<BrowserSession> {
    const rows = await query<SessionRow>(
      `INSERT INTO browser_session (id, token_hash, created_at, last_seen_at, expires_at)
       VALUES ($1, $2, $3, $3, $4)
       RETURNING *`,
      [randomUUID(), input.tokenHash, input.now, input.expiresAt],
    );
    return toSession(rows[0]!);
  }

  async findSessionByTokenHash(tokenHash: string): Promise<BrowserSession | undefined> {
    const rows = await query<SessionRow>("SELECT * FROM browser_session WHERE token_hash = $1", [
      tokenHash,
    ]);
    return rows[0] === undefined ? undefined : toSession(rows[0]);
  }

  async touchSession(sessionId: string, now: IsoDateTime): Promise<void> {
    await query("UPDATE browser_session SET last_seen_at = $2 WHERE id = $1", [sessionId, now]);
  }

  async revokeSession(sessionId: string, now: IsoDateTime): Promise<void> {
    await query("UPDATE browser_session SET revoked_at = $2 WHERE id = $1", [sessionId, now]);
  }

  async membershipsForSession(
    sessionId: string,
  ): Promise<readonly { tripId: string; memberId: string }[]> {
    const rows = await query<{ trip_id: string; member_id: string }>(
      "SELECT trip_id, member_id FROM session_membership WHERE session_id = $1",
      [sessionId],
    );
    return rows.map((row) => ({ tripId: row.trip_id, memberId: row.member_id }));
  }

  async membershipFor(
    sessionId: string,
    tripId: string,
  ): Promise<{ memberId: string; role: TripRole } | undefined> {
    const rows = await query<{ member_id: string; role: TripRole }>(
      `SELECT m.id AS member_id, m.role
         FROM session_membership sm
         JOIN trip_member m ON m.id = sm.member_id
        WHERE sm.session_id = $1 AND sm.trip_id = $2`,
      [sessionId, tripId],
    );
    return rows[0] === undefined
      ? undefined
      : { memberId: rows[0].member_id, role: rows[0].role };
  }

  async attachOrganiserSession(input: {
    sessionId: string;
    tripId: string;
    memberId: string;
    now: IsoDateTime;
  }): Promise<void> {
    await query(
      `INSERT INTO session_membership (session_id, trip_id, member_id, created_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (session_id, trip_id) DO NOTHING`,
      [input.sessionId, input.tripId, input.memberId, input.now],
    );
  }

  /* --- events ------------------------------------------------------------ */

  private async insertEvent(
    client: PoolClient,
    event: Omit<TripEvent, "id">,
  ): Promise<TripEvent> {
    const rows = await client.query<EventRow>(
      `INSERT INTO trip_event (id, trip_id, at, summary, member_id, detail)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        randomUUID(),
        event.tripId,
        event.at,
        event.summary,
        event.memberId ?? null,
        event.detail ?? null,
      ],
    );
    return toEvent(rows.rows[0]!);
  }

  async appendEvent(event: Omit<TripEvent, "id">): Promise<TripEvent> {
    const rows = await query<EventRow>(
      `INSERT INTO trip_event (id, trip_id, at, summary, member_id, detail)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        randomUUID(),
        event.tripId,
        event.at,
        event.summary,
        event.memberId ?? null,
        event.detail ?? null,
      ],
    );
    return toEvent(rows[0]!);
  }

  async listEvents(tripId: string, limit = 50): Promise<readonly TripEvent[]> {
    const rows = await query<EventRow>(
      "SELECT * FROM trip_event WHERE trip_id = $1 ORDER BY at DESC LIMIT $2",
      [tripId, limit],
    );
    return rows.map(toEvent);
  }
}
