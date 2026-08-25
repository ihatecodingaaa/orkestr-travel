import "server-only";
import type { ModelStudioConfig } from "./config";
import type { ModelStudioTransport } from "./transport";
import type { ConsumerTrip } from "../../domain/consumerTrip";
import type { DraftEntry, DraftSlot } from "../../core/plan/draft";
import { tripDays } from "../../core/plan/draft";
import type { IsoDate } from "../../domain/time";

/**
 * Asking a model to shape a first draft out of what the group already wanted.
 *
 * IT CHOOSES ARRANGEMENT, NOT CONTENT. Every place it may use is listed for it
 * by id, and it returns ids. It cannot name a restaurant, because there is no
 * field for a name -- which is the same trick the evidence layer uses, applied
 * to planning: remove the field rather than ask more firmly.
 *
 * WHAT IT IS ACTUALLY GOOD AT is the part that is hard to write rules for:
 * which things belong on the same day, what makes a coherent morning, how to
 * pace a fortnight so it is not three museums in a row. The parts that must not
 * be wrong -- dates, clashes, fixed items, duplicates -- are decided afterwards
 * by `validateDraft`, which does not negotiate.
 */

export const DRAFT_PROMPT_VERSION = "orkestr-draft-v1";

const SYSTEM_PROMPT = `You arrange a group's first draft itinerary. You return JSON only.

WHAT YOU ARE GIVEN
The trip dates, the group, anything people said they need, and the places the group has already saved. Each place has an id.

WHAT YOU RETURN
{
  "days": [
    { "day": "YYYY-MM-DD", "slot": "MORNING | AFTERNOON | EVENING", "placeId": "the id of a saved place", "because": "one short phrase" }
  ]
}

RULES
- Use ONLY the place ids you were given. There is no field for a name, and a place nobody saved is a place nobody asked for.
- Use each place at most once.
- One place per slot, and only dates inside the trip.
- You do not have to fill every slot or every day. A trip with room to breathe is better than one packed with everything.
- Put things that suit each other on the same day. Food in the evening usually; markets and outdoor things in the morning; keep a heavy day next to a light one.
- Respect what people said they need. If somebody needs step-free access, do not build a day around something the group described as a climb.
- "because" is one short phrase a person would recognise: "3 people saved this", "close to the morning stop", "Nadia asked for food markets". Never invent a reason.

WHAT YOU MUST NOT DO
- Do not invent places, restaurants, opening hours, travel times, ticket prices or bookings. You have not checked any of them and neither has Orkestr.
- Do not schedule anything on a date outside the trip.

Return the JSON object and nothing else.`;

export interface DraftProposal {
  readonly entries: readonly DraftEntry[];
  readonly durationMs: number;
  readonly failed?: string;
}

export class QwenDraftPlanner {
  constructor(
    private readonly config: ModelStudioConfig,
    private readonly transport: ModelStudioTransport,
  ) {}

  async propose(trip: ConsumerTrip): Promise<DraftProposal> {
    const days = tripDays(trip);
    const outcome = await this.transport.send({
      path: "/chat/completions",
      timeoutMs: this.config.timeoutMs,
      body: {
        model: this.config.extractionModel,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: buildDraftMessage(trip, days) },
        ],
        response_format: { type: "json_object" },
        temperature: 0,
        enable_thinking: false,
      },
    });

    if (!outcome.ok) {
      return { entries: [], durationMs: outcome.durationMs, failed: outcome.message };
    }

    const body = outcome.body as { choices?: { message?: { content?: unknown } }[] };
    const content = body.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      return { entries: [], durationMs: outcome.durationMs, failed: "The reply had no content." };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(stripFence(content));
    } catch {
      return {
        entries: [],
        durationMs: outcome.durationMs,
        failed: "The reply was not valid JSON.",
      };
    }

    return { entries: readEntries(parsed), durationMs: outcome.durationMs };
  }
}

/**
 * Shape only, here. Whether an id exists and whether a day is real is decided
 * by `validateDraft` against the trip, which is the thing that actually knows.
 */
function readEntries(parsed: unknown): readonly DraftEntry[] {
  if (typeof parsed !== "object" || parsed === null) return [];
  const days = (parsed as { days?: unknown }).days;
  if (!Array.isArray(days)) return [];

  const slots: readonly DraftSlot[] = ["MORNING", "AFTERNOON", "EVENING"];
  const entries: DraftEntry[] = [];
  for (const raw of days.slice(0, 120)) {
    if (typeof raw !== "object" || raw === null) continue;
    const row = raw as Record<string, unknown>;
    const day = row["day"];
    const slot = row["slot"];
    const placeId = row["placeId"];
    const because = row["because"];
    if (typeof day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    if (typeof slot !== "string" || !slots.includes(slot as DraftSlot)) continue;
    if (typeof placeId !== "string" || placeId.length === 0) continue;
    entries.push({
      day: day as IsoDate,
      slot: slot as DraftSlot,
      ideaId: placeId,
      ...(typeof because === "string" && because.trim().length > 0
        ? { because: because.trim().slice(0, 120) }
        : {}),
    });
  }
  return entries;
}

function buildDraftMessage(trip: ConsumerTrip, days: readonly IsoDate[]): string {
  const places = trip.ideas
    .map((idea) => {
      const savers = idea.savedBy.length;
      const who = savers > 1 ? ` — ${String(savers)} people saved this` : "";
      const where = idea.area === undefined ? "" : ` (${idea.area})`;
      return `- ${idea.id} | ${idea.title}${where} | ${idea.category}${who}`;
    })
    .join("\n");

  /**
   * A private requirement shapes the plan without being repeated.
   *
   * The group is told that a requirement EXISTS -- otherwise the plan appears to
   * change for no reason -- and never what it says. A budget ceiling is the
   * obvious case: the planner does not need the number to know somebody has one,
   * and sending it would put a private value into a prompt for a group plan.
   */
  const requirements = trip.travellers
    .flatMap((traveller) =>
      traveller.requirements.map((requirement) =>
        requirement.private
          ? `- ${traveller.name}: has a private requirement to respect`
          : `- ${traveller.name}: ${requirement.text}`,
      ),
    )
    .join("\n");

  const fixed = trip.plan
    .filter((item) => item.status === "FIXED" || item.status === "BOOKED")
    .map((item) => `- ${item.day} ${item.startTime ?? ""} ${item.title} (already fixed)`)
    .join("\n");

  return [
    `Trip: ${trip.destination}`,
    `Days: ${days.join(", ")}`,
    `Group: ${String(trip.declaredGroupSize ?? trip.travellers.length)} travellers`,
    "",
    "Places the group saved:",
    places.length > 0 ? places : "- none",
    "",
    requirements.length > 0 ? `What people told Orkestr:\n${requirements}` : "Nobody has stated a requirement yet.",
    "",
    fixed.length > 0 ? `Already fixed, do not schedule over these:\n${fixed}` : "Nothing is fixed yet.",
  ].join("\n");
}

function stripFence(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("```")) return trimmed;
  const withoutOpen = trimmed.replace(/^```[a-zA-Z]*\s*\n?/, "");
  const close = withoutOpen.lastIndexOf("```");
  return (close === -1 ? withoutOpen : withoutOpen.slice(0, close)).trim();
}
