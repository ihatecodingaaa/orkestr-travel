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

/**
 * What a shared-trip store must be able to do.
 *
 * ONE INTERFACE, TWO IMPLEMENTATIONS: an in-memory one used by the tests, and
 * a PostgreSQL one used in a deployment. Writing the contract first is what
 * lets the whole authority and privacy model be tested exhaustively before a
 * database exists -- and those are the tests that actually matter, because they
 * are about who may see what, not about SQL.
 *
 * DELIBERATELY NOT AN ORM. The operations here are the operations the product
 * performs, not a generic table API. `redeemInvitation` is one call because it
 * is one transaction: check the invitation, mark it redeemed, attach the
 * session, stamp the member as joined. Exposing four calls would let a caller
 * do three of them.
 *
 * PORTABLE BY DESIGN. Nothing here mentions a hosting provider. A Postgres is
 * a Postgres; the adapter takes a connection string and that is the whole
 * coupling.
 */

export interface CreateTripInput {
  readonly tripId: string;
  /** Group-visible payload. Must already have private values removed. */
  readonly payload: unknown;
  readonly organiser: {
    readonly travellerId: string;
    readonly name: string;
  };
  readonly otherMembers: readonly {
    readonly travellerId: string;
    readonly name: string;
  }[];
  readonly now: IsoDateTime;
}

export interface CreatedTrip {
  readonly trip: SharedTripRecord;
  readonly members: readonly TripMember[];
  readonly organiserMemberId: string;
}

export interface RedeemOutcome {
  readonly tripId: string;
  readonly memberId: string;
  readonly role: TripRole;
}

/**
 * A write that must not clobber somebody else's.
 *
 * `mutate` receives the current payload and returns the next one. The store
 * runs it inside a transaction that verifies `expectedVersion` first, so the
 * read and the write cannot be separated by another writer.
 */
export interface PayloadWrite {
  readonly tripId: string;
  readonly expectedVersion: number;
  readonly mutate: (current: unknown) => unknown;
  readonly event?: Omit<TripEvent, "id" | "tripId" | "at">;
  readonly now: IsoDateTime;
}

export type PayloadWriteResult =
  | { readonly ok: true; readonly trip: SharedTripRecord }
  | { readonly ok: false; readonly reason: "VERSION_CONFLICT"; readonly actualVersion: number }
  | { readonly ok: false; readonly reason: "NOT_FOUND" };

export interface SharedTripRepository {
  /* --- trips ------------------------------------------------------------- */
  createTrip(input: CreateTripInput): Promise<CreatedTrip>;
  getTrip(tripId: string): Promise<SharedTripRecord | undefined>;
  /** Just the version, for polling. Cheap on purpose. */
  getTripVersion(tripId: string): Promise<number | undefined>;
  writePayload(write: PayloadWrite): Promise<PayloadWriteResult>;

  /* --- members ----------------------------------------------------------- */
  listMembers(tripId: string): Promise<readonly TripMember[]>;
  addMember(input: {
    readonly tripId: string;
    readonly travellerId: string;
    readonly name: string;
    readonly role: TripRole;
    readonly now: IsoDateTime;
  }): Promise<TripMember>;

  /* --- private data ------------------------------------------------------ */
  /**
   * Owner-only values.
   *
   * The caller passes the member id it has already authorised. This method
   * does not decide who may read: that is `canReadPrivate`, and a store that
   * also made authority decisions would be a second place for the rule to
   * drift.
   */
  getPrivateData(tripId: string, memberId: string): Promise<MemberPrivateData | undefined>;
  /** Counts only, for the whole trip. Never values. */
  privateCounts(tripId: string): Promise<ReadonlyMap<string, number>>;
  setPrivateData(data: MemberPrivateData): Promise<void>;

  /* --- invitations ------------------------------------------------------- */
  createInvitation(input: {
    readonly tripId: string;
    readonly memberId: string;
    readonly tokenHash: string;
    readonly createdBy: string;
    readonly now: IsoDateTime;
    readonly expiresAt: IsoDateTime;
  }): Promise<TripInvitation>;
  listInvitations(tripId: string): Promise<readonly TripInvitation[]>;
  findInvitationByTokenHash(tokenHash: string): Promise<TripInvitation | undefined>;
  revokeInvitation(inviteId: string, now: IsoDateTime): Promise<void>;
  /**
   * Redeem, attach the session, and mark the member joined -- atomically.
   *
   * Returns undefined when the invitation is not redeemable, so the caller
   * cannot accidentally treat a revoked invite as a successful join.
   */
  redeemInvitation(input: {
    readonly tokenHash: string;
    readonly sessionId: string;
    readonly now: IsoDateTime;
  }): Promise<RedeemOutcome | undefined>;

  /* --- sessions ---------------------------------------------------------- */
  createSession(input: {
    readonly tokenHash: string;
    readonly now: IsoDateTime;
    readonly expiresAt: IsoDateTime;
  }): Promise<BrowserSession>;
  findSessionByTokenHash(tokenHash: string): Promise<BrowserSession | undefined>;
  touchSession(sessionId: string, now: IsoDateTime): Promise<void>;
  revokeSession(sessionId: string, now: IsoDateTime): Promise<void>;
  /** Every trip this browser can open, with the member it speaks as. */
  membershipsForSession(
    sessionId: string,
  ): Promise<readonly { readonly tripId: string; readonly memberId: string }[]>;
  membershipFor(
    sessionId: string,
    tripId: string,
  ): Promise<{ readonly memberId: string; readonly role: TripRole } | undefined>;

  /* --- events ------------------------------------------------------------ */
  appendEvent(event: Omit<TripEvent, "id">): Promise<TripEvent>;
  listEvents(tripId: string, limit?: number): Promise<readonly TripEvent[]>;
}
