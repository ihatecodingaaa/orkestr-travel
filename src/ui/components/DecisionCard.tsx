import type { DecisionCardModel } from "../view/decisions";

/**
 * One thing that still needs a human or a provider.
 *
 * Every card comes from the package's own decisions list. The interface never
 * invents one and never suppresses one for looking untidy: an unresolved
 * requirement that nobody can see is the same as an unresolved requirement
 * nobody will act on.
 */
export function DecisionCard({ model }: { readonly model: DecisionCardModel }) {
  return (
    <article className="decision stack gap-1" data-tone={model.urgencyTone}>
      <div className="row">
        <h3>{model.headline}</h3>
        <span className="badge badge-neutral" style={{ marginLeft: "auto" }}>
          {model.actorLabel}
        </span>
      </div>
      <p>{model.detail}</p>
      <p className="faint">{model.why}</p>
    </article>
  );
}
