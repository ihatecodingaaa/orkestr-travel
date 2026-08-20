import type { TruthBadgeModel } from "../view/truth";

/**
 * A truth badge.
 *
 * The tone comes from the view model, never from the calling component, so no
 * screen can decide on its own that something deserves a green tick. Colour is
 * always paired with a word and a shape glyph, so meaning never depends on
 * colour alone.
 *
 * The explanation is exposed as a title AND as screen-reader text, because
 * "Suggested" on its own is exactly the kind of label people fill in for
 * themselves optimistically.
 */
export function TruthBadge({ model }: { readonly model: TruthBadgeModel }) {
  return (
    <span className={`badge badge-${model.tone}`} title={model.explanation}>
      {model.label}
      <span className="sr-only">. {model.explanation}</span>
    </span>
  );
}
