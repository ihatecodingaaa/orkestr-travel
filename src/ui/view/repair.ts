import type { PlanRepairResult } from "../../domain/planRepair";
import type { Traveller } from "../../domain/index";
import { formatMoney } from "../../core/money/money";

/**
 * The plan-repair view model.
 *
 * Answers one question a person actually cares about after something changes:
 * **what got disturbed, and what did not?**
 *
 * The preservation figure is handled with care. "100% preserved" on its own is
 * both true and misleading: it sounds like nothing happened, when what it means
 * is that nothing EXISTING was disturbed. So the counts lead and the percentage
 * supports them, never the other way round.
 */

export interface ChangeRowModel {
  readonly label: string;
  readonly state: "UNCHANGED" | "CHANGED" | "ADDED" | "NEEDS_REVERIFICATION";
  readonly detail: string | undefined;
}

export interface PreservationModel {
  /** The sentence that leads. Counts, not a percentage. */
  readonly primarySentence: string;
  /** What was added, stated separately so it cannot inflate the figure. */
  readonly addedSentence: string | undefined;
  /** Supporting only. Never the headline. */
  readonly percent: number;
  readonly preservedCount: number;
  readonly oldCount: number;
  readonly changedCount: number;
  readonly removedCount: number;
  readonly addedCount: number;
  /** Spelled out, because the number invites the wrong reading. */
  readonly caveat: string;
}

export interface RepairModel {
  readonly statusLabel: string;
  readonly headline: string;
  readonly impactLabel: string;
  readonly changes: readonly ChangeRowModel[];
  readonly preservation: PreservationModel;
  readonly reverificationLabels: readonly string[];
  readonly questionCount: number;
  readonly questionNames: readonly string[];
}

const STATUS_WORDING: Record<string, { label: string; headline: string }> = {
  NO_REPAIR_NEEDED: {
    label: "No change needed",
    headline: "The plan still works exactly as it was.",
  },
  LOCAL_REPAIR_FOUND: {
    label: "One group updated",
    headline: "Orkestr updated one travel group. Everything else stayed as agreed.",
  },
  GROUP_REPAIR_FOUND: {
    label: "Plan updated",
    headline: "Orkestr updated the plan.",
  },
  COMPROMISE_REQUIRED: {
    label: "Someone needs to answer",
    headline: "Orkestr found a way forward, but it needs one person to agree first.",
  },
  NO_FEASIBLE_REPAIR: {
    label: "No way to make this work",
    headline: "Nothing available fits everyone's must-have requirements.",
  },
  UNRESOLVED: {
    label: "Updated, with open questions",
    headline: "Orkestr updated the plan. Some things still need confirming.",
  },
  SEARCH_LIMIT_REACHED: {
    label: "Partial search",
    headline: "Orkestr stopped searching early, so this is not proven to be the best option.",
  },
  INVALID_REQUEST: {
    label: "Request refused",
    headline: "That request could not be carried out.",
  },
};

const IMPACT_WORDING: Record<string, string> = {
  NO_IMPACT: "Nothing in the plan depends on this",
  PERSON_ONLY: "Only one person's own record changed",
  WAVE_ONLY: "One travel group affected",
  ACTIVITY_ONLY: "Only destination plans affected",
  JOURNEY_WIDE: "The shape of the journey changed",
  COMMITMENT_INVALID: "The agreed plan can no longer be honoured",
};

/**
 * Preservation wording.
 *
 * Counts lead. "10 of 10 existing flight decisions stayed intact" says what
 * happened; "100% preserved" invites the reader to conclude that nothing
 * changed, which is a different and usually false claim. The caveat spells that
 * out rather than relying on the reader to infer it.
 *
 * The figure covers FLIGHT-PLAN decisions only. Journey items are deliberately
 * outside the inventory, so this is never presented as a whole-package number.
 */
export function buildPreservation(repair: PlanRepairResult): PreservationModel {
  const p = repair.decisionsPreserved;

  const primarySentence =
    p.oldCount === 0
      ? "There were no existing flight decisions to preserve."
      : `${p.preservedCount} of ${p.oldCount} existing flight decisions stayed intact.`;

  const addedSentence =
    p.addedCount === 0
      ? undefined
      : `${p.addedCount} new decision${p.addedCount === 1 ? " was" : "s were"} added.`;

  return {
    primarySentence,
    addedSentence,
    percent: p.preservedPercent,
    preservedCount: p.preservedCount,
    oldCount: p.oldCount,
    changedCount: p.changedCount,
    removedCount: p.removedCount,
    addedCount: p.addedCount,
    caveat:
      "This counts flight decisions only. Full preservation means nothing already agreed was disturbed, not that nothing happened.",
  };
}

