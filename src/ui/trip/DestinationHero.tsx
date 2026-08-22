import type { ConsumerTraveller } from "@/domain/consumerTrip";
import { initialsOf } from "@/core/trips/living";

/**
 * The destination hero.
 *
 * A trip should feel like its destination before it feels like a record. There
 * is no image service in this build and there is not going to be one bolted on
 * for decoration -- a remote image host would be a new external dependency, a
 * new failure mode, and a licensing question, all for a backdrop.
 *
 * So the character is drawn: a map-grid motif, a route line with two stops, and
 * a palette chosen from the destination's own name. Deterministic, offline, and
 * about two kilobytes.
 *
 * The palette is DECORATIVE ONLY. It carries no meaning, so nothing is lost by
 * a reader who cannot see it, and nothing is claimed about the place -- picking
 * "warm" for Seoul would be inventing a fact about Seoul.
 */

/** Six palettes. Enough that neighbouring trips differ; few enough to stay a system. */
const PALETTES: readonly (readonly [string, string, string])[] = [
  ["#17384a", "#2c5468", "#b0451f"],
  ["#1e3a34", "#2f6b52", "#b07a12"],
  ["#2a2a52", "#3b3f8f", "#a8497e"],
  ["#3a2233", "#7a4bab", "#b0451f"],
  ["#123043", "#0f5c73", "#2f6b41"],
  ["#402617", "#8a4a20", "#0f5c73"],
];

/**
 * A stable index from the name.
 *
 * The same destination always gets the same look, on every device, with no
 * stored state -- so a trip does not change colour when somebody else opens it.
 */
export function paletteFor(destination: string): readonly [string, string, string] {
  let hash = 0;
  for (const character of destination.trim().toLowerCase()) {
    hash = (hash * 31 + character.codePointAt(0)!) % 100_000;
  }
  return PALETTES[hash % PALETTES.length] ?? PALETTES[0]!;
}

export function DestinationHero({
  destination,
  dates,
  countdown,
  travellers,
}: {
  readonly destination: string;
  readonly dates: string;
  readonly countdown: number | undefined;
  readonly travellers: readonly ConsumerTraveller[];
}) {
  const [deep, mid, warm] = paletteFor(destination);

  return (
    <section
      className="hero-trip"
      style={
        {
          "--hero-deep": deep,
          "--hero-mid": mid,
          "--hero-warm": warm,
        } as React.CSSProperties
      }
    >
      {/* Decorative. Hidden from assistive technology: it says nothing. */}
      <svg className="hero-art" viewBox="0 0 400 200" aria-hidden="true" focusable="false">
        <defs>
          <pattern id="hero-grid" width="20" height="20" patternUnits="userSpaceOnUse">
            <path d="M20 0H0V20" fill="none" stroke="currentColor" strokeWidth="0.5" />
          </pattern>
        </defs>
        <rect width="400" height="200" fill="url(#hero-grid)" />
        <path
          d="M40 168 C 130 150, 150 70, 250 58"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeDasharray="4 5"
        />
        <circle cx="40" cy="168" r="4" fill="currentColor" />
        <circle cx="250" cy="58" r="6" fill="none" stroke="currentColor" strokeWidth="2" />
        <circle cx="250" cy="58" r="2" fill="currentColor" />
      </svg>

      <div className="hero-trip-body">
        <p className="hero-trip-eyebrow">
          {dates}
          {countdown !== undefined && countdown > 0 && ` · in ${String(countdown)} days`}
        </p>
        <h1 className="hero-trip-title">{destination}</h1>
        <div className="hero-avatars">
          {travellers.slice(0, 8).map((traveller) => (
            <span key={traveller.id} className="avatar avatar-stack" title={traveller.name}>
              {initialsOf(traveller)}
            </span>
          ))}
          <span className="faint">
            {travellers.length} {travellers.length === 1 ? "traveller" : "travellers"}
          </span>
        </div>
      </div>
    </section>
  );
}
