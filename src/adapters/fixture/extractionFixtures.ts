import type { FixtureSelection } from "./fixtureLanguageUnderstanding";

/**
 * Recorded extraction fixtures.
 *
 * EVERY IDENTITY HERE IS INVENTED. No real message from any real person is in
 * this repository, in a fixture or anywhere else.
 *
 * `rawResponse` is a response body in exactly the form a provider returns it,
 * because the fixture provider feeds it through the same validation pipeline as
 * a live call. If a quote in one of these drifts out of step with its
 * discussion, the fixture fails semantic validation exactly as a bad model
 * response would. That is deliberate: a fixture that could not fail would not be
 * testing anything.
 */

/**
 * The demo discussion: a fictional seven-person family planning Tokyo.
 *
 * Written to contain, in ordinary conversational language, one of each thing the
 * understanding layer has to get right:
 *
 *   an explicit hard budget with a currency        (Ama)
 *   an availability floor with an implied ceiling  (Bo)
 *   a soft departure-time preference               (Bo)
 *   a bag requirement stated as a necessity        (Cai)
 *   a permission that is not a requirement         (Cai)
 *   a genuinely ambiguous direct-flight remark     (Nadia)
 *   a stated access need and a stated companion    (Gita and Elias)
 *   an interest stated in the group's own words    (Nadia)
 *   a person mentioned but not yet committed       (Ryan)
 */
export const FIXTURE_DISCUSSION = `Ama: Right, Tokyo in late August then? I'm thinking five nights.
Bo: I'm in. I can only get leave from the 24th, so anything before that is out for me.
Cai: Works for me. I have to check a bag though, I'm bringing camera gear.
Ama: My absolute ceiling is 600 SGD each for flights, I genuinely cannot go above that.
Nadia: Same dates are fine. I'd rather not do a connection if we can help it, direct is better.
Gita: I need step-free access the whole way through, and Elias travels with me.
Elias: Yes, I'll be with Gita the whole way.
Cai: One stop is fine by me if it saves money.
Ama: Ryan hasn't replied yet, he might still come.
Nadia: Can we do the food markets? That's the bit I actually want.
Bo: Early mornings are rough for me, ideally nothing before 9.`;

/**
 * The recorded reading of that discussion.
 *
 * Note what is NOT here. No confirmation field, because the schema forbids one.
 * No traveller identifiers, because the model does not invent those. No verdict
 * about whether any of it is achievable, because that is not language
 * understanding and never will be.
 */
const HERO_RESPONSE = JSON.stringify({
  travellers: [
    {
      ref: "P1",
      displayName: "Ama",
      certainty: "EXPLICIT",
      source: { quote: "Right, Tokyo in late August then? I'm thinking five nights." },
    },
    {
      ref: "P2",
      displayName: "Bo",
      certainty: "EXPLICIT",
      source: { quote: "I'm in. I can only get leave from the 24th" },
    },
    {
      ref: "P3",
      displayName: "Cai",
      certainty: "EXPLICIT",
      source: { quote: "Works for me. I have to check a bag though" },
    },
    {
      ref: "P4",
      displayName: "Nadia",
      certainty: "EXPLICIT",
      source: { quote: "Same dates are fine." },
    },
    {
      ref: "P5",
      displayName: "Gita",
      certainty: "EXPLICIT",
      source: { quote: "I need step-free access the whole way through" },
    },
    {
      ref: "P6",
      displayName: "Elias",
      certainty: "EXPLICIT",
      source: { quote: "Yes, I'll be with Gita the whole way." },
    },
    {
      ref: "P7",
      displayName: "Ryan",
      certainty: "LIKELY",
      source: { quote: "Ryan hasn't replied yet, he might still come." },
    },
  ],
  constraints: [
    {
      ownerRef: "P1",
      value: { kind: "BUDGET_MAX", amountMajor: 600, currency: "SGD" },
      proposedStrength: "HARD",
      certainty: "EXPLICIT",
      source: {
        quote: "My absolute ceiling is 600 SGD each for flights, I genuinely cannot go above that.",
      },
    },
    {
      ownerRef: "P2",
      value: {
        kind: "AVAILABLE_DATES",
        ranges: [{ from: "2026-08-24", to: "2026-08-31" }],
      },
      proposedStrength: "HARD",
      // LIKELY, not EXPLICIT: the start is stated, the end is read from the
      // trip window rather than from anything Bo actually said.
      certainty: "LIKELY",
      source: {
        quote: "I can only get leave from the 24th, so anything before that is out for me.",
      },
    },
    {
      ownerRef: "P2",
      value: { kind: "DEPART_NOT_BEFORE", minutesOfDay: 540 },
      proposedStrength: "SOFT",
      certainty: "EXPLICIT",
      source: { quote: "Early mornings are rough for me, ideally nothing before 9." },
    },
    {
      ownerRef: "P3",
      value: { kind: "CHECKED_BAGS_REQUIRED", bagCount: 1 },
      proposedStrength: "HARD",
      certainty: "EXPLICIT",
      source: { quote: "I have to check a bag though, I'm bringing camera gear." },
    },
    {
      ownerRef: "P3",
      value: { kind: "MAX_STOPS", maxStops: 1 },
      proposedStrength: "SOFT",
      certainty: "LIKELY",
      source: { quote: "One stop is fine by me if it saves money." },
    },
    {
      ownerRef: "P4",
      value: { kind: "MAX_STOPS", maxStops: 0 },
      // "direct is better" alongside "I'd rather not" reads as a preference,
      // but it is not settled, so it is SOFT and AMBIGUOUS and raises a question.
      proposedStrength: "SOFT",
      certainty: "AMBIGUOUS",
      source: {
        quote: "I'd rather not do a connection if we can help it, direct is better.",
      },
    },
  ],
  relationships: [
    {
      kind: "MUST_TRAVEL_WITH",
      fromRef: "P5",
      toRef: "P6",
      certainty: "EXPLICIT",
      source: { quote: "I need step-free access the whole way through, and Elias travels with me." },
    },
  ],
  assistanceNeeds: [
    {
      ownerRef: "P5",
      need: "STEP_FREE_ACCESS",
      certainty: "EXPLICIT",
      source: { quote: "I need step-free access the whole way through" },
    },
  ],
  preferences: [
    {
      ownerRef: "P4",
      label: "food markets",
      certainty: "EXPLICIT",
      source: { quote: "Can we do the food markets? That's the bit I actually want." },
    },
  ],
  ambiguities: [
    {
      question: "Is a direct flight a requirement, or a preference you would trade for a better fare?",
      aboutRef: "P4",
      whyItMatters:
        "As a requirement it removes every connecting flight from the search; as a preference it can be weighed against price.",
      source: { quote: "direct is better" },
    },
    {
      question: "Is Ryan coming?",
      aboutRef: "P7",
      whyItMatters:
        "The number of travellers changes which flights can carry the group in one piece.",
      source: { quote: "Ryan hasn't replied yet, he might still come." },
    },
  ],
  tripContext: {
    destinationLabel: "Tokyo",
    earliestDate: "2026-08-24",
    latestDate: "2026-08-31",
    nights: 5,
    certainty: "LIKELY",
    source: { quote: "Right, Tokyo in late August then? I'm thinking five nights." },
  },
});

export const FIXTURE_EXTRACTIONS: readonly FixtureSelection[] = [
  {
    label: "Tokyo family, seven people",
    discussion: FIXTURE_DISCUSSION,
    rawResponse: HERO_RESPONSE,
  },
];
