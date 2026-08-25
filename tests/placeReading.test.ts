import { describe, it, expect } from "vitest";
import { segmentDiscussion } from "@/core/intent/spans";
import {
  matchesDestination,
  readPlaceResponse,
  type PlaceCandidate,
} from "@/core/inspiration/placeReading";
import { compareForMerge, mergeSavers, placeKey } from "@/core/inspiration/dedupe";

/**
 * Reading a place out of a caption, without inventing one.
 *
 * The same rule as every other reading in this product: the model proposes and
 * cites, and software resolves the words. A caption is short enough that quotes
 * would have been tempting, and that is exactly why they are not used -- the
 * version of this product that asked a model to copy words back got paraphrases
 * and inventions, and there is no reason to relearn that here.
 */
const CAPTION = "Gwangjang Market is unreal. Get the mung bean pancake in Jongno, Seoul.";
const SPANS = segmentDiscussion(CAPTION);

describe("reading a place from evidence", () => {
  it("resolves the cited words rather than trusting text from the model", () => {
    const reading = readPlaceResponse(
      {
        places: [
          {
            name: "Gwangjang Market",
            category: "FOOD",
            city: "Seoul",
            area: "Jongno",
            certainty: "EXPLICIT",
            evidence: ["M01.S01"],
          },
        ],
      },
      SPANS,
    );
    expect(reading.kind).toBe("PLACES");
    if (reading.kind !== "PLACES") return;
    const place = reading.candidates[0];
    expect(place?.name).toBe("Gwangjang Market");
    expect(place?.source.quote).toBe("Gwangjang Market is unreal.");
    expect(CAPTION).toContain(place?.source.quote ?? "");
  });

  it("refuses a citation that was never issued", () => {
    const reading = readPlaceResponse(
      {
        places: [
          { name: "Somewhere", category: "FOOD", certainty: "EXPLICIT", evidence: ["M99.S99"] },
        ],
      },
      SPANS,
    );
    expect(reading.kind).toBe("FAILED");
  });

  it("refuses a place that cites nothing at all", () => {
    for (const evidence of [[], undefined, "M01.S01", [5]]) {
      const reading = readPlaceResponse(
        { places: [{ name: "X", category: "FOOD", certainty: "EXPLICIT", evidence }] },
        SPANS,
      );
      expect(reading.kind, JSON.stringify(evidence)).toBe("FAILED");
    }
  });

  it("refuses a category Orkestr does not have", () => {
    const reading = readPlaceResponse(
      {
        places: [
          { name: "X", category: "NIGHTLIFE", certainty: "EXPLICIT", evidence: ["M01.S01"] },
        ],
      },
      SPANS,
    );
    expect(reading.kind).toBe("FAILED");
  });

  it("fails the whole response rather than keeping the good half", () => {
    const reading = readPlaceResponse(
      {
        places: [
          { name: "Good", category: "FOOD", certainty: "EXPLICIT", evidence: ["M01.S01"] },
          { name: "Bad", category: "FOOD", certainty: "EXPLICIT", evidence: ["M77.S77"] },
        ],
      },
      SPANS,
    );
    expect(reading.kind).toBe("FAILED");
  });

  it("reads several places from a caption that names several", () => {
    const reading = readPlaceResponse(
      {
        places: [
          { name: "Gwangjang Market", category: "FOOD", certainty: "EXPLICIT", evidence: ["M01.S01"] },
          { name: "Jongno", category: "CULTURE", certainty: "LIKELY", evidence: ["M01.S02"] },
        ],
      },
      SPANS,
    );
    expect(reading.kind).toBe("PLACES");
    if (reading.kind === "PLACES") expect(reading.candidates).toHaveLength(2);
  });

  it("refuses a reply that is a list rather than a reading", () => {
    const many = Array.from({ length: 9 }, (_, i) => ({
      name: `P${String(i)}`,
      category: "FOOD",
      certainty: "EXPLICIT",
      evidence: ["M01.S01"],
    }));
    expect(readPlaceResponse({ places: many }, SPANS).kind).toBe("FAILED");
  });

  it("survives a reply that is not a reply", () => {
    for (const junk of [null, 42, "text", [], { places: "no" }]) {
      expect(() => readPlaceResponse(junk, SPANS)).not.toThrow();
    }
  });
});

/**
 * §12. The failure this prevents is the confident one.
 *
 * "The best dumplings in Seoul" names a city and a food and no restaurant. A
 * model asked for a place will produce one, and it will be a plausible
 * restaurant nobody mentioned.
 */
