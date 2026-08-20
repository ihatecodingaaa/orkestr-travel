import type { TravellerCardModel } from "../view/group";
import { TruthBadge } from "./TruthBadge";

/**
 * One traveller on the group board.
 *
 * The constraint chips have already been filtered for the audience by the
 * privacy selectors, so this component cannot leak a private value even by
 * mistake: it never sees one.
 */
export function TravellerCard({ model }: { readonly model: TravellerCardModel }) {
  return (
    <article className="card stack gap-2" aria-label={model.displayName}>
      <div className="row">
        <span className="avatar">
          <i aria-hidden="true">{model.initials}</i>
          <strong>{model.displayName}</strong>
        </span>
        {!model.isActive && <span className="badge badge-pending">{model.membership}</span>}
      </div>

      {model.chips.length > 0 && (
        <ul className="stack gap-1" style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {model.chips.map((chip, index) => (
            <li key={index} className="row" style={{ gap: "0.4rem" }}>
              <span className="faint">{chip.strengthLabel}</span>
              <span>{chip.label}</span>
              {chip.needsConfirmation && (
                <span className="badge badge-pending">Needs their confirmation</span>
              )}
            </li>
          ))}
        </ul>
      )}

      {model.assistance.map((need, index) => (
        <div key={index} className="stack gap-1" style={{ borderTop: "1px solid var(--line)", paddingTop: "0.6rem" }}>
          <strong style={{ textTransform: "capitalize" }}>{need.summary}</strong>
          {/* Two separate badges on purpose. The traveller confirming they need
              something and an airline confirming it can provide it are different
              facts, and merging them would be the single most misleading thing
              this card could do. */}
          <div className="row">
            <TruthBadge model={need.travellerBadge} />
            <TruthBadge model={need.providerBadge} />
          </div>
        </div>
      ))}

      {(model.mustTravelWith.length > 0 || model.prefersTravelWith.length > 0) && (
        <p className="faint">
          {model.mustTravelWith.length > 0 && (
            <>Must travel with {model.mustTravelWith.join(", ")}. </>
          )}
          {model.prefersTravelWith.length > 0 && (
            <>Prefers to travel with {model.prefersTravelWith.join(", ")}.</>
          )}
        </p>
      )}

      {!model.mayTravelAlone && model.isActive && (
        <p className="faint">Should not travel on their own.</p>
      )}
    </article>
  );
}
