/**
 * How many people are going, read from what somebody actually wrote.
 *
 * THE DEFECT THIS REMOVES. The trip form asks "anything you already know?" and
 * then said, in its own help text, "Orkestr does not read it yet". Somebody
 * typed *"8 of us are going in total"* and the trip they got said **1
 * traveller**. The first thing the product asks for was the first thing it threw
 * away.
 *
 * BOUNDED, NOT CLEVER. This is a short list of phrasings that state a whole
 * group, and nothing else. It is not a parser for English, it does not infer,
 * and it runs before any paid model call because "8 of us" should not cost a
 * network round trip to understand.
 *
 * WHAT IT DELIBERATELY WILL NOT MATCH is the hard part. The sentence that
 * exposed this was:
 *
 *   "8 of us are going in total, 5 people in my family including me,
 *    2 grandparents and 1 auntie."
 *
 * A bare "N people" pattern reads that as five. Every phrase below therefore has
 * to denote the WHOLE party -- "of us", "in total", "group of" -- so a sentence
 * describing its own subgroups cannot be mistaken for a count of everybody.
 *
 * TWO TOTALS THAT DISAGREE IS A QUESTION, NOT A GUESS. When the text supports
 * more than one answer this returns AMBIGUOUS and the product asks. Silently
 * picking the larger, the smaller or the first is how a group ends up planning
 * for the wrong number of people without anybody being told.
 */

/** A group beyond this is not the product; a group below it is not a group. */
const MIN_GROUP = 2;
const MAX_GROUP = 60;

const WORD_NUMBERS: ReadonlyMap<string, number> = new Map([
  ["two", 2], ["three", 3], ["four", 4], ["five", 5], ["six", 6],
  ["seven", 7], ["eight", 8], ["nine", 9], ["ten", 10], ["eleven", 11],
  ["twelve", 12], ["thirteen", 13], ["fourteen", 14], ["fifteen", 15],
  ["sixteen", 16], ["seventeen", 17], ["eighteen", 18], ["nineteen", 19],
  ["twenty", 20],
]);

/** Digits or a written number, since people type both in the same sentence. */
const COUNT = `(\\d{1,2}|${[...WORD_NUMBERS.keys()].join("|")})`;

/**
 * Phrasings that name the whole party.
 *
 * Every one either says "us", says "total", or uses a collective noun. None of
 * them can be satisfied by a sentence that is describing part of the group.
 */
const WHOLE_GROUP_PATTERNS: readonly RegExp[] = [
  new RegExp(`\\bthere (?:are|will be) ${COUNT} of us\\b`, "i"),
  new RegExp(`\\b${COUNT} of us\\b`, "i"),
  new RegExp(`\\b(?:a )?(?:group|party) of ${COUNT}\\b`, "i"),
  new RegExp(`\\btotal of ${COUNT}\\b`, "i"),
  new RegExp(`\\b${COUNT} (?:people|travell?ers|adults|passengers)(?:\\s+\\w+){0,2}\\s+(?:in total|total|altogether|all together)\\b`, "i"),
  new RegExp(`\\b${COUNT} (?:people|travell?ers) going\\b`, "i"),
  /*
    "We're actually 8 people."

    "We" is the group, so this is a whole-party statement in the same way
    "of us" is. The people-noun is required, because "we are 3 hours from
    the airport" and "we're 2 days early" are not group sizes, and a bare
    number after "we are" is common enough in ordinary sentences to be
    dangerous.
  */
  new RegExp(`\\bwe(?:'re| are)(?: actually| now)? ${COUNT} (?:people|travell?ers|adults)\\b`, "i"),
  /* The same thing with nothing after it: "we're 8". */
  new RegExp(`\\bwe(?:'re| are)(?: actually| now)? ${COUNT}\\s*[.!?]?$`, "i"),
];

export type GroupSizeReading =
  | { readonly kind: "FOUND"; readonly size: number; readonly quote: string }
  /** More than one whole-group count was stated, and they disagree. */
  | { readonly kind: "AMBIGUOUS"; readonly sizes: readonly number[] }
  | { readonly kind: "NONE" };

function toCount(token: string): number | undefined {
  const word = WORD_NUMBERS.get(token.toLowerCase());
  if (word !== undefined) return word;
  const digits = Number(token);
  return Number.isInteger(digits) ? digits : undefined;
}

/**
 * Read a whole-group size, or decline.
 *
 * Returns the matched phrase alongside the number so the interface can show the
 * person what it read rather than asserting a figure from nowhere.
 */
export function readGroupSize(text: string): GroupSizeReading {
  if (text.trim().length === 0) return { kind: "NONE" };

  const found: { size: number; quote: string }[] = [];
  for (const pattern of WHOLE_GROUP_PATTERNS) {
    const match = pattern.exec(text);
    if (match === null) continue;
    const token = match[1];
    if (token === undefined) continue;
    const size = toCount(token);
    if (size === undefined || size < MIN_GROUP || size > MAX_GROUP) continue;
    found.push({ size, quote: match[0].trim() });
  }

  if (found.length === 0) return { kind: "NONE" };

  const distinct = [...new Set(found.map((f) => f.size))];
  if (distinct.length > 1) {
    return { kind: "AMBIGUOUS", sizes: distinct.sort((a, b) => a - b) };
  }

  /**
   * The longest matching phrase, when several patterns hit the same number.
   * "there are 8 of us" is a better thing to show a person than "8 of us".
   */
  const best = found.reduce((a, b) => (b.quote.length > a.quote.length ? b : a));
  return { kind: "FOUND", size: best.size, quote: best.quote };
}

/**
 * How the group is described once a size is known.
 *
 * NEVER INVENTS PEOPLE. Eight declared and one named is "1 named, 7 still to
 * add" -- not seven rows called Traveller 2 through Traveller 8. Capacity is a
 * number the group stated; a person exists when somebody names them.
 */
export function describeGroupSize(input: {
  readonly declared?: number;
  readonly named: number;
}): { readonly total: string; readonly detail?: string } {
  const { declared, named } = input;
  const plural = (n: number, word: string): string =>
    `${String(n)} ${word}${n === 1 ? "" : "s"}`;

  if (declared === undefined || declared <= named) {
    return { total: plural(named, "traveller") };
  }
  return {
    total: `${plural(declared, "traveller")} total`,
    detail: `${String(named)} named · ${String(declared - named)} still to add`,
  };
}

/**
 * What adding one more person does to a number the group already stated.
 *
 * THE DEFECT THIS PREVENTS is silence. A trip that says "8 travellers total"
 * and then gains a ninth named person has two numbers that disagree, and the
 * one on screen is the wrong one. Quietly raising the declared size is no
 * better: nobody said nine, and a capacity the product invented is exactly what
 * `readGroupSize` refuses to do everywhere else.
 *
 * So it is a QUESTION, asked once, at the moment the two stop agreeing. The
 * caller shows it; nothing here changes anything.
 *
 * Returns `undefined` when there is nothing to ask -- no declared size, or a
 * declared size the new arrival still fits inside.
 */
export function groupSizeProposal(input: {
  readonly declared?: number;
  readonly namedAfterAdding: number;
  readonly name: string;
}): { readonly question: string; readonly proposed: number } | undefined {
  const { declared, namedAfterAdding, name } = input;
  if (declared === undefined) return undefined;
  if (namedAfterAdding <= declared) return undefined;

  return {
    proposed: namedAfterAdding,
    question:
      `You said ${String(declared)} people in total. ` +
      `Adding ${name} makes ${String(namedAfterAdding)}.`,
  };
}
