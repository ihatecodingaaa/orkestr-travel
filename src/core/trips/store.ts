import type {
  ConsumerTrip,
  ConsumerTraveller,
  TravellerRequirement,
  TripUpdate,
} from "../../domain/consumerTrip";
import { CONSUMER_TRIP_SCHEMA_VERSION, READABLE_SCHEMA_VERSIONS } from "../../domain/consumerTrip";
import type {
  BudgetCategory,
  BudgetLine,
  IdeaCategory,
  IdeaSource,
  PlanItem,
  PlanItemKind,
  PlanItemStatus,
  TripIdea,
} from "../../domain/livingTrip";
import { BUDGET_CATEGORIES, DEFAULT_AUTOPILOT, IDEA_CATEGORIES } from "../../domain/livingTrip";
import type { IsoDate, IsoDateTime } from "../../domain/time";
import { asIsoDate } from "../../domain/time";
import { compareIsoDate, isValidIsoDate } from "../time/civilDate";

/**
 * Trips, and where they live.
 *
 * A SEAM, not a database. There is no server yet, so trips are held in the
 * browser -- and the interface must never imply otherwise. "Saved" here means
 * saved on this device, in this browser, and the product says exactly that.
 *
 * The repository interface exists so the eventual move to real storage is one
 * implementation rather than a rewrite of every screen. It is deliberately
 * small: five operations, no query language, no relations. An abstraction
 * richer than the thing it abstracts is a liability.
 *
 * PARSING IS NOT TRUSTING. Anything read back has been sitting in a store the
 * user can edit, another tab can corrupt, and a previous version of this
 * application may have written. It is validated on the way in, and a trip that
 * does not validate is refused rather than repaired -- see `parseTrip`.
 */

export interface TripRepository {
  list(): readonly ConsumerTrip[];
  get(id: string): ConsumerTrip | undefined;
  save(trip: ConsumerTrip): void;
  remove(id: string): void;
  /** Wipes everything this repository owns. Used by the example reset. */
  clear(): void;
}

/* -------------------------------------------------------------------------- */
/*  Validation                                                                */
/* -------------------------------------------------------------------------- */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

/**
 * Validated with the repository's own calendar helpers, not with `Date`.
 *
 * `src/core` is deterministic by rule and may not touch `Date` at all --
 * enforced by a test. `isValidIsoDate` also rejects a real-calendar
 * impossibility like 31 February, which the built-in date parser would
 * silently roll over into 3 March.
 */
function readDate(value: unknown): IsoDate | undefined {
  if (typeof value !== "string" || !ISO_DATE.test(value)) return undefined;
  return isValidIsoDate(value) ? asIsoDate(value) : undefined;
}

function parseTraveller(value: unknown): ConsumerTraveller | undefined {
  if (!isRecord(value)) return undefined;
  const id = readString(value["id"]);
  const name = readString(value["name"]);
  if (id === undefined || name === undefined) return undefined;

  const rawRequirements = Array.isArray(value["requirements"]) ? value["requirements"] : [];
  /**
   * Built into a typed array rather than through `flatMap`.
   *
   * `flatMap` widens the narrowed `strength` back to `string`, which then needs
   * a cast to satisfy the domain type -- and a cast inside a parser is exactly
   * what this file exists to avoid. An explicitly typed accumulator keeps the
   * narrowing and needs no assertion at all.
   */
  const requirements: TravellerRequirement[] = [];
  for (const entry of rawRequirements) {
    if (!isRecord(entry)) continue;
    const rid = readString(entry["id"]);
    const text = readString(entry["text"]);
    const strength = entry["strength"];
    if (rid === undefined || text === undefined) continue;
    if (strength !== "REQUIRED" && strength !== "PREFERRED") continue;
    requirements.push({ id: rid, text, strength, private: entry["private"] === true });
  }

  const from = readDate(value["availableFrom"]);
  const to = readDate(value["availableTo"]);
  const mustTravelWith = Array.isArray(value["mustTravelWith"])
    ? value["mustTravelWith"].filter((entry): entry is string => typeof entry === "string")
    : [];

  return {
    id,
    name,
    isOrganiser: value["isOrganiser"] === true,
    ...(from === undefined ? {} : { availableFrom: from }),
    ...(to === undefined ? {} : { availableTo: to }),
    ...(typeof value["comingConfirmed"] === "boolean"
      ? { comingConfirmed: value["comingConfirmed"] }
      : {}),
    requirements,
    mustTravelWith,
  };
}


