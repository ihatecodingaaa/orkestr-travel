import type { ConstraintStrength } from "../../domain/constraint";
import type { ExtractionWarning } from "../../domain/extraction";
import type {
  ExtractionCertainty,
  ProposedAssistanceNeed,
  ProposedConstraint,
  ProposedConstraintValue,
  ProposedTripIntent,
} from "../../domain/intent";

/**
 * Do the cited words actually support the claim built on them?
 *
 * SOURCE GROUNDING ANSWERS A DIFFERENT QUESTION. Since v3 every quotation is a
 * slice of the discussion, so "did somebody write these words" is settled. This
 * module answers the next one: "do those words support THIS structured claim, at
 * THIS strength". A citation can be perfectly real and the reading built on it
 * still wrong, and that gap is where the remaining defects lived:
 *
 *   "I'd like to keep it around 400 SGD if we can, but I could stretch a bit"
 *      became a HARD ceiling of 400.
 *   "I can only get leave from the 24th"
 *      became an availability window ending on the 31st, in the year 2024.
 *
 * Both quoted real sentences. Neither sentence said what was built from it.
 *
 * IT IS NOT AN NLP ENGINE AND MUST NOT BECOME ONE. It does not decide what a
 * sentence means. It decides, from a bounded list of markers, whether a sentence
 * is ALLOWED to carry the weight the model put on it. The model still proposes;
 * this only refuses the dangerous direction.
 *
 * THE ONE INVARIANT: THIS MODULE ONLY EVER WEAKENS. There is no path here that
 * turns SOFT into HARD, adds a field, widens a range, or upgrades a certainty. A
 * false positive costs a requirement being treated as a preference, which a
 * person can correct. The opposite error invents a requirement nobody stated,
 * which they may never notice.
 */

/* -------------------------------------------------------------------------- */
/*  Linguistic markers                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Wording that makes a restriction real.
 *
 * These are not "words that sound firm". Each one asserts an inability or an
 * absolute, which is what separates a requirement from a strong preference.
 */
const HARD_MARKERS: readonly string[] = [
  "cannot",
  "can not",
  "can't",
  "cant",
  "unable",
  "not able",
  "won't",
  "will not",
  "must",
  "have to",
  "has to",
  "had to",
  "need to",
  "needs to",
  "i need",
  "we need",
  "required",
  "require",
  "requires",
  "only",
  "absolute",
  "absolutely",
  "maximum",
  "max ",
  "no more than",
  "at most",
  "at the latest",
  "at the earliest",
  "ceiling",
  "limit",
  "never",
  "strictly",
  "out of the question",
  "deal breaker",
  "dealbreaker",
];

/**
 * Wording that makes a restriction a wish.
 *
 * A single one of these anywhere in the cited sentence is enough to refuse HARD,
 * because a sentence that hedges is not a sentence that forbids. "I'd like to
 * keep it around 400 but I could stretch" contains four of them and no
 * restriction at all.
 */
const SOFT_MARKERS: readonly string[] = [
  "prefer",
  "prefers",
  "preferably",
  "would like",
  "'d like",
  "would rather",
  "'d rather",
  "rather",
  "ideally",
  "ideal",
  "hoping",
  "hope",
  "wish",
  "around",
  "roughly",
  "about ",
  "approximately",
  "somewhere near",
  "or so",
  "-ish",
  "ish?",
  "stretch",
  "flexible",
  "if possible",
  "if we can",
  "if it works",
  "would be nice",
  "nice to",
  "keen",
  "leaning",
  "maybe",
  "might",
  "perhaps",
  "possibly",
  "better",
  "happy to",
  "don't mind",
  "not fussed",
];

const contains = (haystack: string, needle: string): boolean => haystack.includes(needle);

/** Which markers the cited words actually carry. */
export function markersIn(evidence: string): {
  readonly hard: readonly string[];
  readonly soft: readonly string[];
} {
  const text = evidence.toLowerCase();
  return {
    hard: HARD_MARKERS.filter((m) => contains(text, m)),
    soft: SOFT_MARKERS.filter((m) => contains(text, m)),
  };
}

export interface StrengthAssessment {
  readonly strength: ConstraintStrength;
  /** True when the model's proposal was refused and weakened. */
  readonly softened: boolean;
  /** Safe to show. Names the wording, never the whole discussion. */
  readonly reason?: string;
}