describe("not finding a place is a result", () => {
  it("asks a question instead of naming somewhere nobody mentioned", () => {
    const reading = readPlaceResponse(
      { places: [], question: "I could tell this is about dumplings in Seoul, but not which place." },
      SPANS,
    );
    expect(reading.kind).toBe("NO_PLACE");
    if (reading.kind === "NO_PLACE") expect(reading.question).toMatch(/which place/i);
  });

  it("still asks something useful when the model supplies no question", () => {
    const reading = readPlaceResponse({ places: [] }, SPANS);
    expect(reading.kind).toBe("NO_PLACE");
    if (reading.kind === "NO_PLACE") expect(reading.question.length).toBeGreaterThan(10);
  });
});

describe("does this place belong to this trip", () => {
  const place = (city?: string): PlaceCandidate => ({
    name: "Somewhere",
    category: "FOOD",
    certainty: "EXPLICIT",
    source: { quote: "x" },
    ...(city === undefined ? {} : { city }),
  });

  it("notices a place in another city", () => {
    expect(matchesDestination(place("Seoul"), "Beijing")).toBe("ELSEWHERE");
  });

  it("accepts the same city written differently", () => {
    expect(matchesDestination(place("beijing"), "Beijing")).toBe("MATCHES");
    expect(matchesDestination(place("Beijing, China"), "Beijing")).toBe("MATCHES");
  });

  /** Most captions never name a city. That is not a mismatch. */
  it("does not treat silence as a mismatch", () => {
    expect(matchesDestination(place(), "Beijing")).toBe("UNSTATED");
  });
});

/**
 * The failure modes are not symmetric. Two rows for one place is untidy and
 * fixable. One row for two places sends the group to the wrong restaurant.
 */
describe("deciding two saves are the same place", () => {
  const p = (name: string, area?: string, city?: string) => ({
    id: name,
    name,
    ...(area === undefined ? {} : { area }),
    ...(city === undefined ? {} : { city }),
  });

  it("levels the ways one name gets written", () => {
    expect(placeKey("Gwangjang Market")).toBe(placeKey("gwangjang  market."));
    expect(placeKey("The Blue Bottle")).toBe(placeKey("Blue Bottle"));
    expect(placeKey("Café Crème")).toBe(placeKey("Cafe Creme"));
  });

  it("merges the same name when nothing contradicts it", () => {
    const verdict = compareForMerge(p("Gwangjang Market"), p("gwangjang market"));
    expect(verdict.kind).toBe("SAME");
  });

  /** Two branches of one chain are two places. */
  it("asks rather than merging when the same name sits in two areas", () => {
    const verdict = compareForMerge(
      p("Din Tai Fung", "Xinyi"),
      p("Din Tai Fung", "Zhongshan"),
    );
    expect(verdict.kind).toBe("ASK");
  });

  it("asks rather than merging when the same name sits in two cities", () => {
    const verdict = compareForMerge(
      p("Blue Bottle", undefined, "Tokyo"),
      p("Blue Bottle", undefined, "Seoul"),
    );
    expect(verdict.kind).toBe("ASK");
  });

  it("asks about near-misses rather than acting on them", () => {
    const verdict = compareForMerge(p("Gwangjang Market"), p("Gwangjang Food Market"));
    expect(verdict.kind).toBe("ASK");
  });

  it("keeps genuinely different places apart without asking", () => {
    expect(compareForMerge(p("Blue Bottle"), p("Blue Lagoon")).kind).toBe("DIFFERENT");
    expect(
      compareForMerge(p("Central Market", undefined, "Lisbon"), p("Boqueria", undefined, "Barcelona"))
        .kind,
    ).toBe("DIFFERENT");
  });

  it("never merges on similarity alone", () => {
    const verdicts = [
      compareForMerge(p("Gwangjang Market"), p("Gwangjang Food Market")),
      compareForMerge(p("Din Tai Fung"), p("Din Tai Fung Xinyi")),
    ];
    for (const verdict of verdicts) expect(verdict.kind).not.toBe("SAME");
  });
});

/**
 * The place is shared; the saving is personal. Merging must never cost the fact
 * that Nadia was one of the people who wanted it.
 */
describe("who wanted it, kept whole", () => {
  it("keeps every saver across a merge, once each", () => {
    expect(mergeSavers(["luc", "nadia"], ["nadia", "mum"])).toEqual(["luc", "nadia", "mum"]);
  });

  it("loses nobody when one side is empty", () => {
    expect(mergeSavers([], ["mum"])).toEqual(["mum"]);
    expect(mergeSavers(["mum"], [])).toEqual(["mum"]);
  });
});