const PLAN_KINDS: readonly PlanItemKind[] = [
  "FLIGHT",
  "STAY",
  "ACTIVITY",
  "FOOD",
  "TRANSPORT",
  "REUNION",
  "FREE",
];
const PLAN_STATUSES: readonly PlanItemStatus[] = ["IDEA", "PLANNED", "FIXED", "BOOKED"];
const IDEA_SOURCES: readonly IdeaSource[] = ["LOCAL_EXAMPLE", "USER_ADDED", "USER_LINK"];

/** "09:20" and nothing else. A malformed time is dropped rather than guessed at. */
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;

function parseIdeas(value: unknown): TripIdea[] {
  if (!Array.isArray(value)) return [];
  const ideas: TripIdea[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const id = readString(entry["id"]);
    const title = readString(entry["title"]);
    const category = entry["category"];
    const source = entry["source"];
    const addedAt = readString(entry["addedAt"]);
    if (id === undefined || title === undefined || addedAt === undefined) continue;
    if (typeof category !== "string") continue;
    if (!IDEA_CATEGORIES.includes(category as IdeaCategory)) continue;
    if (typeof source !== "string" || !IDEA_SOURCES.includes(source as IdeaSource)) continue;

    const blurb = readString(entry["blurb"]);
    const area = readString(entry["area"]);
    const url = readString(entry["url"]);
    const addedBy = readString(entry["addedBy"]);
    const minutes = entry["minutes"];
    ideas.push({
      id,
      title,
      category: category as IdeaCategory,
      source: source as IdeaSource,
      ...(blurb === undefined ? {} : { blurb }),
      ...(area === undefined ? {} : { area }),
      ...(url === undefined ? {} : { url }),
      ...(addedBy === undefined ? {} : { addedBy }),
      ...(typeof minutes === "number" && Number.isSafeInteger(minutes) && minutes > 0
        ? { minutes }
        : {}),
      savedBy: Array.isArray(entry["savedBy"])
        ? entry["savedBy"].filter((v): v is string => typeof v === "string")
        : [],
      addedAt: addedAt as IsoDateTime,
    });
  }
  return ideas;
}

function parsePlan(value: unknown): PlanItem[] {
  if (!Array.isArray(value)) return [];
  const items: PlanItem[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const id = readString(entry["id"]);
    const title = readString(entry["title"]);
    const day = readDate(entry["day"]);
    const kind = entry["kind"];
    const status = entry["status"];
    if (id === undefined || title === undefined || day === undefined) continue;
    if (typeof kind !== "string" || !PLAN_KINDS.includes(kind as PlanItemKind)) continue;
    if (typeof status !== "string" || !PLAN_STATUSES.includes(status as PlanItemStatus)) continue;

    const startTime = readString(entry["startTime"]);
    const area = readString(entry["area"]);
    const note = readString(entry["note"]);
    const fromIdeaId = readString(entry["fromIdeaId"]);
    const minutes = entry["minutes"];
    items.push({
      id,
      day,
      title,
      kind: kind as PlanItemKind,
      status: status as PlanItemStatus,
      ...(startTime !== undefined && CLOCK.test(startTime) ? { startTime } : {}),
      ...(area === undefined ? {} : { area }),
      ...(note === undefined ? {} : { note }),
      ...(fromIdeaId === undefined ? {} : { fromIdeaId }),
      ...(typeof minutes === "number" && Number.isSafeInteger(minutes) && minutes > 0
        ? { minutes }
        : {}),
      travellerIds: Array.isArray(entry["travellerIds"])
        ? entry["travellerIds"].filter((v): v is string => typeof v === "string")
        : [],
    });
  }
  return items;
}

