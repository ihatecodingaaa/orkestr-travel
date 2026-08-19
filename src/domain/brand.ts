/**
 * Nominal ("branded") types.
 *
 * WHY: this domain has more than a dozen entity types whose identifiers are all
 * strings. Plain `string` lets a TravellerId be passed where a TripId is expected
 * and the compiler stays silent - a bug class that surfaces as a wrong traveller
 * being assigned to a wave, which is exactly the kind of error this product must
 * never make. Branding costs one type alias and catches it at compile time.
 *
 * The brand exists only in the type system. At runtime a branded value IS the
 * underlying string, so JSON serialisation, comparison and logging are unchanged.
 */

declare const BRAND: unique symbol;

export type Brand<Underlying, Tag extends string> = Underlying & {
  readonly [BRAND]: Tag;
};
