/**
 * Atlas segment times, and the timezone problem they create.
 *
 * THE REAL PAYLOAD, observed 22 August 2026:
 *
 *   "departure_time": "202609051750"
 *   "arrival_time":   "202609052010"
 *
 * Twelve digits: YYYYMMDDHHMM. A calendar date and a wall-clock time, with NO
 * timezone offset and no indication of one anywhere in the response.
 *
 * The engines above this adapter need real instants. Feasibility compares an
 * arrival against a deadline that may be in another country; wave planning sorts
 * departures on a timeline; availability windows read a local time of day. All of
 * that needs a point in time, not a wall-clock reading.
 *
 * So there is a gap, and there are only three honest ways across it:
 *
 *   1. Attach an offset we made up. NO. An eight-hour error in a departure is
 *      the difference between catching a flight and missing it, and it would be
 *      invisible -- the timestamp would look perfectly well-formed.
 *
 *   2. Reject every Atlas offer, because none carries a zone. Honest, and it
 *      makes the integration useless.
 *
 *   3. Use a real, explicit, deliberately tiny table of airports whose UTC
 *      offset is FIXED ALL YEAR, and reject every airport not in it.
 *
 * This is (3). The distinction that makes it defensible is DAYLIGHT SAVING: for
 * an airport in a zone that never shifts, the offset is a property of the place
 * and not a guess about the date. Hong Kong is +08:00 on every day of every
 * year. London is not, and London must therefore never appear in this table.
 *
 * THE RULE, and it is the whole safety property of this file:
 *
 *   AN AIRPORT MAY ONLY BE LISTED HERE IF ITS ZONE HAS NO DAYLIGHT SAVING.
 *
 * Adding a DST-observing airport with a fixed offset would silently misplace
 * every flight through it for half the year. If a route needs such an airport,
 * the answer is a real timezone database keyed by date, not another line here.
 *
 * Anything not listed is REJECTED, with a reason that names the airport.
 *
 * PURE.
 */

/**
 * Airports whose UTC offset never changes.
 *
 * Every entry is in East or Southeast Asia, where no country currently observes
 * daylight saving. Kept short on purpose: this is a list of places we have
 * deliberately checked, not a convenience map to grow by reflex.
 */
export const FIXED_OFFSET_AIRPORTS: Readonly<Record<string, string>> = {
  // +08:00, no DST
  HKG: "+08:00", // Asia/Hong_Kong
  MNL: "+08:00", // Asia/Manila
  SIN: "+08:00", // Asia/Singapore
  KUL: "+08:00", // Asia/Kuala_Lumpur
  TPE: "+08:00", // Asia/Taipei
  MFM: "+08:00", // Asia/Macau
  BKI: "+08:00", // Asia/Kuching
  DPS: "+08:00", // Asia/Makassar
  PEK: "+08:00", // Asia/Shanghai
  PVG: "+08:00", // Asia/Shanghai
  CAN: "+08:00", // Asia/Shanghai
  // +09:00, no DST
  ICN: "+09:00", // Asia/Seoul
  GMP: "+09:00", // Asia/Seoul
  NRT: "+09:00", // Asia/Tokyo
  HND: "+09:00", // Asia/Tokyo
  KIX: "+09:00", // Asia/Tokyo
  FUK: "+09:00", // Asia/Tokyo
  CTS: "+09:00", // Asia/Tokyo
  // +07:00, no DST
  BKK: "+07:00", // Asia/Bangkok
  DMK: "+07:00", // Asia/Bangkok
  CGK: "+07:00", // Asia/Jakarta
  SGN: "+07:00", // Asia/Ho_Chi_Minh
  HAN: "+07:00", // Asia/Ho_Chi_Minh
};

/** The provider's own value, kept so nothing is lost in translation. */
export interface ProviderLocalTime {
  /** Exactly as Atlas sent it, e.g. "202609051750". */
  readonly raw: string;
  /** "2026-09-05" */
  readonly localDate: string;
  /** "17:50" */
  readonly localTime: string;
  /** The airport this wall-clock reading belongs to. */
  readonly airportCode: string;
}

const COMPACT = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})$/;

/**
 * Split the compact form into its parts, with real calendar validation.
 *
 * Month 13 and day 32 are rejected here rather than being handed to `Date`,
 * which would roll them over into a different, entirely plausible-looking date.
 */
export function parseProviderLocalTime(
  raw: unknown,
  airportCode: string,
): ProviderLocalTime | undefined {
  if (typeof raw !== "string") return undefined;
  const match = COMPACT.exec(raw.trim());
  if (match === null) return undefined;

  const [, year = "", month = "", day = "", hour = "", minute = ""] = match;
  const monthNumber = Number.parseInt(month, 10);
  const dayNumber = Number.parseInt(day, 10);
  const hourNumber = Number.parseInt(hour, 10);
  const minuteNumber = Number.parseInt(minute, 10);

  if (monthNumber < 1 || monthNumber > 12) return undefined;
  if (dayNumber < 1 || dayNumber > 31) return undefined;
  if (hourNumber > 23 || minuteNumber > 59) return undefined;

  // Reject a day that does not exist in that month, e.g. 31 February.
  const probe = new Date(Date.UTC(Number.parseInt(year, 10), monthNumber - 1, dayNumber));
  if (probe.getUTCMonth() !== monthNumber - 1 || probe.getUTCDate() !== dayNumber) {
    return undefined;
  }

  return {
    raw: raw.trim(),
    localDate: `${year}-${month}-${day}`,
    localTime: `${hour}:${minute}`,
    airportCode,
  };
}

export type InstantResolution =
  | { readonly ok: true; readonly instant: string; readonly offset: string }
  | { readonly ok: false; readonly reason: string };

/**
 * Place a provider-local wall-clock reading on the timeline.
 *
 * Fails, by name, for any airport whose offset is not fixed year-round. That
 * failure is the feature: it is the difference between "we do not know when this
 * flight leaves" and a confident timestamp that is wrong by hours.
 */
export function resolveInstant(local: ProviderLocalTime): InstantResolution {
  const offset = FIXED_OFFSET_AIRPORTS[local.airportCode.toUpperCase()];
  if (offset === undefined) {
    return {
      ok: false,
      reason: `no fixed UTC offset is known for ${local.airportCode}, so its local time cannot be placed on a timeline`,
    };
  }
  return { ok: true, instant: `${local.localDate}T${local.localTime}:00${offset}`, offset };
}