function parseBudget(value: unknown): ConsumerTrip["budget"] {
  if (!isRecord(value)) return { lines: [] };
  const currency = readString(value["currency"]);
  const raw = Array.isArray(value["lines"]) ? value["lines"] : [];
  const lines: BudgetLine[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    const category = entry["category"];
    if (typeof category !== "string") continue;
    if (!BUDGET_CATEGORIES.includes(category as BudgetCategory)) continue;
    const perPerson = entry["perPerson"];
    lines.push({
      category: category as BudgetCategory,
      ...(typeof perPerson === "number" && Number.isFinite(perPerson) && perPerson >= 0
        ? { perPerson }
        : {}),
    });
  }
  return {
    ...(currency !== undefined && /^[A-Za-z]{3}$/.test(currency)
      ? { currency: currency.toUpperCase() }
      : {}),
    lines,
  };
}

/**
 * Autopilot, defaulting ON.
 *
 * `!== false` rather than `=== true`: a setting absent from an older record
 * means it was never turned off, and every one of these describes behaviour the
 * engines already had.
 */
function parseAutopilot(value: unknown): ConsumerTrip["autopilot"] {
  if (!isRecord(value)) return DEFAULT_AUTOPILOT;
  return {
    flagStaleFacts: value["flagStaleFacts"] !== false,
    suggestRepairs: value["suggestRepairs"] !== false,
    preserveFixedItems: value["preserveFixedItems"] !== false,
  };
}

export type TripParse =
  | { readonly ok: true; readonly trip: ConsumerTrip }
  | { readonly ok: false; readonly reason: string };

/**
 * Read one stored trip, or refuse it.
 *
 * Refusing is the point. A trip missing its dates could be "repaired" by
 * inventing some, and the person would then be looking at a trip they never
 * planned, with no way to tell. Losing a corrupt record is recoverable; showing
 * somebody confident wrong information about their own holiday is not.
 */
export function parseTrip(value: unknown): TripParse {
  if (!isRecord(value)) return { ok: false, reason: "not an object" };

  const version = value["schemaVersion"];
  if (typeof version !== "number" || !READABLE_SCHEMA_VERSIONS.includes(version)) {
    /**
     * A version we do not understand is refused rather than migrated hopefully.
     * Reading new fields with old rules is how a trip ends up subtly wrong.
     *
     * Version 1 IS readable. Everything version 2 added is an empty collection
     * or a documented default, so the migration invents nothing -- an empty
     * list of ideas is genuinely what a trip made before ideas existed had. A
     * migration that had to guess at a value nobody supplied would be refused
     * like any other unknown version.
     */
    return { ok: false, reason: `unsupported schema version ${String(version)}` };
  }

  const id = readString(value["id"]);
  const destination = readString(value["destination"]);
  const startDate = readDate(value["startDate"]);
  const endDate = readDate(value["endDate"]);
  if (id === undefined) return { ok: false, reason: "missing id" };
  if (destination === undefined) return { ok: false, reason: "missing destination" };
  if (startDate === undefined || endDate === undefined) return { ok: false, reason: "missing dates" };
  if ((compareIsoDate(startDate, endDate) ?? 0) > 0) {
    return { ok: false, reason: "the trip ends before it starts" };
  }

  const rawTravellers = Array.isArray(value["travellers"]) ? value["travellers"] : [];
  const travellers = rawTravellers.flatMap((entry) => {
    const parsed = parseTraveller(entry);
    return parsed === undefined ? [] : [parsed];
  });

  const rawUpdates = Array.isArray(value["updates"]) ? value["updates"] : [];
  const updates = rawUpdates.flatMap((entry): TripUpdate[] => {
    if (!isRecord(entry)) return [];
    const uid = readString(entry["id"]);
    const at = readString(entry["at"]);
    const summary = readString(entry["summary"]);
    if (uid === undefined || at === undefined || summary === undefined) return [];
    const detail = readString(entry["detail"]);
    return [{ id: uid, at: at as IsoDateTime, summary, ...(detail === undefined ? {} : { detail }) }];
  });

  /**
   * A trip with no creation time is malformed, and is refused.
   *
   * The earlier version substituted the Unix epoch. That is exactly the kind of
   * invented value this parser exists to prevent: it would sort the trip to the
   * bottom of the list and date it 1970, which is a confident wrong answer where
   * "this record is broken" was the true one.
   */
  const createdAt = readString(value["createdAt"]);
  if (createdAt === undefined) return { ok: false, reason: "missing createdAt" };
  const updatedAt = readString(value["updatedAt"]) ?? createdAt;
  const notes = readString(value["notes"]);

  return {
    ok: true,
    trip: {
      schemaVersion: CONSUMER_TRIP_SCHEMA_VERSION,
      id,
      destination,
      startDate,
      endDate,
      travellers,
      ...(notes === undefined ? {} : { notes }),
      updates,
      createdAt: createdAt as IsoDateTime,
      updatedAt: updatedAt as IsoDateTime,
      ...(value["isExample"] === true ? { isExample: true } : {}),
      ideas: parseIdeas(value["ideas"]),
      plan: parsePlan(value["plan"]),
      budget: parseBudget(value["budget"]),
      autopilot: parseAutopilot(value["autopilot"]),
    },
  };
}

