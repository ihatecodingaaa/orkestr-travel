import type {
  MemberPrivateData,
  MemberPrivateSummary,
  TripActor,
  TripInvitation,
  TripMember,
} from "../../domain/sharedTrip";
import type { IsoDateTime } from "../../domain/time";
import { canReadPrivate, inviteState } from "./authority";

/**
 * What each person is allowed to receive.
 *
 * STRUCTURAL, NOT COSMETIC. Nothing here hides a value with CSS or leaves it
 * out of a render. These builders decide what is *serialised at all*, and the
 * server sends only what they return. A field that never enters the response
 * cannot be found in "view source", in a React payload, in a JSON API, or in a
 * screenshot taken by somebody scrolling a debugger.
 *
 * The rule the whole file exists to enforce:
 *
 *   The group is told a private requirement EXISTS.
 *   Its owner is told what it SAYS.
 *   Nobody else is told anything more, including the organiser.
 *
 * The group is told *something* deliberately: a plan that changes for no
 * visible reason is worse than one that says somebody has a constraint.
 *
 * PURE. Given the same inputs it returns the same view, so the privacy rules
 * are testable without a database, a session or a browser.
 */

/* -------------------------------------------------------------------------- */
/*  Members                                                                   */
/* -------------------------------------------------------------------------- */

/** A member as anybody on the trip may see them. */
export interface MemberView {
  readonly id: string;
  readonly travellerId: string;
  readonly name: string;
  readonly role: TripMember["role"];
  readonly joined: boolean;
  /** True for the person reading. Lets the interface say "you" honestly. */
  readonly isYou: boolean;
  /** How many private requirements they have. Never what they say. */
  readonly privateCount: number;
  /** Present only when the reader owns this member. */
  readonly privateRequirements?: readonly PrivateRequirementView[];
}

export interface PrivateRequirementView {
  readonly id: string;
  readonly strength: "REQUIRED" | "PREFERRED";
  readonly text: string;
}

/**
 * Build one member's view for one reader.
 *
 * The owner branch is the ONLY path on which `text` is copied. There is no
 * later filter that could be forgotten, because there is no later filter.
 */
export function buildMemberForActor(
  actor: TripActor,
  member: TripMember,
  privateData: MemberPrivateData | undefined,
): MemberView {
  const count = privateData?.requirements.length ?? 0;
  const base: MemberView = {
    id: member.id,
    travellerId: member.travellerId,
    name: member.name,
    role: member.role,
    joined: member.joinedAt !== undefined,
    isYou: actor.memberId === member.id,
    privateCount: count,
  };

  if (!canReadPrivate(actor, member.id) || privateData === undefined) return base;

  return {
    ...base,
    privateRequirements: privateData.requirements.map((requirement) => ({
      id: requirement.id,
      strength: requirement.strength,
      text: requirement.text,
    })),
  };
}

/** The whole group, each member filtered for this reader. */
export function buildGroupForActor(
  actor: TripActor,
  members: readonly TripMember[],
  privateByMember: ReadonlyMap<string, MemberPrivateData>,
): readonly MemberView[] {
  return members.map((member) =>
    buildMemberForActor(actor, member, privateByMember.get(member.id)),
  );
}

/**
 * The counts the group is allowed to know.
 *
 * Used where the interface needs to say "one traveller has a private budget
 * requirement" without going near the requirement.
 */
export function privateSummaries(
  privateByMember: ReadonlyMap<string, MemberPrivateData>,
): readonly MemberPrivateSummary[] {
  return [...privateByMember.entries()].map(([memberId, data]) => ({
    memberId,
    count: data.requirements.length,
  }));
}

/* -------------------------------------------------------------------------- */
/*  Inbox                                                                     */
/* -------------------------------------------------------------------------- */

export type InboxOwnership =
  /** This reader must answer it. */
  | "YOURS"
  /** Somebody else must answer it, and this reader may not. */
  | "THEIRS";

export interface InboxItemView {
  readonly id: string;
  readonly ownership: InboxOwnership;
  readonly ownerMemberId: string;
  readonly ownerName: string;
  readonly question: string;
  readonly why: string;
  /** True when the question itself concerns owner-only information. */
  readonly isPrivate: boolean;
}