export function buildRepairModel(
  repair: PlanRepairResult,
  travellers: readonly Traveller[],
): RepairModel {
  const nameOf = new Map(travellers.map((t) => [t.id as string, t.displayName] as const));
  const wording = STATUS_WORDING[repair.status] ?? {
    label: repair.status,
    headline: "The plan was reviewed.",
  };

  const changes: ChangeRowModel[] = [];

  // Waves that came through untouched. Naming them is the point of the exercise:
  // it is what tells three people they do not have to think about any of this.
  const previousWaves = repair.previousPlan?.waves ?? [];
  const nameOfWave = new Map(previousWaves.map((w) => [w.id as string, w.label] as const));

  for (const waveId of repair.impact.unchangedWaveIds) {
    changes.push({
      label: nameOfWave.get(waveId) ?? "A travel group",
      state: "UNCHANGED",
      detail: "Same flight, same people, nothing to do.",
    });
  }

  const reverifyIds = new Set(repair.reverificationRequired.map((r) => r.waveId as string));
  for (const waveId of repair.impact.affectedWaveIds) {
    const repaired = repair.repairedPlan?.waves.find((w) => w.id === waveId);
    changes.push({
      label: repaired?.label ?? nameOfWave.get(waveId) ?? "A travel group",
      state: reverifyIds.has(waveId) ? "NEEDS_REVERIFICATION" : "CHANGED",
      detail:
        repaired === undefined
          ? undefined
          : `Now ${repaired.travellerIds.length} travellers on the same flight.`,
    });
  }

  for (const added of repair.decisionDiff.added) {
    if (added.kind !== "WAVE_ASSIGNMENT") continue;
    const who = added.subjectIds[0];
    changes.push({
      label: who === undefined ? "A traveller" : (nameOf.get(who) ?? who),
      state: "ADDED",
      detail: "Added to a travel group.",
    });
  }

  return {
    statusLabel: wording.label,
    headline: wording.headline,
    impactLabel: IMPACT_WORDING[repair.impact.radius] ?? repair.impact.radius,
    changes,
    preservation: buildPreservation(repair),
    reverificationLabels: repair.reverificationRequired.map((r) => {
      const wave = repair.repairedPlan?.waves.find((w) => w.id === r.waveId);
      return wave?.label ?? "A travel group";
    }),
    questionCount: repair.approvalsRequired.length,
    questionNames: [
      ...new Set(
        repair.approvalsRequired.map((q) => nameOf.get(q.askTravellerId) ?? q.askTravellerId),
      ),
    ],
  };
}

/** The fare-check panel, fully resolved so no page has to touch Money. */
export interface FareCheckModel {
  readonly headline: string;
  readonly detail: string;
  readonly verdict: string;
  readonly tone: "neutral" | "pending" | "alert";
  readonly sourceNote: string;
}

/**
 * Build the fare panel.
 *
 * The verdict comes from the repair status, which the engine decided. This
 * function chooses wording; it does not decide whether the group can still
 * afford anything.
 */
export function buildFareCheck(input: {
  readonly previousMinor: number;
  readonly newMinor: number;
  readonly currency: string;
  readonly minorUnitScale: number;
  readonly unchanged: boolean;
  readonly unavailable: boolean;
  readonly repairStatus: string;
  readonly groupSentence: string | undefined;
}): FareCheckModel {
  const money = (minor: number): string =>
    formatMoney({
      amountMinor: minor,
      currency: input.currency as never,
      minorUnitScale: input.minorUnitScale,
    });

  const sourceNote = "Checked against the local demo provider. No airline was contacted.";

  if (input.unavailable) {
    return {
      headline: "That flight is no longer available.",
      detail: "The group cannot stay committed to it.",
      verdict: "A different flight will be needed.",
      tone: "alert",
      sourceNote,
    };
  }

  if (input.unchanged) {
    return {
      headline: "The fare has not changed.",
      detail: `Still ${money(input.newMinor)} each.`,
      verdict: "Nobody needs to do anything.",
      tone: "neutral",
      sourceNote,
    };
  }

  const delta = Math.abs(input.newMinor - input.previousMinor);
  const detail = `${money(input.previousMinor)} to ${money(input.newMinor)} each.`;

  if (input.repairStatus === "NO_FEASIBLE_REPAIR") {
    return {
      headline: `Fare changed by ${money(delta)}.`,
      detail,
      verdict:
        "This breaks a must-have limit, so the group cannot stay committed to this flight. Orkestr will not decide which requirement should give way.",
      tone: "alert",
      sourceNote,
    };
  }

  if (input.repairStatus === "COMPROMISE_REQUIRED") {
    return {
      headline: `Fare changed by ${money(delta)}.`,
      detail,
      verdict: input.groupSentence ?? "Someone needs to answer a question.",
      tone: "pending",
      sourceNote,
    };
  }

  return {
    headline: `Fare changed by ${money(delta)}.`,
    detail,
    verdict: "Everyone's commitments still hold. Nobody needs to respond.",
    tone: "neutral",
    sourceNote,
  };
}