/**
 * Accessibility is exempt from softening, deliberately.
 *
 * Everywhere else, treating a requirement as a preference is the safe error.
 * Here it is not. Reading "I'd prefer step-free access" as a preference and
 * booking a route without it costs somebody the journey; reading a preference as
 * a requirement costs a slightly narrower search. The asymmetry is real, so the
 * rule is asymmetric, and it is written down rather than left implicit.
 */
function isAccessibility(value: ProposedConstraintValue): boolean {
  return value.kind === "ASSISTANCE_REQUIRED";
}

/**
 * May this claim be as strong as the model says?
 *
 * Only ever answers "yes, as proposed" or "no, weaker". SOFT and UNKNOWN pass
 * through untouched: there is no evidence pattern that promotes them, because
 * promotion is the failure this exists to prevent.
 */
export function assessStrength(input: {
  readonly proposed: ConstraintStrength;
  readonly evidence: string;
  readonly value: ProposedConstraintValue;
}): StrengthAssessment {
  if (input.proposed !== "HARD") return { strength: input.proposed, softened: false };
  if (isAccessibility(input.value)) return { strength: "HARD", softened: false };

  const { hard, soft } = markersIn(input.evidence);

  if (soft.length > 0) {
    return {
      strength: "SOFT",
      softened: true,
      reason: `The words behind this say "${soft[0] ?? ""}", which is a preference rather than a limit, so it is kept as flexible.`,
    };
  }

  if (hard.length === 0) {
    return {
      strength: "SOFT",
      softened: true,
      reason:
        "The words behind this do not state a limit, so it is kept as flexible rather than treated as a firm requirement.",
    };
  }

  return { strength: "HARD", softened: false };
}

/* -------------------------------------------------------------------------- */
/*  What the words actually say about dates                                   */
/* -------------------------------------------------------------------------- */

/**
 * The day numbers and years a sentence actually mentions.
 *
 * Deliberately crude. It is not parsing dates; it is asking whether a number
 * that ended up in a structured range appears in the words that supposedly
 * produced it. "I can only get leave from the 24th" mentions 24 and no year, so
 * a range ending on the 31st of 2024 has two values the sentence never carried.
 */
export function numbersMentionedIn(evidence: string): {
  readonly days: ReadonlySet<number>;
  readonly years: ReadonlySet<number>;
} {
  const days = new Set<number>();
  const years = new Set<number>();
  for (const match of evidence.matchAll(/\d{1,4}/g)) {
    const value = Number(match[0]);
    if (!Number.isFinite(value)) continue;
    if (match[0].length === 4 && value >= 1900 && value <= 2999) {
      years.add(value);
      continue;
    }
    if (value >= 1 && value <= 31) days.add(value);
  }
  return { days, years };
}

export type DateSupportProblem =
  | { readonly kind: "PAST_DATE"; readonly detail: string }
  | { readonly kind: "UNSUPPORTED_END"; readonly detail: string }
  | { readonly kind: "DERIVED_YEAR"; readonly detail: string };

const isoParts = (
  iso: string,
): { readonly year: number; readonly day: number } | undefined => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (match === null) return undefined;
  return { year: Number(match[1]), day: Number(match[3]) };
};

/**
 * Does the cited sentence support the whole range, or only one end of it?
 *
 * THE FIELD IS THE UNIT, NOT THE OBJECT. A span proving somebody cannot leave
 * before the 24th proves exactly that. It says nothing about when they come
 * back, and nothing at all about which year. Treating one citation as support
 * for every sibling field is how "from the 24th" became "24 August to 31 August
 * 2024".
 *
 * Returns problems rather than deciding what to do with them, because dropping a
 * value and failing an extraction are different policies and the caller owns
 * that choice.
 */
export function checkAvailabilitySupport(input: {
  readonly ranges: readonly { readonly from: string; readonly to: string }[];
  readonly evidence: string;
  /** Today, so a trip into last year is recognisable as impossible. */
  readonly now: string;
}): readonly DateSupportProblem[] {
  const problems: DateSupportProblem[] = [];
  const mentioned = numbersMentionedIn(input.evidence);
  const today = isoParts(input.now.slice(0, 10));

  for (const range of input.ranges) {
    const from = isoParts(range.from);
    const to = isoParts(range.to);
    if (from === undefined || to === undefined) continue;

    /**
     * A date before today is not a reading of the discussion, it is the model
     * defaulting to a year it saw often in training. Nobody plans a trip into
     * the past, so this is decidable without understanding the sentence at all.
     */
    if (today !== undefined && range.to < input.now.slice(0, 10)) {
      problems.push({
        kind: "PAST_DATE",
        detail: `The dates read from this are in the past (${range.from} to ${range.to}), so they cannot be what was meant.`,
      });
      continue;
    }

    if (!mentioned.years.has(from.year) || !mentioned.years.has(to.year)) {
      problems.push({
        kind: "DERIVED_YEAR",
        detail:
          "The year was not stated in the words behind this. It is inferred, not quoted.",
      });
    }

    if (to.day !== from.day && !mentioned.days.has(to.day)) {
      problems.push({
        kind: "UNSUPPORTED_END",
        detail:
          "The words behind this give a starting point but no end, so the end date was not stated.",
      });
    }
  }

  return problems;
}

