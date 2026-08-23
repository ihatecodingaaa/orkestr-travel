import type { IsoDateTime } from "./time";

/**
 * A trip that more than one person can open.
 *
 * WHY THIS EXISTS ALONGSIDE `ConsumerTrip`. A `ConsumerTrip` is the whole trip
 * as one JSON value, which is exactly right for something living in one
 * browser: there is only ever one reader, and that reader is allowed to see
 * everything in it.
 *
 * The moment a second person opens the same trip, "the trip" stops being one
 * value. It becomes a thing with an audience, and the audience decides what the
 * value is. Sarah's budget ceiling is part of the trip and is not part of what
 * the trip looks like to Dad.
 *
 * So the shared model is not a bigger `ConsumerTrip`. It is the trip plus the
 * three things that were previously implicit because there was only one reader:
 * WHO is asking, WHAT they may see, and WHAT they may change.
 *
 * NOTHING HERE IS A SECRET ITSELF. Tokens are represented by their hashes; the
 * raw values exist only in transit and are never stored, logged or typed into
 * this module. See `src/server/shared/tokens.ts`.
 */

/* -------------------------------------------------------------------------- */
/*  Identity                                                                  */
/* -------------------------------------------------------------------------- */

export type TripRole =
  /** Created the trip, or was given the trip to run. */
  | "ORGANISER"
  /** On the trip. Speaks for themselves and for nobody else. */
  | "TRAVELLER";

/**
 * Who is acting, resolved on the server from a session cookie.
 *
 * NEVER CONSTRUCTED FROM CLIENT INPUT. The client says which trip and which
 * resource; the server says who is asking. A request that carried its own
 * `memberId` would be asking the caller to identify themselves honestly, which
 * is not a security model.
 */
export interface TripActor {
  readonly tripId: string;
  readonly memberId: string;
  readonly role: TripRole;
  readonly sessionId: string;
}

/**
 * A person on a shared trip.
 *
 * `travellerId` is the id this member has inside the trip's `ConsumerTrip`
 * payload, so shared membership and the existing planning model line up without
 * either having to know about the other's storage.
 */
export interface TripMember {
  readonly id: string;
  readonly tripId: string;
  readonly travellerId: string;
  readonly name: string;
  readonly role: TripRole;
  /** Absent until they open an invite and a session is attached. */
  readonly joinedAt?: IsoDateTime;
  readonly createdAt: IsoDateTime;
}

/* -------------------------------------------------------------------------- */
/*  Private data                                                              */
/* -------------------------------------------------------------------------- */

/**
 * The parts of a trip that belong to exactly one member.
 *
 * A SEPARATE RECORD ON PURPOSE. Privacy that depends on remembering to filter a
 * field is privacy that fails the first time somebody adds a field. Keeping
 * owner-only values out of the shared payload entirely means the group query
 * cannot return them by accident: there is nothing to strip, because there was
 * never anything there.
 *
 * The group is still told a private requirement EXISTS -- otherwise the plan
 * appears to change for no reason -- via `MemberPrivateSummary`, which carries
 * a count and never a value.
 */
export interface MemberPrivateData {
  readonly memberId: string;
  readonly tripId: string;
  /** Owner-only. Never serialised to anybody else, at any layer. */
  readonly requirements: readonly PrivateRequirement[];
  readonly updatedAt: IsoDateTime;
}

export interface PrivateRequirement {
  readonly id: string;
  readonly strength: "REQUIRED" | "PREFERRED";
  /** In the owner's own words. Owner-only. */
  readonly text: string;
}

/** What everybody else is allowed to know about somebody's private data. */
export interface MemberPrivateSummary {
  readonly memberId: string;
  readonly count: number;
}

/* -------------------------------------------------------------------------- */
/*  Invitations                                                               */
/* -------------------------------------------------------------------------- */

export type InviteState =
  | "READY"
  | "REDEEMED"
  | "REVOKED"
  | "EXPIRED";

/**
 * One invitation, for one member, on one trip.
 *
 * `tokenHash` only. The raw token is generated, returned once so it can be put
 * on a clipboard, and then it exists nowhere this application controls. A
 * database leak therefore yields hashes of 256-bit random values, which cannot
 * be walked back to usable links.
 */
export interface TripInvitation {
  readonly id: string;
  readonly tripId: string;
  readonly memberId: string;
  readonly tokenHash: string;
  readonly createdAt: IsoDateTime;
  readonly expiresAt: IsoDateTime;
  readonly redeemedAt?: IsoDateTime;
  readonly revokedAt?: IsoDateTime;
  readonly createdBy?: string;
}

/* -------------------------------------------------------------------------- */
/*  Sessions                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * A browser, not a person.
 *
 * Stage 3 deliberately has no global account. Somebody invited to a holiday
 * should not have to create one to say which days they can travel, and a
 * signup wall in front of a group trip is where most of the group stops.
 *
 * One browser session can hold memberships in several trips, so a person who
 * organises Seoul and is invited to Bali has one session and two memberships
 * rather than two competing identities.
 *
 * THE COST IS STATED HONESTLY IN THE DOCS: losing the cookie loses the access,
 * and the organiser has to reissue an invite. A future account can bind to
 * these memberships without the trip data moving.
 */
export interface BrowserSession {
  readonly id: string;
  readonly tokenHash: string;
  readonly createdAt: IsoDateTime;
  readonly lastSeenAt: IsoDateTime;
  readonly expiresAt: IsoDateTime;
  readonly revokedAt?: IsoDateTime;
}

/** Which member a session speaks as, on which trip. */
export interface SessionMembership {
  readonly sessionId: string;
  readonly tripId: string;
  readonly memberId: string;
  readonly createdAt: IsoDateTime;
}

/* -------------------------------------------------------------------------- */
/*  The shared trip record                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The group-visible trip, plus the version everybody is editing against.
 *
 * `payload` is a `ConsumerTrip` with every private requirement removed -- the
 * same shape the local product already renders, which is what lets one set of
 * screens serve both modes.
 */
export interface SharedTripRecord {
  readonly id: string;
  readonly version: number;
  /** Group-visible `ConsumerTrip`. Contains no owner-only values. */
  readonly payload: unknown;
  readonly createdAt: IsoDateTime;
  readonly updatedAt: IsoDateTime;
}

/**
 * Something that happened, in words a traveller would use.
 *
 * NEVER CARRIES A PRIVATE VALUE. "Sarah answered a private question" is an
 * event; what she answered is not. An activity feed is the easiest place to
 * leak something the rest of the model was careful about.
 */
export interface TripEvent {
  readonly id: string;
  readonly tripId: string;
  readonly at: IsoDateTime;
  readonly summary: string;
  readonly memberId?: string;
  readonly detail?: string;
}

/* -------------------------------------------------------------------------- */
/*  Modes                                                                     */
/* -------------------------------------------------------------------------- */

export type TripMode =
  /** Lives in this browser. No server involved, and none required. */
  | "LOCAL"
  /** Lives on the server, with members and invitations. */
  | "SHARED";

/**
 * Whether shared trips are available at all in this deployment.
 *
 * FAILS CLOSED AND SAYS SO. If the database is not configured, the product
 * still works entirely locally and the sharing controls explain that sharing is
 * not set up here. What it must never do is appear to create an invitation that
 * nobody can use.
 */
export type SharedModeStatus =
  | { readonly available: true }
  | { readonly available: false; readonly reason: string };
