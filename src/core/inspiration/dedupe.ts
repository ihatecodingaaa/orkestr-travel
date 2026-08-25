/**
 * Deciding that two people saved the same place.
 *
 * WHY IT MATTERS. Three people send three different TikToks about Gwangjang
 * Market. Three rows is a worse answer than one row that says three people
 * wanted this, because the thing the group needs to see is the agreement.
 *
 * WHY IT IS CAUTIOUS. The failure modes are not symmetric. Two rows for one
 * place is untidy and obvious, and somebody can merge them. One row for two
 * places is a plan that quietly sends the group to the wrong restaurant, and
 * nobody finds out until they are standing outside it. So this merges only on
 * evidence, and asks whenever it is unsure.
 *
 * WHAT IT WILL NOT DO is fuzzy-match. "Din Tai Fung" and "Din Tai Fung Xinyi"
 * are plausibly different branches; "Blue Bottle" appears in forty cities.
 * Similar strings are a reason to ASK, never a reason to merge.
 */

export interface DedupeCandidate {
  readonly id: string;
  readonly name: string;
  /** Neighbourhood, when known. A strong separator when both sides have one. */
  readonly area?: string;
  /** City, when known. */
  readonly city?: string;
}

export type MergeVerdict =
  /** The same place, on evidence. Safe to combine without asking. */
  | { readonly kind: "SAME"; readonly because: string }
  /** Close enough to be worth a question, not close enough to act on. */
  | { readonly kind: "ASK"; readonly question: string }
  | { readonly kind: "DIFFERENT" };

/**
 * The comparison key.
 *
 * Case, accents, punctuation and the small words that come and go in a name are
 * levelled, because "Gwangjang Market", "gwangjang market" and "Gwangjang
 * market." are one place written three ways. Nothing else is touched: no
 * stemming, no synonyms, no abbreviation expansion, because every one of those
 * turns a comparison into a guess.
 */
export function placeKey(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(the|a|an|de|la|le|el)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * A cheap similarity, used only to decide whether to ASK.
 *
 * Token overlap rather than an edit distance: "Gwangjang Market" and "Gwangjang
 * Food Market" share the word that matters, while "Blue Bottle" and "Blue
 * Lagoon" share only the word that does not. It is never used to merge.
 */
function overlap(left: string, right: string): number {
  const a = new Set(left.split(" ").filter((word) => word.length > 2));
  const b = new Set(right.split(" ").filter((word) => word.length > 2));
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const word of a) if (b.has(word)) shared += 1;
  return shared / Math.min(a.size, b.size);
}

const sameOptional = (left?: string, right?: string): boolean | undefined => {
  if (left === undefined || right === undefined) return undefined;
  return placeKey(left) === placeKey(right);
};

/**
 * Are these the same place?
 *
 * The one automatic merge is an exact key match that nothing contradicts. A
 * contradiction is two stated areas that differ, or two stated cities that
 * differ -- which is how two branches of one chain stay two places.
 */
export function compareForMerge(left: DedupeCandidate, right: DedupeCandidate): MergeVerdict {
  const leftKey = placeKey(left.name);
  const rightKey = placeKey(right.name);
  if (leftKey.length === 0 || rightKey.length === 0) return { kind: "DIFFERENT" };

  const sameCity = sameOptional(left.city, right.city);
  const sameArea = sameOptional(left.area, right.area);

  if (leftKey === rightKey) {
    if (sameCity === false) {
      return {
        kind: "ASK",
        question: `Is ${left.name} in ${String(left.city)} the same place as the one in ${String(right.city)}?`,
      };
    }
    if (sameArea === false) {
      return {
        kind: "ASK",
        question: `Is ${left.name} in ${String(left.area)} the same place as the one in ${String(right.area)}?`,
      };
    }
    return { kind: "SAME", because: "the same name, and nothing that says otherwise" };
  }

  /**
   * Different names in different cities are simply different. Checking this
   * before similarity stops "Central Market, Lisbon" and "Central Market,
   * Sydney" from ever reaching a question.
   */
  if (sameCity === false) return { kind: "DIFFERENT" };

  if (overlap(leftKey, rightKey) >= 0.6) {
    return {
      kind: "ASK",
      question: `Are "${left.name}" and "${right.name}" the same place?`,
    };
  }

  return { kind: "DIFFERENT" };
}

/**
 * Who wanted this, kept whole.
 *
 * The place is shared; the saving is personal. Merging two rows must never cost
 * the fact that Nadia was one of the people who wanted it -- that attribution is
 * the entire reason a group product shows saved places at all.
 */
export function mergeSavers(
  left: readonly string[],
  right: readonly string[],
): readonly string[] {
  return [...new Set([...left, ...right])];
}