export interface PendingQuestion {
  readonly id: string;
  readonly ownerMemberId: string;
  readonly question: string;
  readonly why: string;
  readonly isPrivate: boolean;
}

/**
 * The inbox, from one person's side.
 *
 * A PRIVATE QUESTION IS NOT SHOWN TO ANYBODY BUT ITS OWNER, not even as a
 * summary line with the text removed -- the question itself can give the value
 * away ("are you comfortable going $42 over?"). Others see that the person has
 * something to answer, phrased so it carries nothing.
 */
export function buildInboxForActor(
  actor: TripActor,
  questions: readonly PendingQuestion[],
  members: readonly TripMember[],
): readonly InboxItemView[] {
  const nameOf = (memberId: string): string =>
    members.find((member) => member.id === memberId)?.name ?? "Someone";

  return questions.map((question): InboxItemView => {
    const mine = question.ownerMemberId === actor.memberId;
    if (mine) {
      return {
        id: question.id,
        ownership: "YOURS",
        ownerMemberId: question.ownerMemberId,
        ownerName: nameOf(question.ownerMemberId),
        question: question.question,
        why: question.why,
        isPrivate: question.isPrivate,
      };
    }

    const owner = nameOf(question.ownerMemberId);
    return {
      id: question.id,
      ownership: "THEIRS",
      ownerMemberId: question.ownerMemberId,
      ownerName: owner,
      question: question.isPrivate
        ? `${owner} has a private question to answer`
        : question.question,
      why: question.isPrivate
        ? "Only they can answer it. Orkestr will not show anyone else what it says."
        : question.why,
      isPrivate: question.isPrivate,
    };
  });
}

/* -------------------------------------------------------------------------- */
/*  Money                                                                     */
/* -------------------------------------------------------------------------- */

export interface MoneyViewForActor {
  /** How many people have a private money constraint. Never the values. */
  readonly privateHolders: number;
  /** The reader's own, in full. Empty for everybody else's. */
  readonly yourPrivate: readonly PrivateRequirementView[];
}

export function buildMoneyForActor(
  actor: TripActor,
  privateByMember: ReadonlyMap<string, MemberPrivateData>,
): MoneyViewForActor {
  const holders = [...privateByMember.values()].filter(
    (data) => data.requirements.length > 0,
  ).length;

  const own = privateByMember.get(actor.memberId);
  return {
    privateHolders: holders,
    yourPrivate:
      own === undefined
        ? []
        : own.requirements.map((requirement) => ({
            id: requirement.id,
            strength: requirement.strength,
            text: requirement.text,
          })),
  };
}

/* -------------------------------------------------------------------------- */
/*  Invitations                                                               */
/* -------------------------------------------------------------------------- */

export type InviteStatusView =
  | "NOT_INVITED"
  | "INVITE_READY"
  | "JOINED"
  | "INVITE_EXPIRED"
  | "INVITE_REVOKED";

export interface MemberInviteView {
  readonly memberId: string;
  readonly name: string;
  readonly status: InviteStatusView;
  /** Never a token. The share screen copies a URL it is handed separately. */
  readonly inviteId?: string;
}

/**
 * The share screen's model.
 *
 * NO TOKEN, EVER. A raw token is returned exactly once, at creation, straight
 * to a clipboard. It is not part of any view model, so it cannot end up in a
 * server-rendered payload that lives in the page source.
 */
export function buildShareForActor(
  members: readonly TripMember[],
  invites: readonly TripInvitation[],
  now: IsoDateTime,
): readonly MemberInviteView[] {
  return members.map((member): MemberInviteView => {
    if (member.joinedAt !== undefined) {
      return { memberId: member.id, name: member.name, status: "JOINED" };
    }

    // The newest invitation for this member is the one that counts.
    const latest = invites
      .filter((invite) => invite.memberId === member.id)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];

    if (latest === undefined) {
      return { memberId: member.id, name: member.name, status: "NOT_INVITED" };
    }

    const state = inviteState(latest, now);
    const status: InviteStatusView =
      state === "READY"
        ? "INVITE_READY"
        : state === "REVOKED"
          ? "INVITE_REVOKED"
          : state === "EXPIRED"
            ? "INVITE_EXPIRED"
            : "JOINED";

    return { memberId: member.id, name: member.name, status, inviteId: latest.id };
  });
}