/* -------------------------------------------------------------------------- */
/*  Identity, for collapsing the same fact stated twice                       */
/* -------------------------------------------------------------------------- */

/**
 * A stable key for "the same requirement".
 *
 * WHY DUPLICATES HAPPEN. An assistance need reaches the plan by two routes: the
 * model's `assistanceNeeds` list, which mapping turns into a constraint, and the
 * model's `constraints` list, which may carry the identical
 * `ASSISTANCE_REQUIRED` directly. Emit both and one person's single sentence
 * becomes two identical requirements on screen, which is how Gita ended up
 * needing step-free access twice.
 *
 * THE KEY IS OWNER PLUS MEANING, AND DELIBERATELY NOT THE EVIDENCE. The same
 * requirement said twice, in two sentences, is still one requirement -- so
 * including the citation would preserve exactly the duplicates worth collapsing.
 * Strength IS included: the same value proposed once as firm and once as
 * flexible is a disagreement, not a repetition, and flattening it would hide a
 * real conflict.
 */
export function factIdentity(input: {
  readonly ownerRef: string;
  readonly value: ProposedConstraintValue;
  readonly strength: ConstraintStrength;
}): string {
  const { value } = input;
  const payload =
    value.kind === "BUDGET_MAX"
      ? `${String(value.amountMajor)}|${value.currency.toUpperCase()}`
      : value.kind === "DEPART_NOT_BEFORE" || value.kind === "DEPART_NOT_AFTER"
        ? String(value.minutesOfDay)
        : value.kind === "MAX_STOPS"
          ? String(value.maxStops)
          : value.kind === "CHECKED_BAGS_REQUIRED"
            ? String(value.bagCount)
            : value.kind === "ASSISTANCE_REQUIRED"
              ? value.need
              : value.kind === "AVAILABLE_DATES"
                ? value.ranges.map((r) => `${r.from}..${r.to}`).sort().join(",")
                : /**
                   * Free text is normalised before comparison, because "step
                   * free access" and "Step-free access." are the same
                   * requirement typed twice, and leaving them distinct would
                   * defeat the point of collapsing duplicates at all.
                   */
                  value.text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return `${input.ownerRef}|${value.kind}|${payload}|${input.strength}`;
}

/* -------------------------------------------------------------------------- */
/*  Applying the policy                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Weaken a certainty, never raise one.
 *
 * EXPLICIT means "the text says it outright", and a reading whose end date was
 * never stated does not qualify however confident the model was. LIKELY is the
 * honest label for something read from context rather than quoted, and
 * AMBIGUOUS stays AMBIGUOUS because this is not a route to more confidence.
 */
function notMoreCertainThanLikely(certainty: ExtractionCertainty): ExtractionCertainty {
  return certainty === "EXPLICIT" ? "LIKELY" : certainty;
}

export interface PolicyResult {
  readonly intent: ProposedTripIntent;
  readonly warnings: readonly ExtractionWarning[];
}

/**
 * Hold every proposed fact to the words behind it.
 *
 * Runs after evidence has been resolved, so `source.quote` is already a slice of
 * the discussion and this can read it as what the person actually wrote.
 *
 * Four things happen, and all four only ever subtract:
 *
 *   1. A HARD claim whose words state no restriction is kept as SOFT.
 *   2. A date range that cannot be real -- because it has already happened -- is
 *      dropped, not repaired. Repairing it would be inventing a different date.
 *   3. A range whose end or year the words never stated stops claiming to be
 *      EXPLICIT. The floor is real and is kept; only the certainty moves.
 *   4. The same requirement proposed twice becomes one.
 *
 * Nothing here confirms anything. Confirmation is a separate guarantee, decided
 * by the person a requirement belongs to, and no path in this file touches it.
 */