/* -------------------------------------------------------------------------- */
/*  Creation                                                                  */
/* -------------------------------------------------------------------------- */

export interface NewTripInput {
  readonly destination: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly organiserName: string;
  readonly notes?: string;
}

export type NewTripResult =
  | { readonly ok: true; readonly trip: ConsumerTrip }
  /** Field-keyed so the form can put each message beside the input it belongs to. */
  | { readonly ok: false; readonly errors: Readonly<Record<string, string>> };

/**
 * Build a trip from what somebody typed.
 *
 * Deliberately forgiving about everything except the four facts a trip cannot
 * exist without. No airport code, no timezone, no budget, no pace: those are
 * planning inputs, and demanding them here would mean a form nobody finishes
 * before seeing whether the product is any good.
 *
 * NO MODEL CALL. Creating a trip works with the network off and with every
 * credential absent. Language understanding accelerates this later; it is never
 * required to get in.
 */
export function createTrip(
  input: NewTripInput,
  now: IsoDateTime,
  newId: () => string,
): NewTripResult {
  const errors: Record<string, string> = {};

  const destination = input.destination.trim();
  const organiser = input.organiserName.trim();
  if (destination.length === 0) errors["destination"] = "Where are you going?";
  if (organiser.length === 0) errors["organiserName"] = "What should we call you?";

  const start = readDate(input.startDate);
  const end = readDate(input.endDate);
  if (start === undefined) errors["startDate"] = "Pick a start date.";
  if (end === undefined) errors["endDate"] = "Pick an end date.";
  if (start !== undefined && end !== undefined && (compareIsoDate(start, end) ?? 0) > 0) {
    errors["endDate"] = "The trip cannot end before it starts.";
  }

  if (Object.keys(errors).length > 0 || start === undefined || end === undefined) {
    return { ok: false, errors };
  }

  const notes = input.notes?.trim();

  return {
    ok: true,
    trip: {
      schemaVersion: CONSUMER_TRIP_SCHEMA_VERSION,
      id: newId(),
      destination,
      startDate: start,
      endDate: end,
      travellers: [
        {
          id: newId(),
          name: organiser,
          isOrganiser: true,
          /**
           * The organiser is assumed to be coming, because they just planned the
           * trip. Their DATES are still unanswered -- creating a trip is not the
           * same as saying when you can travel, and pre-filling the trip window
           * would put words in their mouth.
           */
          comingConfirmed: true,
          requirements: [],
          mustTravelWith: [],
        },
      ],
      ...(notes === undefined || notes.length === 0 ? {} : { notes }),
      updates: [{ id: newId(), at: now, summary: "Trip created" }],
      createdAt: now,
      updatedAt: now,
      ideas: [],
      plan: [],
      budget: { lines: [] },
      autopilot: DEFAULT_AUTOPILOT,
    },
  };
}

/** Append an update and stamp the trip. Newest first, so the screen reads top-down. */
export function withUpdate(
  trip: ConsumerTrip,
  update: Omit<TripUpdate, "id" | "at">,
  now: IsoDateTime,
  newId: () => string,
): ConsumerTrip {
  return {
    ...trip,
    updates: [{ id: newId(), at: now, ...update }, ...trip.updates],
    updatedAt: now,
  };
}