export function applySemanticPolicy(
  intent: ProposedTripIntent,
  now: string,
): PolicyResult {
  const warnings: ExtractionWarning[] = [];
  const kept: ProposedConstraint[] = [];
  const seen = new Map<string, number>();

  /**
   * THE DUPLICATE THAT REACHED PRODUCTION CAME FROM TWO ROUTES, NOT TWO FACTS.
   *
   * An assistance need becomes a constraint during mapping. A model that ALSO
   * lists the identical `ASSISTANCE_REQUIRED` in `constraints` therefore produces
   * the same requirement twice, and Gita needed step-free access twice on screen
   * from one sentence. Dropping the constraint form here closes the second route
   * at its source, rather than papering over it afterwards.
   */
  const needsAlreadyDeclared = new Set(
    intent.assistanceNeeds.map((need) => `${need.ownerRef}|${need.need}`),
  );

  intent.constraints.forEach((proposal, index) => {
    const path = `constraints[${String(index)}]`;
    let certainty = proposal.certainty;

    if (
      proposal.value.kind === "ASSISTANCE_REQUIRED" &&
      needsAlreadyDeclared.has(`${proposal.ownerRef}|${proposal.value.need}`)
    ) {
      warnings.push({
        path,
        reason: "This requirement is already recorded as an assistance need, so it is shown once.",
        effect: "MERGED_DUPLICATE_FACT",
      });
      return;
    }

    /* 2 and 3: do the words support these dates at all? */
    if (proposal.value.kind === "AVAILABLE_DATES") {
      const problems = checkAvailabilitySupport({
        ranges: proposal.value.ranges,
        evidence: proposal.source.quote,
        now,
      });
      const impossible = problems.find((p) => p.kind === "PAST_DATE");
      if (impossible !== undefined) {
        warnings.push({
          path: `${path}.value.ranges`,
          reason: impossible.detail,
          effect: "DROPPED_IMPOSSIBLE_VALUE",
        });
        return;
      }
      const unstated = problems.find(
        (p) => p.kind === "UNSUPPORTED_END" || p.kind === "DERIVED_YEAR",
      );
      if (unstated !== undefined && certainty === "EXPLICIT") {
        certainty = notMoreCertainThanLikely(certainty);
        warnings.push({
          path: `${path}.certainty`,
          reason: unstated.detail,
          effect: "LOWERED_UNSUPPORTED_CERTAINTY",
        });
      }
    }

    /* 1: may this be as firm as the model said? */
    const assessment = assessStrength({
      proposed: proposal.proposedStrength,
      evidence: proposal.source.quote,
      value: proposal.value,
    });
    if (assessment.softened) {
      warnings.push({
        path: `${path}.proposedStrength`,
        reason: assessment.reason ?? "Kept as flexible; the words behind it state no limit.",
        effect: "SOFTENED_UNSUPPORTED_STRENGTH",
      });
    }

    const adjusted: ProposedConstraint = {
      ...proposal,
      proposedStrength: assessment.strength,
      certainty,
    };

    /* 4: has this exact requirement already been proposed? */
    const identity = factIdentity({
      ownerRef: adjusted.ownerRef,
      value: adjusted.value,
      strength: adjusted.proposedStrength,
    });
    const firstAt = seen.get(identity);
    if (firstAt !== undefined) {
      warnings.push({
        path,
        reason: "The same requirement was proposed more than once, so it is shown once.",
        effect: "MERGED_DUPLICATE_FACT",
      });
      return;
    }
    seen.set(identity, index);
    kept.push(adjusted);
  });

  /**
   * Assistance needs collapse on owner and need.
   *
   * The same sentence read twice produces the same requirement twice, and two
   * identical rows on a screen read as two separate things somebody has to
   * arrange.
   */
  const keptNeeds: ProposedAssistanceNeed[] = [];
  const seenNeeds = new Set<string>();
  intent.assistanceNeeds.forEach((need, index) => {
    const key = `${need.ownerRef}|${need.need}|${(need.description ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()}`;
    if (seenNeeds.has(key)) {
      warnings.push({
        path: `assistanceNeeds[${String(index)}]`,
        reason: "The same assistance need was proposed more than once, so it is shown once.",
        effect: "MERGED_DUPLICATE_FACT",
      });
      return;
    }
    seenNeeds.add(key);
    keptNeeds.push(need);
  });

  return {
    intent: { ...intent, constraints: kept, assistanceNeeds: keptNeeds },
    warnings,
  };
}
